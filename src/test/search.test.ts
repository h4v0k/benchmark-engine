// Milestone 3b: the determinized-MCTS pilot (src/agents/search.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decider, legalActions, type Action } from "../actions.js";
import { greedyAgent } from "../agents/greedy.js";
import { randomAgent, type Agent } from "../agents/random.js";
import { DEFAULT_SEARCH, FAST_SEARCH, STRONG_SEARCH, bestIndex, evaluateActions, searchAgent, type SearchConfig } from "../agents/search.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../cards/standard/index.js";
import type { CardDef } from "../cards/model.js";
import { applyAction, createGame } from "../game.js";
import { makeRng, shuffle } from "../rng.js";
import { playGame, type GameResult } from "../sim.js";
import { cloneState, type GameState, type PlayerId } from "../state.js";
import { addBench, give, mainState, setActive } from "./helpers.js";

const D = DRAGAPULT_EX_DECK, Z = NS_ZOROARK_EX_DECK;
const PAIRS: Array<[CardDef[], CardDef[], string]> = [[D, D, "D-v-D"], [D, Z, "D-v-Z"], [Z, D, "Z-v-D"], [Z, Z, "Z-v-Z"]];

interface Series { wins: number; games: number; turns: number; reasons: Record<string, number>; byPair: Record<string, [number, number]>; ms: number; phantom: [number, number]; results: GameResult[] }
/** `agent` (the one under test) plays seat i%2 and the deck pair cycles every two games; seeds `seed0 + i`. */
function series(agent: Agent, opp: Agent, n: number, seed0: number): Series {
  const out: Series = { wins: 0, games: n, turns: 0, reasons: {}, byPair: {}, ms: 0, phantom: [0, 0], results: [] };
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const seat = (i % 2) as PlayerId;
    const [mine, theirs, name] = PAIRS[(i >> 1) % 4]!;
    const r = seat === 0 ? playGame(mine, theirs, seed0 + i, agent, opp) : playGame(theirs, mine, seed0 + i, opp, agent);
    assert.ok(r.reason !== "maxTurns" && r.reason !== "actionLimit", `seed ${seed0 + i}: ${r.reason}`);
    const won = r.winner === seat;
    if (won) out.wins++;
    out.turns += r.turns;
    out.reasons[r.reason] = (out.reasons[r.reason] ?? 0) + 1;
    const bp = (out.byPair[name] ??= [0, 0]); bp[0] += won ? 1 : 0; bp[1]++;
    for (const e of r.events) if (e.type === "attack" && !e.failed && e.attackName === "Phantom Dive") out.phantom[e.player === seat ? 0 : 1]++;
  }
  out.ms = performance.now() - t0;
  return out;
}
const pct = (x: number) => (100 * x).toFixed(1) + "%";
const report = (label: string, r: Series) =>
  console.log(`  [${label}] win ${r.wins}/${r.games} = ${pct(r.wins / r.games)}, avg turns ${(r.turns / r.games).toFixed(1)}, reasons ${JSON.stringify(r.reasons)}, ` +
    `by pair ${JSON.stringify(Object.fromEntries(Object.entries(r.byPair).map(([k, v]) => [k, `${v[0]}/${v[1]}`])))}, Phantom Dive search/opp ${r.phantom[0]}/${r.phantom[1]}, ` +
    `${(r.games / (r.ms / 1000)).toFixed(2)} games/s (${(r.ms / r.games).toFixed(0)} ms/game)`);

test("presets: defaults match the milestone spec", () => {
  assert.deepEqual({ ...DEFAULT_SEARCH, maxBranch: 0 }, { determinizations: 6, iterations: 60, rolloutTurns: 6, cUct: 1.4, opponentModel: "greedy", maxBranch: 0 });
  assert.ok(FAST_SEARCH.determinizations * FAST_SEARCH.iterations < STRONG_SEARCH.determinizations * STRONG_SEARCH.iterations);
});

// ------------------------------------------------------------------ strength
test("search (fast) beats greedy >= 85% over 100 games (seats and deck pairs alternate)", () => {
  const r = series(searchAgent(FAST_SEARCH), greedyAgent, 100, 1);
  report("fast vs greedy", r);
  assert.ok(r.wins / r.games >= 0.85, `win rate ${pct(r.wins / r.games)}`);
  assert.ok(r.ms / r.games < 4000, "fast preset should stay within a few seconds per game");
});

