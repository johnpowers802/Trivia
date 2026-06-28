/* ============================================================
   ai.js — Computer player. A turn is a generator of "steps" so
   the UI can animate them one at a time with delays.
   Strategy is intentionally simple but competent:
     reinforce -> stack borders that have good attack odds
     attack    -> press favorable fights, stop when risky
     fortify   -> feed the front line from a safe interior
   ============================================================ */

function* aiTurn() {
  const me = Game.current;

  // ---------- Reinforce ----------
  while (Game.reinforcements > 0) {
    const borders = playerTerritories(me).filter(isBorder);
    if (borders.length === 0) break;
    // Prefer the border with the best single attack opportunity, then
    // the one most outnumbered by neighbors (needs defense).
    borders.sort((a, b) => aiBorderScore(b) - aiBorderScore(a));
    const target = borders[0];
    const chunk = Math.min(Game.reinforcements, Math.max(1, Math.ceil(Game.reinforcements / 2)));
    placeArmy(target, chunk);
    yield { type: "reinforce", id: target, count: chunk };
  }
  nextPhase(); // -> attack
  yield { type: "phase" };

  // ---------- Attack ----------
  let safety = 0;
  while (safety++ < 60) {
    const move = aiPickAttack(me);
    if (!move) break;
    const res = attack(move.from, move.to);
    if (!res) break;
    yield { type: "attack", ...res };
    if (res.conquered) {
      // Move enough to hold and keep pressing; leave 1 behind unless border is calm.
      const leave = isBorder(move.from) ? Math.ceil((Game.armies[move.from] - 1) / 2) : 1;
      const moveIn = Math.max(res.result.a.length, Game.armies[move.from] - leave);
      const count = Math.min(moveIn, Game.armies[move.from] - 1);
      moveAfterConquer(move.from, move.to, Math.max(res.result.a.length, count));
      yield { type: "move", from: move.from, to: move.to };
    }
    if (res.eliminated !== null) yield { type: "eliminated", player: res.eliminated };
    if (Game.phase === "gameover") return;
  }
  nextPhase(); // -> fortify
  yield { type: "phase" };

  // ---------- Fortify ----------
  const move = aiPickFortify(me);
  if (move) {
    fortify(move.from, move.to, move.count);
    yield { type: "fortify", ...move };
  }
  nextPhase(); // -> end turn
  yield { type: "endturn" };
}

// Higher = more worth reinforcing.
function aiBorderScore(id) {
  const mine = Game.armies[id];
  let weakestEnemy = Infinity, threat = 0;
  for (const n of enemyNeighbors(id)) {
    weakestEnemy = Math.min(weakestEnemy, Game.armies[n]);
    threat += Game.armies[n];
  }
  // Reward being close to overpowering a weak neighbor; reward being threatened.
  const attackGap = mine - weakestEnemy;       // want this positive
  return attackGap * 1.5 + threat * 0.5;
}

// Choose the best legal attack, or null to stop.
function aiPickAttack(me) {
  let best = null, bestScore = 0;
  for (const from of playerTerritories(me)) {
    if (Game.armies[from] < 3) continue; // don't attack with tiny stacks
    for (const to of enemyNeighbors(from)) {
      const ratio = Game.armies[from] / Math.max(1, Game.armies[to]);
      if (ratio < 1.3) continue; // only attack with a real edge
      const score = ratio + (Game.armies[from] - Game.armies[to]);
      if (score > bestScore) { bestScore = score; best = { from, to }; }
    }
  }
  return best;
}

// Pull armies from the safest interior stack toward the front.
function aiPickFortify(me) {
  const interior = playerTerritories(me)
    .filter((id) => Game.armies[id] > 1 && !isBorder(id))
    .sort((a, b) => Game.armies[b] - Game.armies[a]);
  for (const from of interior) {
    const reach = connectedOwn(from);
    let target = null, bestThreat = -1;
    for (const id of reach) {
      if (!isBorder(id)) continue;
      let threat = 0;
      for (const n of enemyNeighbors(id)) threat += Game.armies[n];
      if (threat > bestThreat) { bestThreat = threat; target = id; }
    }
    if (target) return { from, to: target, count: Game.armies[from] - 1 };
  }
  return null;
}
