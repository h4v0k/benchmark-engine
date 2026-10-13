#!/usr/bin/env node
// Usage: node scripts/bench.mjs [n=100] [seed=1]   (run `npm run build` first)
// Greedy-vs-greedy, Dragapult vs N's Zoroark (alternating seats). Prints games/s on this core.
import { playGame, greedyAgent } from "../dist/index.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../dist/cards/standard/index.js";

const n = Number(process.argv[2] ?? 100), seed0 = Number(process.argv[3] ?? 1);
playGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, seed0, greedyAgent, greedyAgent); // warm-up (JIT)
let turns = 0, events = 0;
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const [a, b] = i % 2 === 0 ? [DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK] : [NS_ZOROARK_EX_DECK, DRAGAPULT_EX_DECK];
  const r = playGame(a, b, seed0 + i, greedyAgent, greedyAgent);
  turns += r.turns; events += r.events?.length ?? 0;
}
const sec = (performance.now() - t0) / 1000;
console.log(`${n} greedy-vs-greedy games in ${sec.toFixed(2)}s = ${(n / sec).toFixed(1)} games/s (avg ${(turns / n).toFixed(1)} turns${events ? `, ${(events / n).toFixed(0)} events/game` : ""})`);
