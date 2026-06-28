/* ============================================================
   ui.js — Rendering + interaction. Drives Game (rules) and
   aiTurn (opponent). Plain DOM, no framework.
   ============================================================ */

const SVGNS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

const UI = {
  selected: null,     // attack/fortify source territory id
  pending: null,      // {from,to,min,max,kind} for the move modal
  aiBusy: false,
};

// ---------------- SVG map construction ----------------

function buildMap() {
  const svg = $("map");
  svg.innerHTML = "";

  // Sea background.
  const bg = document.createElementNS(SVGNS, "rect");
  bg.setAttribute("x", 0); bg.setAttribute("y", 0);
  bg.setAttribute("width", 1000); bg.setAttribute("height", 600);
  bg.setAttribute("fill", "var(--sea)");
  svg.appendChild(bg);

  // Continent labels (centroid of member territories).
  for (const cont in CONTINENTS) {
    const members = Object.values(TERRITORIES).filter((t) => t.continent === cont);
    const cx = members.reduce((s, t) => s + t.pos[0], 0) / members.length;
    const cy = members.reduce((s, t) => s + t.pos[1], 0) / members.length;
    const lbl = document.createElementNS(SVGNS, "text");
    lbl.setAttribute("class", "cont-label");
    lbl.setAttribute("x", cx); lbl.setAttribute("y", cy);
    lbl.textContent = cont;
    svg.appendChild(lbl);
  }

  // Adjacency lines (draw once per pair).
  const drawn = new Set();
  for (const id in TERRITORIES) {
    for (const n of TERRITORIES[id].adj) {
      const key = [id, n].sort().join("|");
      if (drawn.has(key)) continue;
      drawn.add(key);
      const isWrap = WRAP_LINKS.some(([a, b]) => (a === id && b === n) || (a === n && b === id));
      if (isWrap) continue; // wrap links drawn separately as dashed
      line(svg, TERRITORIES[id].pos, TERRITORIES[n].pos, "sea-line");
    }
  }
  for (const [a, b] of WRAP_LINKS) line(svg, TERRITORIES[a].pos, TERRITORIES[b].pos, "sea-line wrap");

  // Territory nodes.
  for (const id in TERRITORIES) {
    const t = TERRITORIES[id];
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "terr-node");
    g.dataset.id = id;

    const c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("class", "terr-circle");
    c.setAttribute("cx", t.pos[0]); c.setAttribute("cy", t.pos[1]);
    c.setAttribute("r", 15);
    g.appendChild(c);

    const army = document.createElementNS(SVGNS, "text");
    army.setAttribute("class", "terr-army");
    army.setAttribute("x", t.pos[0]); army.setAttribute("y", t.pos[1]);
    g.appendChild(army);

    const name = document.createElementNS(SVGNS, "text");
    name.setAttribute("class", "terr-label");
    name.setAttribute("x", t.pos[0]); name.setAttribute("y", t.pos[1] + 26);
    name.textContent = t.name;
    g.appendChild(name);

    g.addEventListener("click", () => onTerritoryClick(id));
    svg.appendChild(g);
  }
}

function line(svg, p1, p2, cls) {
  const l = document.createElementNS(SVGNS, "line");
  l.setAttribute("x1", p1[0]); l.setAttribute("y1", p1[1]);
  l.setAttribute("x2", p2[0]); l.setAttribute("y2", p2[1]);
  l.setAttribute("class", cls);
  svg.appendChild(l);
}

// ---------------- Rendering ----------------

function render() {
  // Territory colors, armies, and selection state.
  for (const id in TERRITORIES) {
    const g = document.querySelector(`.terr-node[data-id="${id}"]`);
    const circle = g.querySelector(".terr-circle");
    const army = g.querySelector(".terr-army");
    circle.setAttribute("fill", Game.players[Game.owner[id]].color);
    army.textContent = Game.armies[id];

    circle.classList.remove("selectable", "selected", "target");
    if (Game.phase === "gameover") continue;
    if (id === UI.selected) circle.classList.add("selected");
  }
  highlightTargets();
  renderSidebar();
}