test("search (fast) beats random >= 96% over 50 games", () => {
  const r = series(searchAgent(FAST_SEARCH), randomAgent, 50, 500);
  report("fast vs random", r);
  assert.ok(r.wins / r.games >= 0.96, `win rate ${pct(r.wins / r.games)}`);
});

// ------------------------------------------------------------------ determinism
test("determinism: same seed gives the same actions and result", () => {
  const cfg: Partial<SearchConfig> = { determinizations: 2, iterations: 8, rolloutTurns: 2 };
  for (const seed of [11, 12, 13]) {
    const run = () => {
      const log: string[] = [];
      const base = searchAgent(cfg);
      const spy: Agent = (s, rng) => { const a = base(s, rng); log.push(JSON.stringify(a)); return a; };
      const r = playGame(D, Z, seed, spy, greedyAgent);
      return { log, winner: r.winner, turns: r.turns, reason: r.reason, events: r.events.length };
    };
    assert.deepEqual(run(), run(), `seed ${seed}`);
  }
});

// ------------------------------------------------------------------ hidden information
/** Reorder the opponent's hidden cards. `pooled`: also move cards between hand, deck and prizes (counts per zone are kept). */
function scramble(s: GameState, opp: PlayerId, seed: number, pooled: boolean): GameState {
  const c = cloneState(s), ps = c.players[opp], rng = makeRng(seed);
  if (pooled) {
    const pool = shuffle([...ps.hand, ...ps.deck, ...ps.prizes], rng);
    const nh = ps.hand.length, nd = ps.deck.length;
    ps.hand = pool.slice(0, nh); ps.deck = pool.slice(nh, nh + nd); ps.prizes = pool.slice(nh + nd);
  } else { shuffle(ps.hand, rng); shuffle(ps.deck, rng); shuffle(ps.prizes, rng); }
  return c;
}
test("hidden information: permuting the opponent's hidden cards does not change the search", () => {
  const cfg: Partial<SearchConfig> = { determinizations: 3, iterations: 10, rolloutTurns: 2 };
  // walk a greedy-vs-greedy game and probe the searcher's decisions at several points (no open choice)
  let s = createGame(D, Z, 21);
  let guard = 0, probes = 0;
  const targets = [3, 6, 9, 12, 15, 18];
  while (s.phase !== "over" && probes < targets.length && guard++ < 5000) {
    const pl = decider(s)!;
    if (s.phase === "main" && !s.pendingChoice && s.turn >= targets[probes]! && legalActions(s, pl).length > 1) {
      probes++;
      const opp = (1 - pl) as PlayerId;
      const ref = evaluateActions(s, pl, cfg, makeRng(99));
      for (const [seed, pooled] of [[1, false], [2, true], [3, true]] as const) {
        const alt = scramble(s, opp, seed, pooled);
        assert.ok(JSON.stringify(alt.players[opp]) !== JSON.stringify(s.players[opp]), "scramble must actually change the hidden cards");
        assert.deepEqual(evaluateActions(alt, pl, cfg, makeRng(99)), ref, `turn ${s.turn}, scramble ${seed}`);
        const a = searchAgent(cfg)(s, makeRng(5)), b = searchAgent(cfg)(alt, makeRng(5));
        assert.deepEqual(b, a, `chosen action differs at turn ${s.turn}`);
      }
    }
    const a = greedyAgent(s, makeRng(0));
    s = applyAction(s, a);
  }
  assert.equal(probes, targets.length, "game ended before all probes");
});

test("search never mutates the state it is given", () => {
  const s = mainState(3, 5);
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] }); setActive(s, 1, "pondling");
  give(s, 0, "prof-notes");
  const before = JSON.stringify(s);
  evaluateActions(s, 0, { determinizations: 2, iterations: 6, rolloutTurns: 2 }, makeRng(1));
  assert.equal(JSON.stringify(s), before);
});

// ------------------------------------------------------------------ decisions
const SMALL: Partial<SearchConfig> = { determinizations: 3, iterations: 16, rolloutTurns: 2 };
const same = (a: Action, b: Partial<Action>) => JSON.stringify(a) === JSON.stringify({ ...a, ...b });

