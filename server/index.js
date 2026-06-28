/* ============================================================
   server/index.js — Trivia Risk authoritative game server.
   - Holds the live game state; all mutations go through shared/rules.
   - Generates trivia questions server-side via Anthropic.
   - Auto-saves after every successful action.
   - Never exposes the Anthropic key or unresolved answers to the client.
   ============================================================ */
require("dotenv").config();
const path = require("path");
const express = require("express");

const Rules = require("../shared/rules");
const Anthropic = require("./anthropic");
const store = require("./store");

const app = express();
app.use(express.json());

// Serve the client and shared modules.
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/shared", express.static(path.join(__dirname, "..", "shared")));

// Live game (restored from disk on boot).
let GAME = store.loadCurrent();

// ---- client-facing sanitization ---------------------------------
// Hide the Anthropic key (never in state) and any unresolved answer.
function sanitize(state) {
  if (!state) return null;
  const s = JSON.parse(JSON.stringify(state));
  // Don't ship the full question history (it contains past answers we don't need client-side).
  s.usedQuestionsCount = (state.usedQuestions || []).length;
  delete s.usedQuestions;
  delete s.usedFingerprints;

  if (s.pendingBattle && s.pendingBattle.question) {
    if (s.pendingBattle.status !== "round_result") {
      // Reveal only once the round is resolved: strip the answer and hints.
      const q = s.pendingBattle.question;
      q.answer = null;
      q.answerLabel = null;
      q.sourceNote = null;
      q.entity = null;
      q.factType = null;
      q.topic = null;
    }
  }
  return s;
}

function send(res, status) {
  res.json({ ok: true, state: sanitize(GAME) });
}
function fail(res, error, code) {
  res.status(code || 400).json({ ok: false, error });
}
function requireGame(res) {
  if (!GAME) { fail(res, "No active game. Start a new game.", 409); return false; }
  return true;
}

// Generate (or regenerate) the question for the current pending battle.
async function generateForPending() {
  const b = GAME.pendingBattle;
  if (!b) return;
  b.status = "awaiting_question";
  b.error = null;
  try {
    const q = await Anthropic.generateQuestion(b.category, GAME.usedQuestions);
    Rules.attachQuestion(GAME, q);
  } catch (e) {
    Rules.setBattleError(GAME, (e && e.message) || "Question generation failed. Try again.");
  }
  store.saveCurrent(GAME);
}

// ---- routes ------------------------------------------------------
app.get("/api/config", (req, res) => {
  res.json({
    model: Anthropic.MODEL,
    allowFallback: Anthropic.ALLOW_FALLBACK,
    hasKey: !!process.env.ANTHROPIC_API_KEY,
  });
});

app.get("/api/state", (req, res) => {
  res.json({ ok: true, state: sanitize(GAME) });
});

app.post("/api/new-game", (req, res) => {
  try {
    const players = (req.body && req.body.players) || [];
    GAME = Rules.setupGame(players);
    store.saveCurrent(GAME);
    send(res);
  } catch (e) {
    fail(res, e.message || "Failed to start game");
  }
});

app.post("/api/reinforce", (req, res) => {
  if (!requireGame(res)) return;
  const { territoryId, count } = req.body || {};
  const r = Rules.placeArmy(GAME, territoryId, count == null ? 1 : count);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  send(res);
});

app.post("/api/advance-phase", (req, res) => {
  if (!requireGame(res)) return;
  const r = Rules.advancePhase(GAME);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  send(res);
});

app.post("/api/attack/declare", async (req, res) => {
  if (!requireGame(res)) return;
  const { fromTerritoryId, toTerritoryId } = req.body || {};
  const r = Rules.declareAttack(GAME, fromTerritoryId, toTerritoryId);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  await generateForPending();
  send(res);
});

app.post("/api/attack/next", async (req, res) => {
  if (!requireGame(res)) return;
  const r = Rules.prepareNextRound(GAME);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  await generateForPending();
  send(res);
});

app.post("/api/attack/retry-question", async (req, res) => {
  if (!requireGame(res)) return;
  const b = GAME.pendingBattle;
  if (!b) return fail(res, "No battle in progress");
  if (b.status !== "error" && b.status !== "awaiting_question") {
    return fail(res, "Question already generated");
  }
  await generateForPending();
  send(res);
});

app.post("/api/attack/cancel", (req, res) => {
  if (!requireGame(res)) return;
  const b = GAME.pendingBattle;
  if (b && b.conqueredPending) return fail(res, "Cannot cancel after a capture — move troops in");
  const r = Rules.cancelBattle(GAME);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  send(res);
});

app.post("/api/attack/attacker-guess", (req, res) => {
  if (!requireGame(res)) return;
  const r = Rules.setAttackerGuess(GAME, (req.body || {}).guess);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  send(res);
});

app.post("/api/attack/defender-guess", (req, res) => {
  if (!requireGame(res)) return;
  const r = Rules.setDefenderGuess(GAME, (req.body || {}).guess);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  send(res);
});

app.post("/api/attack/dismiss", (req, res) => {
  if (!requireGame(res)) return;
  const r = Rules.dismissBattle(GAME);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  send(res);
});

app.post("/api/attack/move", (req, res) => {
  if (!requireGame(res)) return;
  const r = Rules.applyConquestMove(GAME, (req.body || {}).count);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  send(res);
});

app.post("/api/fortify", (req, res) => {
  if (!requireGame(res)) return;
  const { fromTerritoryId, toTerritoryId, count } = req.body || {};
  const r = Rules.fortify(GAME, fromTerritoryId, toTerritoryId, count);
  if (!r.ok) return fail(res, r.error);
  store.saveCurrent(GAME);
  send(res);
});

app.post("/api/save", (req, res) => {
  if (!requireGame(res)) return;
  const slot = store.saveNamed((req.body || {}).name, GAME);
  res.json({ ok: true, saved: slot, state: sanitize(GAME) });
});

app.get("/api/saves", (req, res) => {
  res.json({ ok: true, saves: store.listSaves() });
});

app.post("/api/load", (req, res) => {
  const data = store.loadNamed((req.body || {}).name);
  if (!data) return fail(res, "Save not found", 404);
  GAME = data;
  store.saveCurrent(GAME);
  send(res);
});

const PORT = process.env.PORT || 4318;
app.listen(PORT, () => {
  console.log(`Trivia Risk: Margin of Error — server on http://localhost:${PORT}`);
  console.log(`Question model: ${Anthropic.MODEL}` + (process.env.ANTHROPIC_API_KEY ? "" : "  (WARNING: ANTHROPIC_API_KEY not set)"));
});