function highlightTargets() {
  const human = !curPlayer().isAI && Game.phase !== "gameover";
  if (!human) return;
  const mark = (id, cls) =>
    document.querySelector(`.terr-node[data-id="${id}"] .terr-circle`).classList.add(cls);

  if (Game.phase === "reinforce") {
    playerTerritories(Game.current).forEach((id) => mark(id, "selectable"));
  } else if (Game.phase === "attack") {
    if (UI.selected) {
      enemyNeighbors(UI.selected).forEach((id) => mark(id, "target"));
    } else {
      playerTerritories(Game.current)
        .filter((id) => Game.armies[id] > 1 && enemyNeighbors(id).length)
        .forEach((id) => mark(id, "selectable"));
    }
  } else if (Game.phase === "fortify" && !Game.fortified) {
    if (UI.selected) {
      connectedOwn(UI.selected).forEach((id) => mark(id, "target"));
    } else {
      playerTerritories(Game.current)
        .filter((id) => Game.armies[id] > 1 && connectedOwn(id).size > 0)
        .forEach((id) => mark(id, "selectable"));
    }
  }
}

function renderSidebar() {
  const p = curPlayer();
  $("turn-swatch").style.background = p.color;
  $("turn-name").textContent = p.name + (p.isAI ? " (AI)" : "");
  $("phase-name").textContent = Game.phase;
  $("turn-count").textContent = Game.turnCount;

  $("reinforce-box").hidden = !(Game.phase === "reinforce" && !p.isAI);
  $("reinforce-count").textContent = Game.reinforcements;

  // Hint text + advance button.
  const advance = $("btn-advance");
  advance.disabled = p.isAI;
  let hint = "";
  if (p.isAI) {
    hint = `<b>${p.name}</b> (AI) is plotting…`;
    advance.textContent = "AI thinking…";
  } else if (Game.phase === "reinforce") {
    hint = Game.reinforcements > 0
      ? `Click your territories to place <b>${Game.reinforcements}</b> armies.`
      : `All armies placed. Advance to attack.`;
    advance.textContent = "Begin attacks →";
    advance.disabled = Game.reinforcements > 0;
  } else if (Game.phase === "attack") {
    hint = UI.selected
      ? `Attacking from <b>${TERRITORIES[UI.selected].name}</b> — click a highlighted enemy. Click it again to keep rolling.`
      : `Select one of your territories (2+ armies) bordering an enemy.`;
    advance.textContent = "End attacks →";
  } else if (Game.phase === "fortify") {
    hint = Game.fortified
      ? `Fortification done. End your turn.`
      : (UI.selected
          ? `Move armies to a connected territory, or pick a different source.`
          : `Optional: move armies between connected territories (once).`);
    advance.textContent = "End turn ↻";
  } else if (Game.phase === "gameover") {
    hint = `Game over.`;
    advance.disabled = true;
  }
  $("hint").innerHTML = hint;

  // Player roster.
  const list = $("players-list");
  list.innerHTML = "";
  Game.players.forEach((pl) => {
    const terrs = playerTerritories(pl.id).length;
    const armies = playerTerritories(pl.id).reduce((s, id) => s + Game.armies[id], 0);
    const row = document.createElement("div");
    row.className = "player-row" + (pl.id === Game.current ? " active" : "") + (!pl.alive ? " dead" : "");
    row.innerHTML = `
      <span class="swatch" style="background:${pl.color}"></span>
      <span class="pname">${pl.name}${pl.isAI ? " <span style='color:var(--muted);font-weight:400'>AI</span>" : ""}</span>
      <span class="pstats">${terrs} lands · ${armies} armies</span>`;
    list.appendChild(row);
  });

  // Log.
  const box = $("logbox");
  box.innerHTML = Game.log.map((e) => `<div class="entry ${e.cls}">${e.text}</div>`).join("");
}

// ---------------- Dice rendering ----------------

function showDice(res) {
  const tray = $("dice-tray");
  tray.innerHTML = "";
  const pairs = Math.min(res.a.length, res.d.length);
  const col = (vals, cls) => {
    const c = document.createElement("div");
    c.className = "dice-col";
    vals.forEach((v, i) => {
      const d = document.createElement("div");
      d.className = "die " + cls;
      if (i < pairs) {
        const atkWins = res.a[i] > res.d[i];
        d.classList.add(cls === "atk" ? (atkWins ? "win" : "lose") : (atkWins ? "lose" : "win"));
      }
      d.textContent = v;
      c.appendChild(d);
    });
    return c;
  };
  tray.appendChild(col(res.a, "atk"));
  const vs = document.createElement("div"); vs.textContent = "⚔"; vs.style.opacity = ".6";
  tray.appendChild(vs);
  tray.appendChild(col(res.d, "def"));
}

