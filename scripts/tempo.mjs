#!/usr/bin/env node
// Pilot tempo diagnostics: when does the Dragapult ex player develop and attack, and which useful actions go unused?
// Usage: node scripts/tempo.mjs [nGreedy=200] [nSearch=60] [seed=7000]   (run `npm run build` first)
import { playGame, greedyAgent, searchAgent, SEARCH_PRESETS, legalActions, decider, defOf } from "../dist/index.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../dist/cards/standard/index.js";

const [nG = 200, nS = 60, seed0 = 7000] = process.argv.slice(2).map(Number);
const LINE = new Set(["Dreepy", "Drakloak", "Dragapult ex"]);
const q = (xs, p) => { if (!xs.length) return NaN; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const fmt = (xs, n) => xs.length ? `${q(xs, .5)} [${q(xs, .25)}-${q(xs, .75)}] (${xs.length}/${n})` : `never (0/${n})`;

/** wraps an agent: at each turn-ending action (attack / endTurn) records which useful actions were still legal */
function probe(inner, rec) {
  return (s, rng) => {
    const act = inner(s, rng);
    if (s.phase === "main" && !s.pendingChoice && (act.type === "endTurn" || act.type === "attack")) {
      const pl = decider(s), acts = legalActions(s, pl);
      const own = rec.own[pl];
      const r = rec.turns[own] ??= { evo: 0, att: 0, attLine: 0, atkSkipped: 0 };
      if (acts.some((a) => a.type === "evolve" && LINE.has(defOf(a.card).name))) r.evo++;
      if (acts.some((a) => a.type === "attachEnergy")) r.att++;
      if (act.type === "endTurn" && acts.some((a) => a.type === "attack")) r.atkSkipped++;
    }
    return act;
  };
}

function runSet(label, mkMe, mkOpp, n) {
  const m = { bench: [], drak: [], drag: [], atk: [], ko: [], energy3: [], evoToAtk: [], active: 0 };
  const unused = {}; // own turn -> {evo, att, atkSkipped, n}
  let never = 0, won = 0;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const seed = seed0 + i, dragFirst = i % 2 === 0, me = dragFirst ? 0 : 1;
    const rec = { own: [0, 0], turns: {} };
    const ag = [0, 1].map((pl) => (pl === me ? probe(mkMe(), rec) : mkOpp()));
    // probe records for the Dragapult seat only; own-turn counter is advanced from the state (turnStart count)
    const track = (inner, pl) => (s, rng) => { rec.own[pl] = s.events.filter((e) => e.type === "turnStart" && e.player === pl).length; return inner(s, rng); };
    const A = [track(ag[0], 0), track(ag[1], 1)];
    const decks = dragFirst ? [DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK] : [NS_ZOROARK_EX_DECK, DRAGAPULT_EX_DECK];
    const r = playGame(decks[0], decks[1], seed, A[0], A[1]);
    if (r.winner === me) won++;
    const own = [0, 0]; let first = {}, e3 = 0;
    for (const e of r.events) {
      if (e.type === "turnStart") own[e.player]++;
      if (e.player === me || e.owner === me) {
        const t = own[me];
        if (e.type === "putOnBench" && e.pokemonName === "Dreepy") first.bench ??= t;
        if (e.type === "evolve" && e.toName === "Drakloak") first.drak ??= t;
        if (e.type === "evolve" && e.toName === "Dragapult ex") first.drag ??= t;
        if (e.type === "attack" && e.attackerName === "Dragapult ex" && e.player === me) first.atk ??= t;
        if (e.type === "attachEnergy" && LINE.has(e.targetName) && t <= 3) e3++;
      }
      if (e.type === "ko" && e.takenBy === me) first.koTurn ??= e.turn;
    }
    for (const [k, v] of [["bench", first.bench], ["drak", first.drak], ["drag", first.drag], ["atk", first.atk], ["ko", first.koTurn]]) if (v !== undefined) m[k].push(v);
    if (first.drag === undefined) never++;
    if (first.drag !== undefined && first.atk !== undefined) m.evoToAtk.push(first.atk - first.drag);
    m.energy3.push(e3);
    for (const [t, v] of Object.entries(rec.turns)) { const u = unused[t] ??= { evo: 0, att: 0, atkSkipped: 0, n: 0 }; u.evo += v.evo ? 1 : 0; u.att += v.att ? 1 : 0; u.atkSkipped += v.atkSkipped ? 1 : 0; u.n++; }
  }
  const dt = (performance.now() - t0) / 1000;
  console.log(`\n== ${label}: ${n} games, Dragapult seat alternates, ${(n / dt).toFixed(1)} games/s, Dragapult win ${(100 * won / n).toFixed(1)}%`);
  console.log(`  metric (own turn; median [p25-p75] (reached/games))`);
  console.log(`  Dreepy first benched      ${fmt(m.bench, n)}   (0 = opening setup)`);
  console.log(`  first Drakloak            ${fmt(m.drak, n)}`);
  console.log(`  first Dragapult ex        ${fmt(m.drag, n)}   never reached ${(100 * never / n).toFixed(1)}%`);
  console.log(`  first Dragapult ex attack ${fmt(m.atk, n)}`);
  console.log(`  evolve->first attack gap  ${fmt(m.evoToAtk, n)}`);
  console.log(`  first KO (GAME turn)      ${fmt(m.ko, n)}`);
  console.log(`  energy on line by own T3  median ${q(m.energy3, .5)} [${q(m.energy3, .25)}-${q(m.energy3, .75)}], mean ${(m.energy3.reduce((a, b) => a + b, 0) / n).toFixed(2)}`);
  console.log(`  turn-end with unused option, % of the Dragapult player's turns:`);
  console.log(`  own turn | evolve avail | attach avail | attack skipped (endTurn)`);
  for (const t of Object.keys(unused).map(Number).sort((a, b) => a - b).filter((t) => t >= 1 && t <= 8)) {
    const u = unused[t], p = (x) => (100 * x / u.n).toFixed(0).padStart(3) + "%";
    console.log(`  ${String(t).padStart(8)} | ${p(u.evo).padStart(12)} | ${p(u.att).padStart(12)} | ${p(u.atkSkipped).padStart(12)}   (n=${u.n})`);
  }
}

if (nG > 0) runSet("greedy vs greedy", () => greedyAgent, () => greedyAgent, nG);
if (nS > 0) runSet("search:fast (Dragapult) vs greedy (Zoroark)", () => searchAgent(SEARCH_PRESETS.fast), () => greedyAgent, nS);
