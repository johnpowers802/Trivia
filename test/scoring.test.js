/* ============================================================
   test/scoring.test.js — validation of the Margin-of-Error math
   and the duplicate-question detection. Run: npm test
   ============================================================ */
const S = require("../shared/scoring");
const Q = require("../shared/questions");

let passed = 0, failed = 0;
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 0.01 : eps); }
function check(name, cond) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.error("  ✗ " + name); }
}

console.log("Amount error points (ratio-based):");
check("100 vs 100 = 0", approx(S.calculateAmountErrorPoints(100, 100), 0));
check("100 vs 90 ≈ 11.11", approx(S.calculateAmountErrorPoints(90, 100), 11.11));
check("100 vs 50 = 100", approx(S.calculateAmountErrorPoints(50, 100), 100));
check("100 vs 200 = 100", approx(S.calculateAmountErrorPoints(200, 100), 100));
check("scale-independent: 40,000,000 vs 20,000,000 = 100", approx(S.calculateAmountErrorPoints(20000000, 40000000), 100));
check("invalid (0) -> Infinity", S.calculateAmountErrorPoints(0, 100) === Infinity);

console.log("Year error points (abs distance * 5):");
check("1989 vs 1989 = 0", S.calculateYearErrorPoints(1989, 1989) === 0);
check("1985 vs 1989 = 20", S.calculateYearErrorPoints(1985, 1989) === 20);

console.log("Troop bonus & final score:");
check("1 troop = 0 bonus", S.calculateTroopBonus(1) === 0);
check("4 troops = 30 bonus", S.calculateTroopBonus(4) === 30);
check("final score floors at 0", S.calculateFinalScore(20, 4) === 0);
check("final score = error - bonus", S.calculateFinalScore(50, 2) === 40);

console.log("Damage tiers (capped by loser committed troops):");
check("gap 10 -> 1", S.calculateDamage(10, 3) === 1);
check("gap 20 -> 1", S.calculateDamage(20, 3) === 1);
check("gap 40 -> 2", S.calculateDamage(40, 3) === 2);
check("gap 60 -> 2", S.calculateDamage(60, 3) === 2);
check("gap 80 -> 3", S.calculateDamage(80, 3) === 3);
check("gap 80 capped at 2 committed -> 2", S.calculateDamage(80, 2) === 2);

console.log("Full battle resolution:");
let r = S.resolveTriviaBattle({
  questionType: "amount", answer: 100,
  attackerGuess: 95, defenderGuess: 50,
  attackerCommittedTroops: 1, defenderCommittedTroops: 1,
  attackerPlayerId: 0, defenderPlayerId: 1,
});
check("closer attacker wins", r.winnerPlayerId === 0 && r.attackerWins === true);
check("loser is defender", r.loserPlayerId === 1);

r = S.resolveTriviaBattle({
  questionType: "amount", answer: 100,
  attackerGuess: 50, defenderGuess: 50, // identical -> tie -> defender wins
  attackerCommittedTroops: 1, defenderCommittedTroops: 1,
  attackerPlayerId: 0, defenderPlayerId: 1,
});
check("exact tie -> defender wins", r.winnerPlayerId === 1 && r.attackerWins === false);

r = S.resolveTriviaBattle({
  questionType: "amount", answer: 100,
  attackerGuess: 50, defenderGuess: 90, // defender closer
  attackerCommittedTroops: 4, defenderCommittedTroops: 1, // but attacker has 30-pt troop bonus
  attackerPlayerId: 0, defenderPlayerId: 1,
});
// attacker error 100 -> final 70; defender error 11.11 -> final 11.11 => defender still wins
check("troops help but big miss still loses", r.winnerPlayerId === 1);

r = S.resolveTriviaBattle({
  questionType: "amount", answer: 100,
  attackerGuess: 80, defenderGuess: 95,
  attackerCommittedTroops: 4, defenderCommittedTroops: 1,
  attackerPlayerId: 0, defenderPlayerId: 1,
});
// attacker error 25 -> final 0 (25-30 floored); defender error ~5.26 -> final 5.26 => attacker wins via troops
check("troop bonus can overcome a small gap", r.winnerPlayerId === 0);

console.log("Duplicate detection:");
const used = [{
  category: "World & Geography", question: "What is the approximate population of Canada?",
  answer: 40000000, answerLabel: "about 40 million", entity: "Canada", factType: "population",
}];
check("exact text -> duplicate", Q.isDuplicateQuestion(
  { category: "World & Geography", question: "What is the approximate population of Canada?", answer: 41000000, entity: "Canada", factType: "population" }, used).duplicate);
check("same entity+fact -> duplicate", Q.isDuplicateQuestion(
  { category: "World & Geography", question: "Roughly how many people live in Canada?", answer: 39000000, entity: "Canada", factType: "population" }, used).duplicate);
check("different topic -> not duplicate", !Q.isDuplicateQuestion(
  { category: "World & Geography", question: "How tall is Mount Everest in meters?", answer: 8849, entity: "Mount Everest", factType: "height" }, used).duplicate);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