test("decision: takes the lethal attack for the game", () => {
  const s = mainState(4, 5);
  setActive(s, 0, "sparkbit", { energy: ["energy-l", "energy-l"] });
  setActive(s, 1, "pondling", { damage: 20 }); // 50 left: Zap 20 x2 (weakness) = 40 leaves it alive, Spark Rush 30 x2 = 60 is lethal
  addBench(s, 1, "tidepup");
  s.players[0].prizes = s.players[0].prizes.slice(0, 1);
  const acts = legalActions(s, 0);
  const rush = acts.find((a) => a.type === "attack" && a.attackIndex === 1)!;
  assert.ok(rush && acts.some((a) => a.type === "attack" && a.attackIndex === 0));
  const ev = evaluateActions(s, 0, SMALL, makeRng(7));
  const best = ev[bestIndex(ev)]!;
  assert.ok(same(best.action, rush), `chose ${JSON.stringify(best.action)}`);
  assert.ok(best.winProb! > 0.99, `lethal attack win prob ${best.winProb}`);
  assert.deepEqual(searchAgent(SMALL)(s, makeRng(7)), rush);
  assert.deepEqual(greedyAgent(s, makeRng(7)), rush); // greedy also finds it
});

test("decision: search avoids drawing the last cards (decking itself); greedy plays the draw Supporter", () => {
  const s = mainState(5, 5);
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] }); setActive(s, 1, "pondling", { energy: ["energy-w"] });
  addBench(s, 0, "sparkbit"); addBench(s, 1, "tidepup");
  const notes = give(s, 0, "prof-notes"); // draws until 6 cards in hand
  s.players[0].deck = s.players[0].deck.slice(0, 2); // 2 cards left: Notes empties the deck and the next turn's draw loses the game
  const g = greedyAgent(s, makeRng(1));
  assert.ok(g.type === "playSupporter" && g.card === notes, `greedy chose ${JSON.stringify(g)}`);
  const ev = evaluateActions(s, 0, SMALL, makeRng(1));
  const best = ev[bestIndex(ev)]!;
  assert.ok(best.action.type !== "playSupporter", `search chose ${JSON.stringify(best.action)}`);
  const notesEval = ev.find((e) => e.action.type === "playSupporter")!;
  assert.equal(notesEval.winProb, 0, "the deck-out line is a certain loss inside the search horizon");
  assert.ok(best.winProb! > 0, `best line ${best.winProb}`);
  // play it through: after the search's line the game is still on at P0's next turn start
  const a = searchAgent(SMALL)(s, makeRng(1));
  assert.ok(a.type !== "playSupporter");
});

// ------------------------------------------------------------------ mirror
test("mirror: search vs search (30 games, tiny budget) completes, ending mostly by prizes / no Pokémon", () => {
  const cfg: Partial<SearchConfig> = { determinizations: 2, iterations: 8, rolloutTurns: 2 };
  const a = searchAgent(cfg);
  const reasons: Record<string, number> = {};
  let turns = 0;
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) {
    const [x, y] = PAIRS[i % 4]!;
    const r = playGame(x, y, 900 + i, a, a);
    assert.ok(r.winner !== null && r.reason !== "maxTurns" && r.reason !== "actionLimit", `seed ${900 + i}: ${r.reason}`);
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    turns += r.turns;
  }
  console.log(`  [search mirror] reasons ${JSON.stringify(reasons)}, avg turns ${(turns / 30).toFixed(1)}, ${((performance.now() - t0) / 30).toFixed(0)} ms/game`);
  assert.ok(((reasons["prizes"] ?? 0) + (reasons["no-pokemon"] ?? 0)) / 30 >= 0.6);
});

test("opponentModel 'search': both sides searched inside the tree, no exceptions", () => {
  const cfg: Partial<SearchConfig> = { determinizations: 1, iterations: 6, rolloutTurns: 2, opponentModel: "search" };
  for (let i = 0; i < 3; i++) {
    const r = playGame(D, Z, 70 + i, searchAgent(cfg), greedyAgent);
    assert.ok(r.winner !== null);
  }
});
