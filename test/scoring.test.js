/* ============================================================
   test/scoring.test.js — validation of the round closeness math
   and duplicate-question detection. Run: npm test
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

console.log("Round resolution (closest wins, attacker wins ties):");
let r = S.resolveRound("amount", 100, 95, 50); // attacker much closer
check("closer attacker wins", r.attackerWon === true && r.tie === false);

r = S.resolveRound("amount", 100, 50, 95); // defender closer
check("closer defender wins", r.attackerWon === false);

r = S.resolveRound("amount", 100, 80, 80); // identical guesses (defender copied)
check("exact copy is a tie", r.tie === true);
check("tie goes to attacker", r.attackerWon === true);

r = S.resolveRound("amount", 100, 50, 200); // both off by ratio 2 -> equal error
check("equal error is a tie", r.tie === true && r.attackerWon === true);

r = S.resolveRound("year", 1990, 1992, 1980); // attacker 2 off, defender 10 off
check("year: closer attacker wins", r.attackerWon === true);

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
