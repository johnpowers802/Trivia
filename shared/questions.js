/* ============================================================
   shared/questions.js — question fingerprinting + local
   duplicate/near-duplicate detection. Pure functions. UMD.
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TriviaRiskQuestions = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const STOPWORDS = new Set([
    "the", "a", "an", "of", "in", "on", "at", "to", "is", "are", "was", "were",
    "how", "what", "which", "many", "much", "approximately", "about", "roughly",
    "average", "total", "number", "did", "do", "does", "for", "and", "or", "by",
    "with", "as", "that", "this", "there", "have", "has", "world", "wide",
    "worldwide", "year", "years", "percent", "percentage", "people", "estimated",
  ]);

  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().trim();
  }

  // normalized category + entity + factType + answer
  function createQuestionFingerprint(q) {
    return [
      norm(q.category),
      norm(q.entity),
      norm(q.factType),
      norm(q.answer),
    ].join("|");
  }

  function keywords(text) {
    return norm(text)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  }

  function keywordOverlap(a, b) {
    const A = new Set(keywords(a));
    const B = new Set(keywords(b));
    if (A.size === 0 || B.size === 0) return 0;
    let shared = 0;
    A.forEach((w) => { if (B.has(w)) shared++; });
    return shared / Math.min(A.size, B.size);
  }

  /*
    Returns { duplicate: bool, reason: string|null } for a candidate
    question against the saved used-question history.
    Layered checks: exact text, fingerprint, entity+factType, answer
    within same category, and keyword overlap (near-duplicate).
  */
  function isDuplicateQuestion(newQuestion, usedQuestions) {
    const used = usedQuestions || [];
    const newFp = createQuestionFingerprint(newQuestion);
    const newText = norm(newQuestion.question);
    const newCat = norm(newQuestion.category);
    const newEntity = norm(newQuestion.entity);
    const newFact = norm(newQuestion.factType);
    const newAnswer = norm(newQuestion.answer);

    for (const u of used) {
      if (norm(u.question) && norm(u.question) === newText) {
        return { duplicate: true, reason: "identical question text" };
      }
      if (createQuestionFingerprint(u) === newFp) {
        return { duplicate: true, reason: "identical fingerprint" };
      }
      const sameCat = norm(u.category) === newCat;
      if (sameCat && newEntity && norm(u.entity) === newEntity && newFact && norm(u.factType) === newFact) {
        return { duplicate: true, reason: "same entity and fact type in category" };
      }
      if (sameCat && newEntity && norm(u.entity) === newEntity && newAnswer && norm(u.answer) === newAnswer) {
        return { duplicate: true, reason: "same entity and answer in category" };
      }
      if (sameCat && keywordOverlap(u.question, newQuestion.question) >= 0.6) {
        return { duplicate: true, reason: "near-duplicate wording in category" };
      }
    }
    return { duplicate: false, reason: null };
  }

  return {
    createQuestionFingerprint,
    isDuplicateQuestion,
    keywordOverlap,
  };
});
