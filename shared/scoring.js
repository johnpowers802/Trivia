/* ============================================================
   shared/scoring.js — "Margin of Error" closeness math.
   A battle is a series of one-question rounds: the closest guess
   wins the round (attacker wins ties). The loser loses 1 troop.
   Pure functions only. UMD (require + <script>).
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TriviaRiskScoring = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Amount questions: ratio-based, so scale-independent across 3, 206, 40000000.
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

  function round2(n) {
    if (!isFinite(n)) return n;
    return Math.round(n * 100) / 100;
  }

  /*
    Resolve ONE round. The closest guess (lowest error) wins.
    Attacker wins exact ties (equal error) — so copying the
    attacker's guess does not help the defender.
    Returns { attackerError, defenderError, attackerWon, tie }.
  */
  function resolveRound(questionType, answer, attackerGuess, defenderGuess) {
    const ae = calculateErrorPoints(questionType, attackerGuess, answer);
    const de = calculateErrorPoints(questionType, defenderGuess, answer);
    return {
      attackerError: round2(ae),
      defenderError: round2(de),
      attackerWon: ae <= de, // attacker wins ties
      tie: ae === de,
    };
  }

  return {
    calculateAmountErrorPoints,
    calculateYearErrorPoints,
    calculateErrorPoints,
    resolveRound,
  };
});
