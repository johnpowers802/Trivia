/* ============================================================
   server/store.js — file-based game persistence.
   - current.json: the live game (auto-saved after every action).
   - saves/<name>.json: named save slots.
   ============================================================ */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const SAVES_DIR = path.join(DATA_DIR, "saves");
const CURRENT = path.join(DATA_DIR, "current.json");

function ensureDirs() {
  fs.mkdirSync(SAVES_DIR, { recursive: true });
}

function writeJson(file, obj) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return null; }
}

// Auto-save the live game.
function saveCurrent(state) {
  if (!state) return;
  state.updatedAt = Date.now();
  writeJson(CURRENT, state);
}

function loadCurrent() {
  return readJson(CURRENT);
}

function safeName(name) {
  return String(name || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 60) || "save";
}

function saveNamed(name, state) {
  const slot = safeName(name);
  state.updatedAt = Date.now();
  writeJson(path.join(SAVES_DIR, slot + ".json"), state);
  return slot;
}

function loadNamed(name) {
  return readJson(path.join(SAVES_DIR, safeName(name) + ".json"));
}

function listSaves() {
  ensureDirs();
  return fs.readdirSync(SAVES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const data = readJson(path.join(SAVES_DIR, f));
      const name = f.replace(/\.json$/, "");
      if (!data) return { name, valid: false };
      return {
        name,
        valid: true,
        players: (data.players || []).map((p) => p.name),
        turn: data.turnCount,
        phase: data.phase,
        gameOver: !!data.gameOver,
        updatedAt: data.updatedAt,
      };
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

module.exports = { saveCurrent, loadCurrent, saveNamed, loadNamed, listSaves, DATA_DIR };
