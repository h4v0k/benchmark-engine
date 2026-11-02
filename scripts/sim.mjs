#!/usr/bin/env node
// Usage: node scripts/sim.mjs <deckA> <deckB> [n=100] [seed=1] [maxTurns=200] [--jsonl <path>] [--greedy] [--agent <spec>]   (run `npm run build` first)
// --jsonl <path>  write one JSON line per game {seed, decks, winner, reason, turns, events} for offline analytics
// --greedy        use the greedy agent for both players (default: random agents)
// --agent <spec>  greedy | random | search:fast | search:strong; "x,y" = deck A plays x, deck B plays y (overrides --greedy)
// Decks: dragapult | zoroark (aliases: DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK). Alternates which deck is player 0 each game.
import { playGame, randomAgent, greedyAgent, exportGamesJsonl, KEY_EFFECTS } from "../dist/index.js";
import { parseAgentPair } from "./agent-spec.mjs";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../dist/cards/standard/index.js";

const DECKS = { dragapult: DRAGAPULT_EX_DECK, zoroark: NS_ZOROARK_EX_DECK, DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK };
const argv = process.argv.slice(2);
const takeFlag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const takeOpt = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const jsonlPath = takeOpt("--jsonl");
const agentSpec = takeOpt("--agent");
const [agentA, agentB] = agentSpec ? parseAgentPair(agentSpec) : takeFlag("--greedy") ? [greedyAgent, greedyAgent] : [randomAgent, randomAgent];
const [nameA, nameB, nArg, seedArg, mtArg] = argv;
if (!DECKS[nameA] || !DECKS[nameB]) { console.error("usage: sim.mjs <dragapult|zoroark> <dragapult|zoroark> [n] [seed] [maxTurns] [--jsonl path] [--greedy] [--agent spec]"); process.exit(2); }
const n = Number(nArg ?? 100), seed0 = Number(seedArg ?? 1), maxTurns = Number(mtArg ?? 200);

export function runSim(nameA, nameB, n, seed0, maxTurns) {
  const out = { n, winsA: 0, winsB: 0, draws: 0, maxTurnsHit: 0, turns: 0, errors: [], keyUse: Object.fromEntries(KEY_EFFECTS.map((k) => [k, 0])), reasons: {}, ms: 0, kos: [0, 0], prizes: [0, 0], attacks: [0, 0], zeroDmg: [0, 0], games: [] };
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const seed = seed0 + i, aFirst = i % 2 === 0;
    const [d0, d1] = aFirst ? [DECKS[nameA], DECKS[nameB]] : [DECKS[nameB], DECKS[nameA]];
    let r;
    try { r = aFirst ? playGame(d0, d1, seed, agentA, agentB, maxTurns) : playGame(d0, d1, seed, agentB, agentA, maxTurns); }
    catch (e) { out.errors.push({ seed, msg: String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ") }); continue; }
    out.turns += r.turns;
    out.reasons[r.reason] = (out.reasons[r.reason] ?? 0) + 1;
    if (r.reason === "maxTurns" || r.reason === "actionLimit") out.maxTurnsHit++;
    if (r.winner === null) out.draws++; else if ((r.winner === 0) === aFirst) out.winsA++; else out.winsB++;
    // every stat comes from the event stream (r.stats = statsFromEvents(r.events)); stats are per seat, folded to deck A / deck B here
    const [a, b] = aFirst ? [0, 1] : [1, 0];
    for (const [key, field] of [["kos", "kos"], ["prizes", "prizesTaken"], ["attacks", "attacks"], ["zeroDmg", "zeroDamageAttacks"]]) { out[key][0] += r.stats[field][a]; out[key][1] += r.stats[field][b]; }
    for (const [k, c] of Object.entries(r.stats.keyEffects)) out.keyUse[k] += c;
    if (jsonlPath) out.games.push(r);
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
  console.log(`  KOs ${o.kos[0]}/${o.kos[1]}, prizes taken ${o.prizes[0]}/${o.prizes[1]}, attacks ${o.attacks[0]}/${o.attacks[1]} (zero-damage ${o.zeroDmg[0]}/${o.zeroDmg[1]})  [${nameA}/${nameB}]`);
  console.log(`  key effect uses (total across games): ${JSON.stringify(o.keyUse)}`);
  if (jsonlPath) { exportGamesJsonl(o.games, jsonlPath); console.log(`  wrote ${o.games.length} games to ${jsonlPath}`); }
  console.log(`  ${(o.ms / 1000).toFixed(2)}s, ${(n / (o.ms / 1000)).toFixed(1)} games/s`);
  for (const e of o.errors.slice(0, 5)) console.log(`  ERROR seed ${e.seed}: ${e.msg}`);
  if (o.errors.length || o.maxTurnsHit) process.exitCode = 1;
}
