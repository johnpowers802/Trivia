/* ============================================================
   public/app.js — Trivia Risk client.
   Thin renderer: the server is authoritative. Every action POSTs
   to the API and re-renders from the returned state.
   ============================================================ */
const MAP = window.TriviaRiskMap;
const SHAPES = window.TriviaRiskShapes;
const { TERRITORIES, CATEGORY_BADGES, PLAYER_COLORS, PLAYER_NAMES_DEFAULT } = MAP;
const SVGNS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

let S = null;          // latest server state
const UI = {
  selected: null,      // selected source territory (attack/fortify)
  commit: null,        // { from, to } pending attack
  battleLoading: false,
  setupColors: [],     // chosen colors during setup
};

// ---------------- API ----------------
async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body || {}),
  });
  let data;
  try { data = await res.json(); } catch (e) { data = { ok: false, error: "Bad server response" }; }
  return data;
}

function toast(msg) {
  const el = $("terr-info");
  el.textContent = msg;
  el.style.color = "#ffb3b3";
  setTimeout(() => { el.style.color = ""; }, 2200);
}

// Apply a server result: on success set state + render; on failure toast.
function apply(data) {
  if (!data) return false;
  if (data.ok === false) { toast(data.error || "Action failed"); return false; }
  if (data.state) S = data.state;
  render();
  return true;
}

// ---------------- map ----------------
let CENTERS = {};
function buildMap() {
  const svg = $("map");
  svg.innerHTML = "";
  const groups = {};

  // 1) Territory landmass paths (interactive groups).
  for (const id in TERRITORIES) {
    if (!SHAPES.PATHS[id]) continue;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "terr-node");
    g.dataset.id = id;
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("class", "terr-shape");
    path.setAttribute("d", SHAPES.PATHS[id]);
    g.appendChild(path);
    g.addEventListener("click", () => onTerritoryClick(id));
    g.addEventListener("mouseenter", () => showTerrInfo(id));
    svg.appendChild(g);
    groups[id] = { g, path };
  }

  // 2) Compute each territory's centroid + the union bounding box.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  CENTERS = {};
  for (const id in groups) {
    const bb = groups[id].path.getBBox();
    CENTERS[id] = [bb.x + bb.width / 2, bb.y + bb.height / 2];
    minX = Math.min(minX, bb.x); minY = Math.min(minY, bb.y);
    maxX = Math.max(maxX, bb.x + bb.width); maxY = Math.max(maxY, bb.y + bb.height);
  }
  const pad = 24;
  const vb = [minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2];
  svg.setAttribute("viewBox", vb.join(" "));

  // 3) Sea background (insert beneath everything).
  const bg = document.createElementNS(SVGNS, "rect");
  bg.setAttribute("x", vb[0]); bg.setAttribute("y", vb[1]);
  bg.setAttribute("width", vb[2]); bg.setAttribute("height", vb[3]);
  bg.setAttribute("fill", "var(--sea)");
  svg.insertBefore(bg, svg.firstChild);

  // 4) Dotted sea routes (above the sea, beneath the badges).
  const routes = document.createElementNS(SVGNS, "g");
  for (const [a, b] of SHAPES.SEA_ROUTES) {
    if (!CENTERS[a] || !CENTERS[b]) continue;
    const l = document.createElementNS(SVGNS, "line");
    l.setAttribute("x1", CENTERS[a][0]); l.setAttribute("y1", CENTERS[a][1]);
    l.setAttribute("x2", CENTERS[b][0]); l.setAttribute("y2", CENTERS[b][1]);
    l.setAttribute("class", "sea-route");
    routes.appendChild(l);
  }
  svg.insertBefore(routes, bg.nextSibling);

  // 5) Troop badges, category icon, and name per territory.
  for (const id in groups) {
    const [cx, cy] = CENTERS[id];
    const g = groups[id].g;
    const badge = document.createElementNS(SVGNS, "circle");
    badge.setAttribute("class", "terr-badge");
    badge.setAttribute("cx", cx); badge.setAttribute("cy", cy); badge.setAttribute("r", 14);
    g.appendChild(badge);
    const army = document.createElementNS(SVGNS, "text");
    army.setAttribute("class", "terr-army");
    army.setAttribute("x", cx); army.setAttribute("y", cy);
    g.appendChild(army);
    const cat = document.createElementNS(SVGNS, "text");
    cat.setAttribute("class", "terr-cat");
    cat.setAttribute("x", cx + 14); cat.setAttribute("y", cy - 11);
    g.appendChild(cat);
    const name = document.createElementNS(SVGNS, "text");
    name.setAttribute("class", "terr-label");
    name.setAttribute("x", cx); name.setAttribute("y", cy + 26);
    name.textContent = TERRITORIES[id].name;
    g.appendChild(name);
  }
}

