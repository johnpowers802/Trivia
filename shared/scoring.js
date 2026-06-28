/* ============================================================
   shared/scoring.js — "Margin of Error" battle math.
   Pure functions only. UMD (require + <script>).
   Covers answers across wildly different numeric scales
   (3, 206, 42000, 40000000).
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TriviaRiskScoring = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // --- Error points -------------------------------------------------

  // Amount questions: ratio-based, so scale-independent.
  // errorMultiplier = max/min ; errorPoints = (mult - 1) * 100.
  function calculateAmountErrorPoints(guess, answer) {
    const g = Number(guess);
    const a = Number(answer);
    if (!isFinite(g) || !isFinite(a) || g <= 0 || a <= 0) return Infinity;
    const mult = Math.max(g, a) / Math.min(g, a);
    return (mult - 1) * 100;
  }

  // Year questions: absolute distance, weighted.
  function calculateYearErrorPoints(guess, answer) {
    const g = Number(guess);
    const a = Number(answer);
    if (!isFinite(g) || !isFinite(a)) return Infinity;
    return Math.abs(g - a) * 5;
  }

  function calculateErrorPoints(questionType, guess, answer) {
    return questionType === "year"
      ? calculateYearErrorPoints(guess, answer)
      : calculateAmountErrorPoints(guess, answer);
  }

  // --- Troops -------------------------------------------------------

  // Each committed troop after the first removes 10 error points.
  function calculateTroopBonus(committedTroops) {
    const t = Math.max(1, Math.floor(Number(committedTroops) || 1));
    return (t - 1) * 10;
  }

  function calculateFinalScore(errorPoints, committedTroops) {
    if (!isFinite(errorPoints)) return Infinity;
    return Math.max(0, errorPoints - calculateTroopBonus(committedTroops));
  }

  // --- Damage -------------------------------------------------------

  // scoreGap = loserFinalScore - winnerFinalScore (>= 0).
  function calculateDamage(scoreGap, loserCommittedTroops) {
    let dmg;
    if (scoreGap <= 20) dmg = 1;
    else if (scoreGap <= 60) dmg = 2;
    else dmg = 3;
    const cap = Math.max(0, Math.floor(Number(loserCommittedTroops) || 0));
    return Math.min(dmg, cap);
  }

  // --- Full resolution ----------------------------------------------

  /*
    battleInput: {
      questionType, answer,
      attackerGuess, defenderGuess,
      attackerCommittedTroops, defenderCommittedTroops,
      attackerPlayerId, defenderPlayerId
    }
    Returns the `result` object (see suggested battle state shape).
  */
  function resolveTriviaBattle(b) {
    const attackerErrorPoints = calculateErrorPoints(b.questionType, b.attackerGuess, b.answer);
    const defenderErrorPoints = calculateErrorPoints(b.questionType, b.defenderGuess, b.answer);
    const attackerTroopBonus = calculateTroopBonus(b.attackerCommittedTroops);
    const defenderTroopBonus = calculateTroopBonus(b.defenderCommittedTroops);
    const attackerFinalScore = calculateFinalScore(attackerErrorPoints, b.attackerCommittedTroops);
    const defenderFinalScore = calculateFinalScore(defenderErrorPoints, b.defenderCommittedTroops);

    // Lowest finalScore wins. Tie -> raw errorPoints. Tie -> defender wins.
    let attackerWins;
    if (attackerFinalScore !== defenderFinalScore) {
      attackerWins = attackerFinalScore < defenderFinalScore;
    } else if (attackerErrorPoints !== defenderErrorPoints) {
      attackerWins = attackerErrorPoints < defenderErrorPoints;
    } else {
      attackerWins = false; // defender wins exact ties
    }

    const winnerPlayerId = attackerWins ? b.attackerPlayerId : b.defenderPlayerId;
    const loserPlayerId = attackerWins ? b.defenderPlayerId : b.attackerPlayerId;
    const winnerFinalScore = attackerWins ? attackerFinalScore : defenderFinalScore;
    const loserFinalScore = attackerWins ? defenderFinalScore : attackerFinalScore;
    const loserCommittedTroops = attackerWins ? b.defenderCommittedTroops : b.attackerCommittedTroops;

    const scoreGap = (isFinite(loserFinalScore) ? loserFinalScore : 1e9) -
      (isFinite(winnerFinalScore) ? winnerFinalScore : 0);
    const damage = calculateDamage(scoreGap, loserCommittedTroops);

    return {
      attackerErrorPoints: round2(attackerErrorPoints),
      defenderErrorPoints: round2(defenderErrorPoints),
      attackerTroopBonus,
      defenderTroopBonus,
      attackerFinalScore: round2(attackerFinalScore),
      defenderFinalScore: round2(defenderFinalScore),
      attackerWins,
      winnerPlayerId,
      loserPlayerId,
      scoreGap: round2(scoreGap),
      damage,
      conquered: false, // set by rules after applying damage
    };
  }

  function round2(n) {
    if (!isFinite(n)) return n;
    return Math.round(n * 100) / 100;
  }

  return {
    calculateAmountErrorPoints,
    calculateYearErrorPoints,
    calculateErrorPoints,
    calculateTroopBonus,
    calculateFinalScore,
    calculateDamage,
    resolveTriviaBattle,
  };
});