function clearDice() { $("dice-tray").innerHTML = ""; }

// ---------------- Interaction ----------------

function onTerritoryClick(id) {
  if (UI.aiBusy || curPlayer().isAI || Game.phase === "gameover" || UI.pending) return;

  if (Game.phase === "reinforce") {
    if (Game.owner[id] === Game.current && Game.reinforcements > 0) {
      placeArmy(id, 1);
      if (Game.reinforcements === 0) logMsg(`${curPlayer().name} finished reinforcing.`);
      render();
    }
    return;
  }

  if (Game.phase === "attack") {
    if (UI.selected && enemyNeighbors(UI.selected).includes(id)) {
      doHumanAttack(UI.selected, id);
    } else if (Game.owner[id] === Game.current && Game.armies[id] > 1 && enemyNeighbors(id).length) {
      UI.selected = id; render();
    } else if (Game.owner[id] === Game.current) {
      UI.selected = null; render();
    }
    return;
  }

  if (Game.phase === "fortify" && !Game.fortified) {
    if (UI.selected && connectedOwn(UI.selected).has(id)) {
      openMoveModal({
        from: UI.selected, to: id, kind: "fortify",
        min: 1, max: Game.armies[UI.selected] - 1,
      });
    } else if (Game.owner[id] === Game.current && Game.armies[id] > 1 && connectedOwn(id).size > 0) {
      UI.selected = id; render();
    } else {
      UI.selected = null; render();
    }
  }
}

function doHumanAttack(from, to) {
  const res = attack(from, to);
  if (!res) return;
  showDice(res.result);
  const ft = TERRITORIES[from].name, tt = TERRITORIES[to].name;
  logMsg(`${ft} ⚔ ${tt}: [${res.result.a.join(",")}] vs [${res.result.d.join(",")}] — `
    + `you lose ${res.result.atkLoss}, they lose ${res.result.defLoss}.`, "attack");

  if (res.conquered) {
    logMsg(`${curPlayer().name} captured ${tt}!`, "info");
    if (res.eliminated !== null) {
      logMsg(`${Game.players[res.eliminated].name} has been eliminated!`, "bad");
    }
    const min = res.result.a.length;
    const max = Game.armies[from] - 1;
    if (max <= min) {
      moveAfterConquer(from, to, max);
      UI.selected = to;
      postAttackCheck();
      render();
    } else {
      openMoveModal({ from, to, kind: "conquer", min, max });
    }
  } else {
    render();
  }
}

function postAttackCheck() {
  if (Game.phase === "gameover") { render(); showWin(); }
}

// ---------------- Move modal (conquer + fortify) ----------------

function openMoveModal({ from, to, kind, min, max }) {
  UI.pending = { from, to, kind };
  $("move-title").textContent = kind === "conquer" ? "Occupy territory" : "Fortify";
  $("move-sub").textContent = kind === "conquer"
    ? `Move armies from ${TERRITORIES[from].name} into ${TERRITORIES[to].name} (at least ${min}).`
    : `Move armies from ${TERRITORIES[from].name} to ${TERRITORIES[to].name}.`;
  const slider = $("move-slider");
  slider.min = min; slider.max = max; slider.value = min;
  $("move-val").textContent = min;
  $("move-cancel").hidden = kind === "conquer"; // conquest must move at least min
  $("move-overlay").hidden = false;
}

function confirmMove() {
  const { from, to, kind } = UI.pending;
  const count = parseInt($("move-slider").value, 10);
  $("move-overlay").hidden = true;
  UI.pending = null;
  if (kind === "conquer") {
    moveAfterConquer(from, to, count);
    UI.selected = to;
    postAttackCheck();
  } else {
    fortify(from, to, count);
    logMsg(`${curPlayer().name} fortified ${TERRITORIES[to].name} with ${count}.`);
    UI.selected = null;
  }
  render();
}

// ---------------- Advance / turn flow ----------------

