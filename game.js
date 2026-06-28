/* ============================================================
   game.js — Pure(ish) Risk rules engine. Holds game state and
   exposes mutating actions. No DOM here; ui.js drives it.
   ============================================================ */

const Game = {
  players: [],          // { id, name, color, isAI, alive }
  owner: {},            // territoryId -> playerId
  armies: {},           // territoryId -> count
  current: 0,           // index into players
  phase: "reinforce",   // reinforce | attack | fortify | gameover
  reinforcements: 0,    // armies left to place this turn
  fortified: false,     // one fortify move per turn
  turnCount: 0,
  winner: null,
  log: [],              // [{text, cls}]
  rng: Math.random,     // injectable for tests/determinism
};

function logMsg(text, cls = "") {
  Game.log.unshift({ text, cls });
  if (Game.log.length > 200) Game.log.pop();
}

// ---- Setup --------------------------------------------------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Game.rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setupGame(playerConfigs) {
  // playerConfigs: [{ name, isAI }]
  const n = playerConfigs.length;
  Game.players = playerConfigs.map((p, i) => ({
    id: i, name: p.name, color: PLAYER_COLORS[i], isAI: p.isAI, alive: true,
  }));
  Game.owner = {};
  Game.armies = {};
  Game.current = 0;
  Game.phase = "reinforce";
  Game.fortified = false;
  Game.turnCount = 1;
  Game.winner = null;
  Game.log = [];

  // Deal territories round-robin.
  const ids = shuffle(Object.keys(TERRITORIES));
  ids.forEach((id, i) => {
    Game.owner[id] = i % n;
    Game.armies[id] = 1;
  });

  // Distribute remaining starting armies randomly across each player's lands.
  const startArmies = START_ARMIES[n];
  for (let p = 0; p < n; p++) {
    const mine = ids.filter((id) => Game.owner[id] === p);
    let remaining = startArmies - mine.length;
    while (remaining > 0) {
      const t = mine[Math.floor(Game.rng() * mine.length)];
      Game.armies[t]++;
      remaining--;
    }
  }

  Game.reinforcements = calcReinforcements(0);
  logMsg(`Game started with ${n} players. ${Game.players[0].name} goes first.`, "info");
}

// ---- Queries ------------------------------------------------

function playerTerritories(p) {
  return Object.keys(TERRITORIES).filter((id) => Game.owner[id] === p);
}

function ownsContinent(p, cont) {
  return Object.keys(TERRITORIES).every(
    (id) => TERRITORIES[id].continent !== cont || Game.owner[id] === p
  );
}

function calcReinforcements(p) {
  const count = playerTerritories(p).length;
  let armies = Math.max(3, Math.floor(count / 3));
  for (const cont in CONTINENTS) {
    if (ownsContinent(p, cont)) armies += CONTINENTS[cont].bonus;
  }
  return armies;
}

function enemyNeighbors(id) {
  return TERRITORIES[id].adj.filter((n) => Game.owner[n] !== Game.owner[id]);
}

function isBorder(id) {
  return enemyNeighbors(id).length > 0;
}

// BFS over a player's own connected territories (for fortify reachability).
function connectedOwn(from) {
  const p = Game.owner[from];
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of TERRITORIES[cur].adj) {
      if (Game.owner[n] === p && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  seen.delete(from);
  return seen;
}

// ---- Phase actions ------------------------------------------

function placeArmy(id, count = 1) {
  if (Game.phase !== "reinforce") return false;
  if (Game.owner[id] !== Game.current) return false;
  const n = Math.min(count, Game.reinforcements);
  if (n <= 0) return false;
  Game.armies[id] += n;
  Game.reinforcements -= n;
  return true;
}

function rollDice(n) {
  return Array.from({ length: n }, () => 1 + Math.floor(Game.rng() * 6)).sort((a, b) => b - a);
}

// Resolve one round of combat. Returns roll details and losses.
function resolveBattle(fromArmies, toArmies) {
  const atkDice = Math.min(3, fromArmies - 1);
  const defDice = Math.min(2, toArmies);
  const a = rollDice(atkDice);
  const d = rollDice(defDice);
  let atkLoss = 0, defLoss = 0;
  const pairs = Math.min(a.length, d.length);
  for (let i = 0; i < pairs; i++) {
    if (a[i] > d[i]) defLoss++; else atkLoss++; // ties favor defender
  }
  return { a, d, atkLoss, defLoss };
}

/* Execute a single attack roll from -> to.
   Returns { result, conquered, eliminated } or null if illegal. */
function attack(from, to) {
  if (Game.phase !== "attack") return null;
  if (Game.owner[from] !== Game.current) return null;
  if (Game.owner[to] === Game.current) return null;
  if (!TERRITORIES[from].adj.includes(to)) return null;
  if (Game.armies[from] < 2) return null;

  const r = resolveBattle(Game.armies[from], Game.armies[to]);
  Game.armies[from] -= r.atkLoss;
  Game.armies[to] -= r.defLoss;

  let conquered = false, eliminated = null;
  if (Game.armies[to] <= 0) {
    conquered = true;
    const loser = Game.owner[to];
    Game.owner[to] = Game.current;
    Game.armies[to] = 0; // armies moved in by moveAfterConquer
    if (playerTerritories(loser).length === 0) {
      eliminated = loser;
      Game.players[loser].alive = false;
    }
  }
  return { result: r, conquered, eliminated, from, to };
}

// Move armies into a freshly conquered territory (min = attacking dice count).
function moveAfterConquer(from, to, count) {
  Game.armies[from] -= count;
  Game.armies[to] += count;
}

function canFortifyBetween(from, to) {
  return Game.owner[from] === Game.current &&
         Game.owner[to] === Game.current &&
         from !== to &&
         connectedOwn(from).has(to);
}

function fortify(from, to, count) {
  if (Game.phase !== "fortify" || Game.fortified) return false;
  if (!canFortifyBetween(from, to)) return false;
  if (count < 1 || count > Game.armies[from] - 1) return false;
  Game.armies[from] -= count;
  Game.armies[to] += count;
  Game.fortified = true;
  return true;
}

// ---- Turn flow ----------------------------------------------

function checkWinner() {
  const alive = Game.players.filter((p) => p.alive);
  if (alive.length === 1) {
    Game.winner = alive[0].id;
    Game.phase = "gameover";
    logMsg(`${alive[0].name} conquers the world! 🏆`, "win");
    return true;
  }
  return false;
}

function nextPhase() {
  if (Game.phase === "reinforce" && Game.reinforcements === 0) {
    Game.phase = "attack";
  } else if (Game.phase === "attack") {
    Game.phase = "fortify";
  } else if (Game.phase === "fortify") {
    endTurn();
  }
}

function endTurn() {
  if (checkWinner()) return;
  // Advance to the next living player.
  do {
    Game.current = (Game.current + 1) % Game.players.length;
  } while (!Game.players[Game.current].alive);

  if (Game.current === firstAlive()) Game.turnCount++;
  Game.phase = "reinforce";
  Game.fortified = false;
  Game.reinforcements = calcReinforcements(Game.current);
  logMsg(`— ${Game.players[Game.current].name}'s turn (${Game.reinforcements} reinforcements) —`, "info");
}

function firstAlive() {
  return Game.players.findIndex((p) => p.alive);
}

function curPlayer() { return Game.players[Game.current]; }