function showTerrInfo(id) {
  if (!S) return;
  const t = TERRITORIES[id];
  const cat = S.categories[id];
  const owner = S.players[S.owner[id]];
  $("terr-info").textContent = `${t.name} — ${cat}  ·  ${owner.name}: ${S.armies[id]} troops`;
}

// ---------------- render ----------------
function render() {
  if (!S) return;
  for (const id in TERRITORIES) {
    const g = document.querySelector(`.terr-node[data-id="${id}"]`);
    if (!g) continue;
    const shape = g.querySelector(".terr-shape");
    const army = g.querySelector(".terr-army");
    const cat = g.querySelector(".terr-cat");
    shape.setAttribute("fill", S.players[S.owner[id]].color);
    army.textContent = S.armies[id];
    const badge = CATEGORY_BADGES[S.categories[id]];
    cat.textContent = badge ? badge.icon : "";
    shape.classList.remove("selectable", "selected", "target");
    if (id === UI.selected) shape.classList.add("selected");
  }
  highlightTargets();
  renderSidebar();
  renderBattle();
  if (S.gameOver) showWin(); else $("win-overlay").hidden = true;
}

function isMyTurnInteractive() {
  return S && !S.gameOver && !S.pendingBattle;
}

function highlightTargets() {
  if (!isMyTurnInteractive()) return;
  const mark = (id, cls) => {
    const el = document.querySelector(`.terr-node[data-id="${id}"] .terr-shape`);
    if (el) el.classList.add(cls);
  };
  const mine = ownTerritories();
  if (S.phase === "reinforce") {
    mine.forEach((id) => mark(id, "selectable"));
  } else if (S.phase === "attack") {
    if (UI.selected) {
      enemyNeighbors(UI.selected).forEach((id) => mark(id, "target"));
    } else {
      mine.filter((id) => S.armies[id] > 1 && enemyNeighbors(id).length).forEach((id) => mark(id, "selectable"));
    }
  } else if (S.phase === "fortify" && !S.fortified) {
    if (UI.selected) {
      connectedOwn(UI.selected).forEach((id) => mark(id, "target"));
    } else {
      mine.filter((id) => S.armies[id] > 1 && connectedOwn(id).size > 0).forEach((id) => mark(id, "selectable"));
    }
  }
}

