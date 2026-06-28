/* ============================================================
   server/anthropic.js — server-side trivia question generation.
   The Anthropic API key is read from ANTHROPIC_API_KEY and never
   leaves the server. Generates a brand-new question per battle,
   passing recent question history so questions stay unique.
   ============================================================ */
const Anthropic = require("@anthropic-ai/sdk");
const Questions = require("../shared/questions");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const ALLOW_FALLBACK = String(process.env.ALLOW_FALLBACK_QUESTIONS || "").toLowerCase() === "true";
const MAX_ATTEMPTS = 3;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to your .env file (server-side only).");
  }
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return client;
}

// Structured-output schema (guarantees parseable JSON; no prefill needed).
const QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string" },
    question: { type: "string" },
    answer: { type: "number" },
    answerLabel: { type: "string" },
    unit: { type: "string" },
    questionType: { type: "string", enum: ["amount", "year"] },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
    topic: { type: "string" },
    entity: { type: "string" },
    factType: { type: "string" },
    sourceNote: { type: "string" },
  },
  required: [
    "category", "question", "answer", "answerLabel", "unit",
    "questionType", "difficulty", "topic", "entity", "factType", "sourceNote",
  ],
};

function fmtList(items) {
  if (!items.length) return "(none yet)";
  return items.map((q) => `- "${q.question}" (answer: ${q.answerLabel})`).join("\n");
}

function buildPrompt(category, recentCategory, recentOverall, rejectionNote) {
  return `Generate one brand-new numeric trivia question for a Risk-style territory battle.

Category: ${category}

This question must be meaningfully different from all previous questions in this saved game.

Recent used questions in this category:
${fmtList(recentCategory)}

Recent used questions overall:
${fmtList(recentOverall)}
${rejectionNote ? "\n" + rejectionNote + "\n" : ""}
Avoid:
- Repeating the same question
- Repeating the same entity and fact
- Repeating the same answer unless the topic is clearly unrelated
- Asking about the same country, company, person, product, object, sport, movie, or animal repeatedly
- Slightly rewording an old question
- Overusing the same type of question
- Questions with answers that change daily or weekly
- Questions that are too obscure for a party game
- Subjective questions
- Multiple-choice questions

Return only valid JSON with no markdown:
{
"category": "${category}",
"question": "What is the approximate population of Canada?",
"answer": 40000000,
"answerLabel": "about 40 million",
"unit": "people",
"questionType": "amount",
"difficulty": "medium",
"topic": "Canada population",
"entity": "Canada",
"factType": "population",
"sourceNote": "General knowledge estimate"
}

Rules:
- The answer must be numeric.
- For normal amount, count, distance, money, population, percentage, height, length, quantity, or record questions, use questionType "amount".
- For date/year questions, use questionType "year".
- Do not use commas in the numeric answer field.
- Use answerLabel for the human-readable answer.
- The question should be answerable by estimation.
- Do not include explanations outside JSON.
- Make the question fun for a party game.
- Make sure it is different from the provided previous questions.

All questions must ask for a number. Good examples: "What is the approximate population of Canada?", "How many bones are in the adult human body?", "In what year did the Berlin Wall fall?". Bad examples (do NOT produce): "Who was the first president?", "Which country is largest?", "What color is the flag?".`;
}

function extractJson(text) {
  if (!text) throw new Error("Empty model response");
  let t = text.trim();
  // Strip markdown fences if the model added them despite instructions.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  return JSON.parse(t.slice(start, end + 1));
}

async function callModel(prompt) {
  const c = getClient();
  const baseReq = {
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  };
  // Prefer structured outputs; fall back to plain JSON parsing if the
  // SDK/model rejects output_config.
  let resp;
  try {
    resp = await c.messages.create(Object.assign({}, baseReq, {
      output_config: { format: { type: "json_schema", schema: QUESTION_SCHEMA } },
    }));
  } catch (e) {
    resp = await c.messages.create(baseReq);
  }
  const textBlock = (resp.content || []).find((b) => b.type === "text");
  return extractJson(textBlock ? textBlock.text : "");
}

function validateShape(q) {
  if (typeof q !== "object" || q === null) return "not an object";
  const ans = Number(q.answer);
  if (!isFinite(ans) || isNaN(ans)) return "answer is not numeric";
  if (q.questionType !== "amount" && q.questionType !== "year") return "invalid questionType";
  if (q.questionType === "amount" && ans <= 0) return "amount answer must be > 0";
  if (!q.question || typeof q.question !== "string") return "missing question text";
  return null;
}

function normalizeQuestion(q, category) {
  return {
    id: undefined,
    category: q.category || category,
    question: String(q.question).trim(),
    answer: Number(q.answer),
    answerLabel: String(q.answerLabel || q.answer),
    unit: q.unit || "",
    questionType: q.questionType,
    difficulty: q.difficulty || "medium",
    topic: q.topic || "",
    entity: q.entity || "",
    factType: q.factType || "",
    sourceNote: q.sourceNote || "",
  };
}

/*
  Generate a fresh, unique question for `category`.
  usedQuestions: full saved history (array of question records).
  Returns a normalized question object with questionFingerprint set.
  Throws on failure (unless ALLOW_FALLBACK is enabled).
*/
async function generateQuestion(category, usedQuestions) {
  const used = usedQuestions || [];
  const recentCategory = used.filter((q) => q.category === category).slice(-20);
  const recentOverall = used.slice(-50);

  let rejectionNote = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw;
    try {
      raw = await callModel(buildPrompt(category, recentCategory, recentOverall, rejectionNote));
    } catch (e) {
      lastError = e;
      rejectionNote = null;
      continue; // network/API error — retry
    }

    const shapeErr = validateShape(raw);
    if (shapeErr) {
      lastError = new Error("Malformed question: " + shapeErr);
      rejectionNote = `The previous attempt was invalid (${shapeErr}). Produce a valid numeric question.`;
      continue;
    }

    const q = normalizeQuestion(raw, category);
    q.questionFingerprint = Questions.createQuestionFingerprint(q);

    const dup = Questions.isDuplicateQuestion(q, used);
    if (dup.duplicate) {
      lastError = new Error("Duplicate question: " + dup.reason);
      rejectionNote = `The previous candidate was rejected as a duplicate (${dup.reason}): "${q.question}". Generate a clearly different question — different entity, fact, and answer.`;
      continue;
    }

    q.generatedBy = "anthropic";
    return q;
  }

  if (ALLOW_FALLBACK) {
    return makeFallbackQuestion(category, used);
  }
  const err = new Error("Question generation failed. Try again.");
  err.cause = lastError;
  err.code = "QUESTION_GENERATION_FAILED";
  throw err;
}

// Developer-only fallback. Disabled unless ALLOW_FALLBACK_QUESTIONS=true.
// Clearly marked test-only; still saved to history by the caller.
function makeFallbackQuestion(category, used) {
  const n = used.length + 1;
  const q = {
    category,
    question: `[TEST-ONLY fallback] Estimate a number for ${category} (sample #${n}).`,
    answer: 100 + n,
    answerLabel: `${100 + n}`,
    unit: "",
    questionType: "amount",
    difficulty: "medium",
    topic: "fallback",
    entity: "fallback-" + n,
    factType: "fallback",
    sourceNote: "TEST-ONLY fallback question (Anthropic generation unavailable).",
    generatedBy: "fallback-test-only",
  };
  q.questionFingerprint = Questions.createQuestionFingerprint(q);
  return q;
}

module.exports = { generateQuestion, MODEL, ALLOW_FALLBACK };
