#!/usr/bin/env node
// Usage: node scripts/sim.mjs <deckA> <deckB> [n=100] [seed=1] [maxTurns=200]   (run `npm run build` first)
// Decks: dragapult | zoroark (aliases: DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK). Alternates which deck is player 0 each game.
import { playGame, randomAgent, keyEffectUses, KEY_EFFECTS } from "../dist/index.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../dist/cards/standard/index.js";

const DECKS = { dragapult: DRAGAPULT_EX_DECK, zoroark: NS_ZOROARK_EX_DECK, DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK };
const [nameA, nameB, nArg, seedArg, mtArg] = process.argv.slice(2);
if (!DECKS[nameA] || !DECKS[nameB]) { console.error("usage: sim.mjs <dragapult|zoroark> <dragapult|zoroark> [n] [seed] [maxTurns]"); process.exit(2); }
const n = Number(nArg ?? 100), seed0 = Number(seedArg ?? 1), maxTurns = Number(mtArg ?? 200);

export function runSim(nameA, nameB, n, seed0, maxTurns) {
  const out = { n, winsA: 0, winsB: 0, draws: 0, maxTurnsHit: 0, turns: 0, errors: [], keyUse: Object.fromEntries(KEY_EFFECTS.map((k) => [k, 0])), reasons: {}, ms: 0 };
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const seed = seed0 + i, aFirst = i % 2 === 0;
    const [d0, d1] = aFirst ? [DECKS[nameA], DECKS[nameB]] : [DECKS[nameB], DECKS[nameA]];
    let r;
    try { r = playGame(d0, d1, seed, randomAgent, randomAgent, maxTurns); }
    catch (e) { out.errors.push({ seed, msg: String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ") }); continue; }
    out.turns += r.turns;
    out.reasons[r.reason] = (out.reasons[r.reason] ?? 0) + 1;
    if (r.reason === "maxTurns" || r.reason === "actionLimit") out.maxTurnsHit++;
    if (r.winner === null) out.draws++; else if ((r.winner === 0) === aFirst) out.winsA++; else out.winsB++;
    for (const [k, c] of Object.entries(keyEffectUses(r.log))) out.keyUse[k] += c;
  }
  out.ms = performance.now() - t0;
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const o = runSim(nameA, nameB, n, seed0, maxTurns);
  const ok = n - o.errors.length;
  console.log(`${nameA} vs ${nameB}: ${n} games, seeds ${seed0}..${seed0 + n - 1}, maxTurns ${maxTurns}`);
  console.log(`  ${nameA} wins ${o.winsA}, ${nameB} wins ${o.winsB}, draws ${o.draws}, hit maxTurns ${o.maxTurnsHit}, errors ${o.errors.length}`);
  console.log(`  avg turns ${(o.turns / Math.max(1, ok)).toFixed(1)}, win reasons ${JSON.stringify(o.reasons)}`);
  console.log(`  key effect uses (total across games): ${JSON.stringify(o.keyUse)}`);
  console.log(`  ${(o.ms / 1000).toFixed(2)}s, ${(n / (o.ms / 1000)).toFixed(1)} games/s`);
  for (const e of o.errors.slice(0, 5)) console.log(`  ERROR seed ${e.seed}: ${e.msg}`);
  if (o.errors.length || o.maxTurnsHit) process.exitCode = 1;
}
