/* ============================================================
   shared/rules.js — authoritative Trivia Risk game engine.
   All game-state mutations live here (server requires this).
   Functions take the game `state` object and mutate it.
   UMD; depends on shared/map.js and shared/scoring.js.
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./map"), require("./scoring"));
  } else {
    root.TriviaRiskRules = factory(root.TriviaRiskMap, root.TriviaRiskScoring);
  }
})(typeof self !== "undefined" ? self : this, function (Map, Scoring) {
  const { TERRITORIES, CATEGORIES, CONTINENTS, PLAYER_COLORS, PLAYER_NAMES_DEFAULT } = Map;

  const STATE_VERSION = 2;

  // ---- small utils -------------------------------------------------
  function now() { return Date.now(); }
  function uid(prefix) { return prefix + "_" + now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36); }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function log(state, type, message, extra) {
    const entry = Object.assign({
      id: uid("ev"),
      type,
      message,
      turn: state.turnCount,
      player: state.current,
      at: now(),
    }, extra || {});
    state.history.push(entry);
    return entry;
  }

  // ---- queries -----------------------------------------------------
  function playerTerritories(state, p) {
    return Object.keys(TERRITORIES).filter((id) => state.owner[id] === p);
  }

  function ownsContinent(state, p, cont) {
    return Object.keys(TERRITORIES).every(
      (id) => TERRITORIES[id].continent !== cont || state.owner[id] === p
    );
  }

  function calcReinforcements(state, p) {
    const count = playerTerritories(state, p).length;
    let armies = Math.max(3, Math.floor(count / 3));
    // Optional continent bonuses (preserved from classic Risk).
    for (const cont in CONTINENTS) {
      if (ownsContinent(state, p, cont)) armies += CONTINENTS[cont].bonus;
    }
    return armies;
  }

  function enemyNeighbors(state, id) {
    return TERRITORIES[id].adj.filter((n) => state.owner[n] !== state.owner[id]);
  }

  function connectedOwn(state, from) {
    const p = state.owner[from];
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop();
      for (const n of TERRITORIES[cur].adj) {
        if (state.owner[n] === p && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    seen.delete(from);
    return seen;
  }

  function alivePlayers(state) {
    return state.players.filter((p) => playerTerritories(state, p.id).length > 0);
  }

  function curPlayer(state) { return state.players[state.current]; }

  // ---- setup -------------------------------------------------------
  // playerConfigs: [{ name, color }] — 2..4 humans, no AI.
  function setupGame(playerConfigs) {
    const n = playerConfigs.length;
    if (n < 2 || n > 4) throw new Error("Trivia Risk supports 2-4 players");

    const state = {
      version: STATE_VERSION,
      id: uid("game"),
      players: playerConfigs.map((p, i) => ({
        id: i,
        name: (p.name && String(p.name).trim()) || PLAYER_NAMES_DEFAULT[i],
        color: p.color || PLAYER_COLORS[i],
      })),
      owner: {},
      armies: {},
      categories: {},
      current: 0,
      phase: "reinforce",
      reinforcements: 0,
      fortified: false,
      turnCount: 1,
      winner: null,
      gameOver: false,
      pendingBattle: null,
      usedQuestions: [],
      usedFingerprints: [],
      history: [],
      createdAt: now(),
      updatedAt: now(),
    };

    // Starting armies by player count (classic Risk).
    const START_ARMIES = { 2: 40, 3: 35, 4: 30 };

    const ids = shuffle(Object.keys(TERRITORIES));
    // Deal territories round-robin; every territory starts with >= 1 troop.
    ids.forEach((id, i) => {
      state.owner[id] = i % n;
      state.armies[id] = 1;
    });

    // Each territory gets one random category from the 8 (fixed for the game).
    ids.forEach((id) => {
      state.categories[id] = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    });

    // Distribute remaining starting armies randomly across owned lands.
    for (let p = 0; p < n; p++) {
      const mine = ids.filter((id) => state.owner[id] === p);
      let remaining = START_ARMIES[n] - mine.length;
      while (remaining > 0) {
        state.armies[mine[Math.floor(Math.random() * mine.length)]]++;
        remaining--;
      }
    }

    log(state, "game_start", `Game started with ${n} players.`, { players: state.players.map((p) => p.name) });
    log(state, "player_setup", "Players: " + state.players.map((p) => p.name).join(", "));
    log(state, "category_assignment", "Trivia categories assigned to all 42 territories.");
    state.reinforcements = calcReinforcements(state, 0);
    log(state, "turn_start", `${state.players[0].name}'s turn — ${state.reinforcements} reinforcements.`);
    return state;
  }

  // ---- reinforcement ----------------------------------------------
  function placeArmy(state, territoryId, count) {
    if (state.phase !== "reinforce") return { ok: false, error: "Not in reinforcement phase" };
    if (state.owner[territoryId] !== state.current) return { ok: false, error: "You do not own that territory" };
    const n = Math.min(Math.max(1, Math.floor(count || 1)), state.reinforcements);
    if (n <= 0) return { ok: false, error: "No reinforcements left" };
    state.armies[territoryId] += n;
    state.reinforcements -= n;
    log(state, "reinforce", `${curPlayer(state).name} reinforced ${TERRITORIES[territoryId].name} (+${n}).`,
      { territory: territoryId, count: n });
    return { ok: true };
  }

  // ---- attack: declaration ----------------------------------------
  function declareAttack(state, fromId, toId, attackerTroops, defenderTroops) {
    if (state.phase !== "attack") return { ok: false, error: "Not in attack phase" };
    if (state.pendingBattle) return { ok: false, error: "A battle is already in progress" };
    if (state.owner[fromId] !== state.current) return { ok: false, error: "You do not own the attacking territory" };
    if (state.owner[toId] === state.current) return { ok: false, error: "Cannot attack your own territory" };
    if (!TERRITORIES[fromId].adj.includes(toId)) return { ok: false, error: "Territories are not adjacent" };
    if (state.armies[fromId] < 2) return { ok: false, error: "Need at least 2 troops to attack" };

    const maxAtk = Math.min(4, state.armies[fromId] - 1);
    let atk = Math.floor(attackerTroops);
    if (!isFinite(atk)) return { ok: false, error: "Invalid attacker troops" };
    atk = Math.max(1, Math.min(atk, maxAtk));

    const maxDef = Math.min(3, state.armies[toId]);
    let def;
    if (defenderTroops == null) def = Math.min(2, state.armies[toId]); // sensible default
    else def = Math.max(1, Math.min(Math.floor(defenderTroops), maxDef));

    const battle = {
      id: uid("battle"),
      status: "awaiting_question",
      attackerPlayerId: state.current,
      defenderPlayerId: state.owner[toId],
      fromTerritoryId: fromId,
      toTerritoryId: toId,
      category: state.categories[toId],
      attackerCommittedTroops: atk,
      defenderCommittedTroops: def,
      question: null,
      attackerGuess: null,
      defenderGuess: null,
      result: null,
      error: null,
      conqueredPending: false,
    };
    state.pendingBattle = battle;
    log(state, "attack_declared",
      `${curPlayer(state).name} attacks ${TERRITORIES[toId].name} from ${TERRITORIES[fromId].name} ` +
      `(${atk} vs ${def}) — category: ${battle.category}.`,
      { battleId: battle.id, from: fromId, to: toId, category: battle.category });
    return { ok: true, battle };
  }

  // Attach an Anthropic-generated question to the pending battle and
  // record it in used-question history immediately.
  function attachQuestion(state, question) {
    const b = state.pendingBattle;
    if (!b) return { ok: false, error: "No pending battle" };
    b.question = question;
    b.status = "attacker_guess";
    b.error = null;

    const record = Object.assign({}, question, {
      id: question.id || uid("q"),
      battleId: b.id,
      generatedBy: question.generatedBy || "anthropic",
      createdAt: now(),
      usedAt: now(),
    });
    state.usedQuestions.push(record);
    state.usedFingerprints.push(question.questionFingerprint);
    log(state, "question_generated",
      `Question generated (${question.category}): ${question.question}`,
      { battleId: b.id, category: question.category, topic: question.topic });
    return { ok: true };
  }

  function setBattleError(state, message) {
    if (!state.pendingBattle) return;
    state.pendingBattle.status = "error";
    state.pendingBattle.error = message;
  }

  function cancelBattle(state) {
    if (!state.pendingBattle) return { ok: false, error: "No pending battle" };
    log(state, "attack_cancelled", `${curPlayer(state).name} cancelled the attack on ${TERRITORIES[state.pendingBattle.toTerritoryId].name}.`);
    state.pendingBattle = null;
    return { ok: true };
  }

  function validGuess(questionType, value) {
    const v = Number(value);
    if (value === "" || value == null || !isFinite(v) || isNaN(v)) return { ok: false, error: "Enter a valid number" };
    if (questionType === "amount" && v <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (questionType === "year" && v <= 0) return { ok: false, error: "Year must be a positive number" };
    return { ok: true, value: v };
  }

  function setAttackerGuess(state, guess) {
    const b = state.pendingBattle;
    if (!b || b.status !== "attacker_guess") return { ok: false, error: "Not awaiting attacker guess" };
    const v = validGuess(b.question.questionType, guess);
    if (!v.ok) return v;
    b.attackerGuess = v.value;
    b.status = "defender_guess";
    return { ok: true };
  }

  function setDefenderGuess(state, guess) {
    const b = state.pendingBattle;
    if (!b || b.status !== "defender_guess") return { ok: false, error: "Not awaiting defender guess" };
    const v = validGuess(b.question.questionType, guess);
    if (!v.ok) return v;
    if (v.value === b.attackerGuess) return { ok: false, error: "Defender guess cannot equal the attacker's guess" };
    b.defenderGuess = v.value;
    return resolveBattle(state);
  }

  function resolveBattle(state) {
    const b = state.pendingBattle;
    if (!b) return { ok: false, error: "No pending battle" };
    const q = b.question;
    const result = Scoring.resolveTriviaBattle({
      questionType: q.questionType,
      answer: q.answer,
      attackerGuess: b.attackerGuess,
      defenderGuess: b.defenderGuess,
      attackerCommittedTroops: b.attackerCommittedTroops,
      defenderCommittedTroops: b.defenderCommittedTroops,
      attackerPlayerId: b.attackerPlayerId,
      defenderPlayerId: b.defenderPlayerId,
    });

    // Apply damage.
    let conquered = false;
    if (result.loserPlayerId === b.defenderPlayerId) {
      const before = state.armies[b.toTerritoryId];
      state.armies[b.toTerritoryId] = Math.max(0, before - result.damage);
      if (state.armies[b.toTerritoryId] <= 0) conquered = true;
    } else {
      // Attacker lost — damage hits origin but never below 1.
      const before = state.armies[b.fromTerritoryId];
      state.armies[b.fromTerritoryId] = Math.max(1, before - result.damage);
    }
    result.conquered = conquered;
    b.result = result;
    b.status = "resolved";

    const winnerName = state.players[result.winnerPlayerId].name;
    log(state, "battle_resolved",
      `Battle for ${TERRITORIES[b.toTerritoryId].name}: ${winnerName} wins. ` +
      `Answer ${q.answerLabel}. Atk ${b.attackerGuess} (score ${result.attackerFinalScore}) vs ` +
      `Def ${b.defenderGuess} (score ${result.defenderFinalScore}). Damage ${result.damage}.`,
      {
        battleId: b.id,
        from: b.fromTerritoryId,
        to: b.toTerritoryId,
        category: b.category,
        question: q.question,
        answerLabel: q.answerLabel,
        attackerGuess: b.attackerGuess,
        defenderGuess: b.defenderGuess,
        attackerCommittedTroops: b.attackerCommittedTroops,
        defenderCommittedTroops: b.defenderCommittedTroops,
        attackerErrorPoints: result.attackerErrorPoints,
        defenderErrorPoints: result.defenderErrorPoints,
        attackerTroopBonus: result.attackerTroopBonus,
        defenderTroopBonus: result.defenderTroopBonus,
        attackerFinalScore: result.attackerFinalScore,
        defenderFinalScore: result.defenderFinalScore,
        winner: winnerName,
        damage: result.damage,
        conquered: conquered,
      });

    if (conquered) {
      // Ownership transfers immediately; attacker must move >=1 troop in.
      const loser = b.defenderPlayerId;
      state.owner[b.toTerritoryId] = b.attackerPlayerId;
      state.armies[b.toTerritoryId] = 0;
      b.conqueredPending = true;
      log(state, "territory_captured",
        `${state.players[b.attackerPlayerId].name} captured ${TERRITORIES[b.toTerritoryId].name}!`,
        { territory: b.toTerritoryId, from: loser, to: b.attackerPlayerId });
      if (playerTerritories(state, loser).length === 0) {
        log(state, "player_eliminated", `${state.players[loser].name} has been eliminated!`, { player: loser });
      }
      // Battle stays resolved+conqueredPending until troops are moved.
    } else {
      // No conquest — battle stays "resolved" so the client can show the
      // result; the player dismisses it to continue (dismissBattle).
      b.conqueredPending = false;
    }

    checkWinner(state);
    return { ok: true, result };
  }

  // Clear a resolved, non-capturing battle once the player has seen the result.
  function dismissBattle(state) {
    const b = state.pendingBattle;
    if (!b) return { ok: false, error: "No battle to dismiss" };
    if (b.conqueredPending) return { ok: false, error: "Move troops into the captured territory first" };
    state.pendingBattle = null;
    return { ok: true };
  }

  // Move troops into a freshly conquered territory (>=1, <= fromArmies-1).
  function applyConquestMove(state, count) {
    const b = state.pendingBattle;
    if (!b || !b.conqueredPending) return { ok: false, error: "No conquest awaiting troop movement" };
    const from = b.fromTerritoryId;
    const to = b.toTerritoryId;
    const maxMove = state.armies[from] - 1;
    const minMove = 1;
    let c = Math.floor(count);
    if (!isFinite(c)) c = minMove;
    c = Math.max(minMove, Math.min(c, maxMove));
    state.armies[from] -= c;
    state.armies[to] += c;
    log(state, "occupy", `${curPlayer(state).name} moved ${c} troop(s) into ${TERRITORIES[to].name}.`,
      { territory: to, count: c });
    state.pendingBattle = null;
    checkWinner(state);
    return { ok: true };
  }

  // ---- fortify -----------------------------------------------------
  function fortify(state, fromId, toId, count) {
    if (state.phase !== "fortify") return { ok: false, error: "Not in fortify phase" };
    if (state.fortified) return { ok: false, error: "Already fortified this turn" };
    if (state.owner[fromId] !== state.current || state.owner[toId] !== state.current)
      return { ok: false, error: "You must own both territories" };
    if (fromId === toId) return { ok: false, error: "Pick two different territories" };
    if (!connectedOwn(state, fromId).has(toId)) return { ok: false, error: "Territories are not connected" };
    let c = Math.floor(count);
    if (!isFinite(c) || c < 1 || c > state.armies[fromId] - 1) return { ok: false, error: "Invalid troop count" };
    state.armies[fromId] -= c;
    state.armies[toId] += c;
    state.fortified = true;
    log(state, "fortify", `${curPlayer(state).name} fortified ${TERRITORIES[toId].name} with ${c} from ${TERRITORIES[fromId].name}.`,
      { from: fromId, to: toId, count: c });
    return { ok: true };
  }

  // ---- turn flow ---------------------------------------------------
  function checkWinner(state) {
    const alive = alivePlayers(state);
    if (alive.length === 1) {
      state.winner = alive[0].id;
      state.gameOver = true;
      state.phase = "gameover";
      state.pendingBattle = null;
      log(state, "game_over", `${alive[0].name} has conquered the world! Final turn ${state.turnCount}.`,
        { winner: alive[0].id, turns: state.turnCount });
      return true;
    }
    return false;
  }

  function advancePhase(state) {
    if (state.gameOver) return { ok: false, error: "Game is over" };
    if (state.pendingBattle) return { ok: false, error: "Resolve the current battle first" };
    if (state.phase === "reinforce") {
      if (state.reinforcements > 0) return { ok: false, error: "Place all reinforcements first" };
      state.phase = "attack";
      log(state, "phase", `${curPlayer(state).name} entered the attack phase.`);
      return { ok: true };
    }
    if (state.phase === "attack") {
      state.phase = "fortify";
      log(state, "phase", `${curPlayer(state).name} entered the fortify phase.`);
      return { ok: true };
    }
    if (state.phase === "fortify") {
      return endTurn(state);
    }
    return { ok: false, error: "Unknown phase" };
  }

  function firstAlive(state) {
    const alive = alivePlayers(state).map((p) => p.id);
    return alive.length ? Math.min(...alive) : 0;
  }

  function endTurn(state) {
    if (checkWinner(state)) return { ok: true };
    log(state, "end_turn", `${curPlayer(state).name} ended their turn.`);
    const aliveIds = new Set(alivePlayers(state).map((p) => p.id));
    let next = state.current;
    do { next = (next + 1) % state.players.length; } while (!aliveIds.has(next));
    if (next <= state.current || next === firstAlive(state)) {
      // wrapped around to a new round
    }
    const wrapped = next <= state.current;
    state.current = next;
    if (wrapped) state.turnCount++;
    state.phase = "reinforce";
    state.fortified = false;
    state.reinforcements = calcReinforcements(state, state.current);
    log(state, "turn_start", `${curPlayer(state).name}'s turn — ${state.reinforcements} reinforcements.`);
    return { ok: true };
  }

  return {
    STATE_VERSION,
    setupGame,
    calcReinforcements,
    playerTerritories,
    enemyNeighbors,
    connectedOwn,
    alivePlayers,
    curPlayer,
    placeArmy,
    declareAttack,
    attachQuestion,
    setBattleError,
    cancelBattle,
    setAttackerGuess,
    setDefenderGuess,
    dismissBattle,
    applyConquestMove,
    fortify,
    advancePhase,
    endTurn,
    checkWinner,
    log,
  };
});