function ownTerritories() {
  return Object.keys(TERRITORIES).filter((id) => S.owner[id] === S.current);
}
function enemyNeighbors(id) {
  return TERRITORIES[id].adj.filter((n) => S.owner[n] !== S.owner[id]);
}
function connectedOwn(from) {
  const p = S.owner[from];
  const seen = new Set([from]); const stack = [from];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of TERRITORIES[cur].adj) {
      if (S.owner[n] === p && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  seen.delete(from);
  return seen;
}

function renderSidebar() {
  const p = S.players[S.current];
  $("turn-swatch").style.background = p.color;
  $("turn-name").textContent = p.name;
  $("phase-name").textContent = S.gameOver ? "game over" : S.phase;
  $("turn-count").textContent = S.turnCount;

  $("reinforce-box").hidden = !(S.phase === "reinforce" && !S.gameOver);
  $("reinforce-count").textContent = S.reinforcements;

  const advance = $("btn-advance");
  let hint = "";
  advance.disabled = S.gameOver || !!S.pendingBattle;
  if (S.gameOver) {
    hint = "Game over.";
    advance.textContent = "—";
  } else if (S.pendingBattle) {
    hint = "Resolve the trivia duel to continue.";
    advance.textContent = "Battle in progress";
  } else if (S.phase === "reinforce") {
    hint = S.reinforcements > 0
      ? `<b>${p.name}</b>, click your territories to place <b>${S.reinforcements}</b> armies.`
      : "All armies placed. Advance to attack.";
    advance.textContent = "Begin attacks →";
    advance.disabled = S.reinforcements > 0;
  } else if (S.phase === "attack") {
    hint = UI.selected
      ? `Attacking from <b>${TERRITORIES[UI.selected].name}</b> — click a highlighted enemy.`
      : `<b>${p.name}</b>, pick a territory (2+ troops) bordering an enemy to attack.`;
    advance.textContent = "End attacks →";
  } else if (S.phase === "fortify") {
    hint = S.fortified
      ? "Fortification used. End your turn."
      : (UI.selected
        ? "Click a connected territory to move troops, or pick a different source."
        : "Optional: move troops between two connected territories (once).");
    advance.textContent = "End turn ↻";
  }
  $("hint").innerHTML = hint;

  const list = $("players-list");
  list.innerHTML = "";
  S.players.forEach((pl) => {
    const terrs = Object.keys(TERRITORIES).filter((id) => S.owner[id] === pl.id).length;
    const armies = Object.keys(TERRITORIES).filter((id) => S.owner[id] === pl.id).reduce((s, id) => s + S.armies[id], 0);
    const row = document.createElement("div");
    row.className = "player-row" + (pl.id === S.current ? " active" : "") + (terrs === 0 ? " dead" : "");
    row.innerHTML = `<span class="swatch" style="background:${pl.color}"></span>
      <span class="pname">${escapeHtml(pl.name)}</span>
      <span class="pstats">${terrs} lands · ${armies} troops</span>`;
    list.appendChild(row);
  });

  const box = $("logbox");
  box.innerHTML = S.history.slice().reverse().map(
    (e) => `<div class="entry ${e.type}">${escapeHtml(e.message)}</div>`
  ).join("");
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---------------- interaction ----------------
function onTerritoryClick(id) {
  if (!isMyTurnInteractive()) return;

  if (S.phase === "reinforce") {
    if (S.owner[id] === S.current && S.reinforcements > 0) {
      api("/api/reinforce", { territoryId: id, count: 1 }).then(apply);
    }
    return;
  }

  if (S.phase === "attack") {
    if (UI.selected && enemyNeighbors(UI.selected).includes(id)) {
      startAttack(UI.selected, id);
    } else if (S.owner[id] === S.current && S.armies[id] > 1 && enemyNeighbors(id).length) {
      UI.selected = id; render();
    } else if (S.owner[id] === S.current) {
      UI.selected = null; render();
    }
    return;
  }

  if (S.phase === "fortify" && !S.fortified) {
    if (UI.selected && connectedOwn(UI.selected).has(id)) {
      const from = UI.selected;
      const max = S.armies[from] - 1;
      const raw = window.prompt(`Move how many troops from ${TERRITORIES[from].name} to ${TERRITORIES[id].name}? (1–${max})`, String(max));
      if (raw === null) return;
      const count = parseInt(raw, 10);
      if (!isFinite(count) || count < 1 || count > max) { toast("Invalid troop count"); return; }
      api("/api/fortify", { fromTerritoryId: from, toTerritoryId: id, count }).then((d) => { UI.selected = null; apply(d); });
    } else if (S.owner[id] === S.current && S.armies[id] > 1 && connectedOwn(id).size > 0) {
      UI.selected = id; render();
    } else {
      UI.selected = null; render();
    }
  }
}

// ---------------- start an attack ----------------
function startAttack(from, to) {
  UI.selected = null;
  UI.battleLoading = true;
  $("battle-overlay").hidden = false;
  showBattlePanels("loading");
  const badge = CATEGORY_BADGES[S.categories[to]] || { color: "#888", icon: "" };
  $("battle-cat").textContent = `${badge.icon} ${S.categories[to]}`;
  $("battle-cat").style.background = badge.color;
  $("battle-route").textContent = `${TERRITORIES[from].name} → ${TERRITORIES[to].name}`;
  api("/api/attack/declare", { fromTerritoryId: from, toTerritoryId: to })
    .then((d) => { UI.battleLoading = false; apply(d); });
}

// ---------------- battle modal ----------------
function showBattlePanels(which) {
  $("battle-loading").hidden = which !== "loading";
  $("battle-error").hidden = which !== "error";
  $("battle-body").hidden = which !== "body";
}

function renderBattle() {
  const b = S.pendingBattle;
  if (!b) {
    if (!UI.battleLoading) $("battle-overlay").hidden = true;
    return;
  }
  $("battle-overlay").hidden = false;

  const badge = CATEGORY_BADGES[b.category] || { color: "#888", icon: "" };
  $("battle-cat").textContent = `${badge.icon} ${b.category}`;
  $("battle-cat").style.background = badge.color;
  const atkName = S.players[b.attackerPlayerId].name;
  const defName = S.players[b.defenderPlayerId].name;
  $("battle-route").textContent =
    `${TERRITORIES[b.fromTerritoryId].name} (${S.armies[b.fromTerritoryId]}) → ${TERRITORIES[b.toTerritoryId].name} (${S.armies[b.toTerritoryId]})`;

  if (b.status === "awaiting_question") { showBattlePanels("loading"); return; }
  if (b.status === "error") {
    showBattlePanels("error");
    $("battle-error-msg").textContent = b.error || "Question generation failed. Try again.";
    return;
  }

  showBattlePanels("body");
  if (b.question) $("battle-question").textContent = b.question.question;
  $("commit-info").textContent =
    `Round ${b.round} · closest guess wins (ties → attacker). Loser loses 1 troop. ` +
    `${atkName}: ${S.armies[b.fromTerritoryId]} troops · ${defName}: ${S.armies[b.toTerritoryId]} troops`;

  const unit = (b.question && b.question.unit) ? b.question.unit : "";
  $("atk-unit").textContent = unit;
  $("def-unit").textContent = unit;

  $("stage-attacker").hidden = b.status !== "attacker_guess";
  $("stage-defender").hidden = b.status !== "defender_guess";
  $("battle-result").hidden = b.status !== "round_result";
  $("stage-move").hidden = !(b.status === "round_result" && b.conqueredPending);
  // Action buttons (Next / Retreat / Continue) handled in renderResult.
  $("result-actions").hidden = b.status !== "round_result";

  if (b.status === "attacker_guess") {
    $("atk-label").textContent = `${atkName} (attacker), enter your numeric guess:`;
    $("atk-err").textContent = "";
    const inp = $("atk-guess");
    if (document.activeElement !== inp) { inp.value = ""; inp.focus(); }
  } else if (b.status === "defender_guess") {
    $("atk-locked").textContent = `${atkName} locked in: ${b.attackerGuess}`;
    $("def-label").textContent = `${defName} (defender), enter your numeric guess (you may copy the attacker):`;
    $("def-err").textContent = "";
    const inp = $("def-guess");
    if (document.activeElement !== inp) { inp.value = ""; inp.focus(); }
  } else if (b.status === "round_result") {
    renderResult(b);
  }
}

function renderResult(b) {
  const r = b.lastResult;
  const atkName = S.players[b.attackerPlayerId].name;
  const defName = S.players[b.defenderPlayerId].name;
  const winName = r.attackerWon ? atkName : defName;
  const loserName = r.loser === "defender" ? defName : atkName;

  $("battle-result").innerHTML = `
    <div class="answer">Answer: ${escapeHtml(r.answerLabel)}${r.answerUnit ? " " + escapeHtml(r.answerUnit) : ""}</div>
    <div class="winner">🏆 ${escapeHtml(winName)} wins round ${r.round}${r.tie ? " (tie → attacker)" : ""}</div>
    <table>
      <tr><th></th><th class="${r.attackerWon ? "col-win" : ""}">${escapeHtml(atkName)} (atk)</th><th class="${!r.attackerWon ? "col-win" : ""}">${escapeHtml(defName)} (def)</th></tr>
      <tr><td>Guess</td><td>${r.attackerGuess}</td><td>${r.defenderGuess}</td></tr>
      <tr><td>Error points (lower = closer)</td><td class="${r.attackerWon ? "col-win" : ""}">${r.attackerError}</td><td class="${!r.attackerWon ? "col-win" : ""}">${r.defenderError}</td></tr>
    </table>
    <div class="dmg"><b>${escapeHtml(loserName)}</b> loses 1 troop.
    ${r.conquered ? `<br><b style="color:var(--gold)">${escapeHtml(TERRITORIES[b.toTerritoryId].name)} captured!</b>` : ""}
    ${r.attackEnded && !r.conquered ? `<br><b style="color:#ffb3b3">Attack repelled — the assault ends.</b>` : ""}
    <br><span class="muted">${escapeHtml(TERRITORIES[b.fromTerritoryId].name)}: ${r.fromArmies} · ${escapeHtml(TERRITORIES[b.toTerritoryId].name)}: ${r.toArmies} troops</span></div>
  `;

  // Buttons: capture -> move; defender win -> Continue (ends); attacker win -> Next/Retreat.
  const canContinue = r.attackerWon && !r.conquered && S.armies[b.fromTerritoryId] >= 2;
  $("btn-next").hidden = !canContinue;
  $("btn-retreat").hidden = !canContinue;
  $("btn-result-close").hidden = !(b.attackEnded || (r.attackerWon && !r.conquered && !canContinue));

  if (r.conquered) {
    const from = b.fromTerritoryId;
    const max = Math.max(1, S.armies[from] - 1);
    const sl = $("move-slider");
    sl.min = 1; sl.max = max; sl.value = max;
    $("move-val").textContent = sl.value;
    $("move-label").textContent = `Captured ${TERRITORIES[b.toTerritoryId].name}! Move troops in from ${TERRITORIES[from].name} (1–${max}):`;
  }
}

// ---------------- win ----------------
function showWin() {
  if ($("win-overlay").hidden === false) return;
  const w = S.players[S.winner];
  $("win-name").textContent = `${w.name} wins!`;
  $("win-sub").textContent = `Conquered the world in ${S.turnCount} turns.`;
  const battles = S.history.filter((e) => e.type === "battle_resolved").length;
  const captures = S.history.filter((e) => e.type === "territory_captured").length;
  const recent = S.history.slice(-12).reverse().map((e) => `• ${escapeHtml(e.message)}`).join("<br>");
  $("win-summary").innerHTML = `<b>${battles}</b> trivia duels fought · <b>${captures}</b> territories captured<br><br>${recent}`;
  $("win-overlay").hidden = false;
}

// ---------------- setup ----------------
let setupCount = 3;
function buildSetup() {
  const seg = $("seg-players");
  seg.innerHTML = "";
  for (let n = 2; n <= 4; n++) {
    const btn = document.createElement("button");
    btn.textContent = n + " players";
    btn.className = n === setupCount ? "on" : "";
    btn.onclick = () => { setupCount = n; buildSetup(); };
    seg.appendChild(btn);
  }
  const rows = $("player-rows");
  rows.innerHTML = "";
  UI.setupColors = UI.setupColors.slice(0, setupCount);
  for (let i = 0; i < setupCount; i++) {
    if (UI.setupColors[i] == null) UI.setupColors[i] = PLAYER_COLORS[i];
    const row = document.createElement("div");
    row.className = "psetup";
    const input = document.createElement("input");
    input.type = "text"; input.value = PLAYER_NAMES_DEFAULT[i]; input.dataset.idx = i;
    input.maxLength = 18;
    row.appendChild(input);
    const colors = document.createElement("div");
    colors.className = "colors";
    PLAYER_COLORS.forEach((col) => {
      const c = document.createElement("div");
      c.className = "c" + (UI.setupColors[i] === col ? " on" : "");
      c.style.background = col;
      c.onclick = () => { UI.setupColors[i] = col; buildSetup(); };
      colors.appendChild(c);
    });
    row.appendChild(colors);
    rows.appendChild(row);
  }
}

function startGame() {
  const inputs = document.querySelectorAll("#player-rows input");
  const players = [];
  inputs.forEach((inp, i) => {
    players.push({ name: inp.value.trim() || PLAYER_NAMES_DEFAULT[i], color: UI.setupColors[i] || PLAYER_COLORS[i] });
  });
  api("/api/new-game", { players }).then((d) => {
    if (apply(d)) { $("setup-overlay").hidden = true; UI.selected = null; }
  });
}

// ---------------- save / load ----------------
let slMode = "save";
function openSaveLoad(mode) {
  slMode = mode;
  $("sl-title").textContent = mode === "save" ? "Save game" : "Load game";
  $("sl-save").hidden = mode !== "save";
  $("btn-sl-confirm").hidden = mode !== "save";
  $("saveload-overlay").hidden = false;
  api("/api/saves").then((d) => {
    const list = $("sl-list");
    if (!d.saves || !d.saves.length) { list.innerHTML = `<div class="muted">No saved games yet.</div>`; return; }
    list.innerHTML = "";
    d.saves.forEach((sv) => {
      const item = document.createElement("div");
      item.className = "save-item";
      const when = sv.updatedAt ? new Date(sv.updatedAt).toLocaleString() : "";
      item.innerHTML = `<div><b>${escapeHtml(sv.name)}</b><div class="meta">${(sv.players || []).join(", ")} · turn ${sv.turn || "?"} · ${escapeHtml(sv.phase || "")}${sv.gameOver ? " · finished" : ""}<br>${when}</div></div>`;
      const btn = document.createElement("button");
      btn.className = "primary"; btn.textContent = "Load";
      btn.onclick = () => {
        api("/api/load", { name: sv.name }).then((d2) => { if (apply(d2)) { $("saveload-overlay").hidden = true; $("setup-overlay").hidden = true; } });
      };
      item.appendChild(btn);
      list.appendChild(item);
    });
  });
}

// ---------------- wire up ----------------
function wire() {
  $("btn-start").onclick = startGame;
  $("btn-new").onclick = () => { buildSetup(); $("setup-overlay").hidden = false; };
  $("btn-win-new").onclick = () => { $("win-overlay").hidden = true; buildSetup(); $("setup-overlay").hidden = false; };
  $("btn-advance").onclick = () => api("/api/advance-phase", {}).then((d) => { UI.selected = null; apply(d); });

  $("btn-save").onclick = () => openSaveLoad("save");
  $("btn-load").onclick = () => openSaveLoad("load");
  $("btn-sl-close").onclick = () => { $("saveload-overlay").hidden = true; };
  $("btn-sl-confirm").onclick = () => {
    const name = $("sl-name").value.trim() || ("game-" + Date.now());
    api("/api/save", { name }).then((d) => { if (d.ok) { toast("Saved as " + d.saved); $("saveload-overlay").hidden = true; } else toast(d.error); });
  };

  // battle modal
  $("btn-retry-q").onclick = () => { showBattlePanels("loading"); api("/api/attack/retry-question", {}).then(apply); };
  $("btn-cancel-attack").onclick = () => api("/api/attack/cancel", {}).then((d) => { UI.battleLoading = false; apply(d); });
  $("btn-atk-submit").onclick = () => submitGuess("attacker");
  $("atk-guess").addEventListener("keydown", (e) => { if (e.key === "Enter") submitGuess("attacker"); });
  $("btn-def-submit").onclick = () => submitGuess("defender");
  $("def-guess").addEventListener("keydown", (e) => { if (e.key === "Enter") submitGuess("defender"); });
  $("btn-next").onclick = () => { showBattlePanels("loading"); api("/api/attack/next", {}).then(apply); };
  $("btn-retreat").onclick = () => api("/api/attack/cancel", {}).then(apply);
  $("btn-result-close").onclick = () => api("/api/attack/dismiss", {}).then(apply);
  $("move-slider").oninput = (e) => { $("move-val").textContent = e.target.value; };
  $("btn-move-confirm").onclick = () => api("/api/attack/move", { count: parseInt($("move-slider").value, 10) }).then(apply);
}

function submitGuess(who) {
  if (who === "attacker") {
    const v = $("atk-guess").value;
    api("/api/attack/attacker-guess", { guess: v }).then((d) => {
      if (d.ok === false) { $("atk-err").textContent = d.error; } else apply(d);
    });
  } else {
    const v = $("def-guess").value;
    api("/api/attack/defender-guess", { guess: v }).then((d) => {
      if (d.ok === false) { $("def-err").textContent = d.error; } else apply(d);
    });
  }
}

// ---------------- boot ----------------
async function boot() {
  buildMap();
  buildSetup();
  wire();
  const cfg = await api("/api/config");
  if (cfg && !cfg.hasKey) {
    $("api-note").textContent = "⚠ ANTHROPIC_API_KEY is not set on the server — trivia questions can't be generated until it is.";
  } else if (cfg) {
    $("api-note").textContent = `Questions generated by ${cfg.model}.` + (cfg.allowFallback ? " (test fallback ON)" : "");
  }
  const data = await api("/api/state");
  if (data && data.state) {
    S = data.state;
    $("setup-overlay").hidden = true;
    render();
  } else {
    $("setup-overlay").hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", boot);
