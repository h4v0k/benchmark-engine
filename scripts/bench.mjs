#!/usr/bin/env node
// Usage: node scripts/bench.mjs [n=100] [seed=1] [--agent greedy|random|search:fast|search:strong[,<agent for player 1>]]   (run `npm run build` first)
// Dragapult vs N's Zoroark (alternating seats), default greedy-vs-greedy. Prints games/s and ms per game on this core.
import { playGame, greedyAgent } from "../dist/index.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../dist/cards/standard/index.js";
import { parseAgentPair } from "./agent-spec.mjs";

const argv = process.argv.slice(2);
const ai = argv.indexOf("--agent");
const spec = ai >= 0 ? argv.splice(ai, 2)[1] : "greedy";
const [agent0, agent1] = parseAgentPair(spec);
const n = Number(argv[0] ?? 100), seed0 = Number(argv[1] ?? 1);
playGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, seed0, greedyAgent, greedyAgent); // warm-up (JIT)
let turns = 0, events = 0;
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const [a, b] = i % 2 === 0 ? [DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK] : [NS_ZOROARK_EX_DECK, DRAGAPULT_EX_DECK];
  const r = playGame(a, b, seed0 + i, agent0, agent1);
  turns += r.turns; events += r.events?.length ?? 0;
}
const sec = (performance.now() - t0) / 1000;
console.log(`${n} games (${spec}) in ${sec.toFixed(2)}s = ${(n / sec).toFixed(2)} games/s, ${((sec / n) * 1000).toFixed(0)} ms/game (avg ${(turns / n).toFixed(1)} turns${events ? `, ${(events / n).toFixed(0)} events/game` : ""})`);