function onAdvance() {
  if (curPlayer().isAI || Game.phase === "gameover") return;
  UI.selected = null;
  clearDice();
  const wasFortify = Game.phase === "fortify";
  nextPhase();
  render();
  if (wasFortify && !curPlayer().isAI === false) {
    // moved into a new turn; if next is AI, run it
  }
  if (Game.phase === "gameover") { showWin(); return; }
  maybeRunAI();
}

// ---------------- AI driver ----------------

function maybeRunAI() {
  if (!curPlayer().isAI || Game.phase === "gameover") return;
  UI.aiBusy = true;
  render();
  const gen = aiTurn();
  const step = () => {
    const { value, done } = gen.next();
    if (done || Game.phase === "gameover") {
      UI.aiBusy = false;
      render();
      if (Game.phase === "gameover") { showWin(); return; }
      // After AI ends its turn, control returns; if next is AI too, continue.
      if (curPlayer().isAI) { maybeRunAI(); }
      return;
    }
    applyAIStep(value);
    const delay = value.type === "attack" ? 520 : value.type === "reinforce" ? 360 : 260;
    setTimeout(step, delay);
  };
  setTimeout(step, 500);
}

function applyAIStep(s) {
  switch (s.type) {
    case "reinforce":
      logMsg(`${curPlayer().name} reinforces ${TERRITORIES[s.id].name} (+${s.count}).`);
      break;
    case "attack":
      showDice(s.result);
      logMsg(`${TERRITORIES[s.from].name} ⚔ ${TERRITORIES[s.to].name}: `
        + `[${s.result.a.join(",")}] vs [${s.result.d.join(",")}].`, "attack");
      if (s.conquered) logMsg(`${curPlayer().name} captured ${TERRITORIES[s.to].name}!`, "info");
      break;
    case "eliminated":
      logMsg(`${Game.players[s.player].name} has been eliminated!`, "bad");
      break;
    case "fortify":
      logMsg(`${curPlayer().name} fortified ${TERRITORIES[s.to].name} with ${s.count}.`);
      break;
    case "phase": clearDice(); break;
  }
  render();
}

// ---------------- Win / setup ----------------

function showWin() {
  const w = Game.players[Game.winner];
  $("win-name").textContent = `${w.name} wins!`;
  $("win-sub").textContent = `${w.name} has conquered all 42 territories.`;
  $("win-overlay").hidden = false;
}

let setupChoice = { players: 3, humans: 1 };

function buildSetup() {
  const segP = $("seg-players");
  segP.innerHTML = "";
  for (let n = 2; n <= 6; n++) {
    const b = document.createElement("button");
    b.textContent = n;
    b.className = n === setupChoice.players ? "on" : "";
    b.onclick = () => { setupChoice.players = n; if (setupChoice.humans > n) setupChoice.humans = n; buildSetup(); };
    segP.appendChild(b);
  }
  const segH = $("seg-humans");
  segH.innerHTML = "";
  for (let h = 0; h <= setupChoice.players; h++) {
    const b = document.createElement("button");
    b.textContent = h;
    b.className = h === setupChoice.humans ? "on" : "";
    b.onclick = () => { setupChoice.humans = h; buildSetup(); };
    segH.appendChild(b);
  }
}

function startGame() {
  const { players, humans } = setupChoice;
  const configs = [];
  for (let i = 0; i < players; i++) {
    configs.push({ name: PLAYER_NAMES_DEFAULT[i], isAI: i >= humans });
  }
  setupGame(configs);
  $("setup-overlay").hidden = true;
  $("win-overlay").hidden = true;
  UI.selected = null;
  clearDice();
  render();
  maybeRunAI(); // in case player 1 is AI (humans === 0)
}

// ---------------- Wire up ----------------

function init() {
  buildMap();
  buildSetup();
  $("btn-start").onclick = startGame;
  $("btn-new").onclick = () => { $("setup-overlay").hidden = false; };
  $("win-new").onclick = () => { $("win-overlay").hidden = true; $("setup-overlay").hidden = false; };
  $("btn-advance").onclick = onAdvance;
  $("move-confirm").onclick = confirmMove;
  $("move-cancel").onclick = () => {
    if (UI.pending && UI.pending.kind === "fortify") { $("move-overlay").hidden = true; UI.pending = null; }
  };
  $("move-slider").oninput = (e) => { $("move-val").textContent = e.target.value; };
}

document.addEventListener("DOMContentLoaded", init);
