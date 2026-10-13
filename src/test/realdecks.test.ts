// Milestone 2 part 2b: the two real Standard decks play complete games end to end (random agents).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decider } from "../actions.js";
import { greedyAgent } from "../agents/greedy.js";
import { randomAgent, type Agent } from "../agents/random.js";
import { applyAction, createGame } from "../game.js";
import { makeRng } from "../rng.js";
import { allCardsOf, inPlay } from "../state.js";
import { mainState, setActive, applyAction as apply } from "./helpers.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../cards/standard/index.js";
import type { CardDef } from "../cards/model.js";
import { KEY_EFFECTS, keyEffectUses, playGame, type GameResult } from "../sim.js";

interface Batch { games: number; winsA: number; winsB: number; draws: number; turns: number; reasons: Record<string, number>; uses: Record<string, number>; results: GameResult[] }
/** Games seeds 1..n; deck A is player 0 on odd seeds' complement (alternating) so both decks go first equally often. */
function batch(a: CardDef[], b: CardDef[], n: number, keepLogs = false, agentA: Agent = randomAgent, agentB: Agent = randomAgent): Batch {
  const r: Batch = { games: n, winsA: 0, winsB: 0, draws: 0, turns: 0, reasons: {}, uses: Object.fromEntries(KEY_EFFECTS.map((k) => [k, 0])), results: [] };
  for (let seed = 1; seed <= n; seed++) {
    const aFirst = seed % 2 === 1;
    const res = playGame(aFirst ? a : b, aFirst ? b : a, seed, aFirst ? agentA : agentB, aFirst ? agentB : agentA, 200); // any exception fails the test
    assert.notEqual(res.reason, "maxTurns", `seed ${seed} hit maxTurns`);
    assert.notEqual(res.reason, "actionLimit", `seed ${seed} looped within a turn`);
    r.turns += res.turns;
    r.reasons[res.reason] = (r.reasons[res.reason] ?? 0) + 1;
    if (res.winner === null) r.draws++; else if ((res.winner === 0) === aFirst) r.winsA++; else r.winsB++;
    for (const [k, c] of Object.entries(keyEffectUses(res.log))) r.uses[k]! += c;
    if (keepLogs) r.results.push(res);
  }
  return r;
}
const fmt = (name: string, b: Batch) =>
  `${name}: A ${b.winsA} / B ${b.winsB} / draws ${b.draws}, avg turns ${(b.turns / b.games).toFixed(1)}, reasons ${JSON.stringify(b.reasons)}, key uses ${JSON.stringify(b.uses)}`;

test("300 games Dragapult ex vs N's Zoroark ex (random agents): no exceptions, none hit maxTurns, key effects exercised", (t) => {
  const b = batch(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, 300);
  t.diagnostic(fmt("Dragapult(A) vs Zoroark(B)", b));
  assert.equal(b.winsA + b.winsB + b.draws, 300);
  assert.equal(b.draws, 0);
  assert.ok(b.uses["Phantom Dive"]! > 0, "Phantom Dive was used");
  assert.ok(b.uses["Night Joker"]! > 0, "Night Joker was used");
  assert.ok(b.uses["Trade"]! > 0, "Trade was used");
});

test("100 games Dragapult mirror and 100 games Zoroark mirror finish cleanly", (t) => {
  const d = batch(DRAGAPULT_EX_DECK, DRAGAPULT_EX_DECK, 100);
  t.diagnostic(fmt("Dragapult mirror", d));
  const z = batch(NS_ZOROARK_EX_DECK, NS_ZOROARK_EX_DECK, 100);
  t.diagnostic(fmt("Zoroark mirror", z));
  assert.ok(d.uses["Recon Directive"]! > 0 && d.uses["Phantom Dive"]! > 0);
  assert.ok(z.uses["Night Joker"]! > 0 && z.uses["Trade"]! > 0);
});

test("determinism: the same seed replays to an identical log and result", () => {
  for (const seed of [1, 7, 42, 123]) {
    const a = playGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, seed, randomAgent, randomAgent, 200);
    const b = playGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, seed, randomAgent, randomAgent, 200);
    assert.deepEqual(a.log, b.log);
    assert.deepEqual([a.winner, a.reason, a.turns], [b.winner, b.reason, b.turns]);
  }
});

// ------------------------------------------------------------------ rules sanity over whole games (settles "do games really end by deck-out?")
test("rules sanity over 120 real-deck games: ex = 2 Prizes / non-ex = 1, 1 natural draw per turn, 60 cards per player all game", () => {
  let kos = 0;
  for (const [agent, label] of [[randomAgent, "random"], [greedyAgent, "greedy"]] as Array<[Agent, string]>) {
    for (let seed = 1; seed <= 60; seed++) {
      const decks = seed % 2 ? [DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK] : [NS_ZOROARK_EX_DECK, DRAGAPULT_EX_DECK];
      let s = createGame(decks[0]!, decks[1]!, seed);
      const rngs = [makeRng(seed ^ 0x9e3779b9), makeRng(seed ^ 0x85ebca6b)];
      let seen = 0, steps = 0;
      while (s.phase !== "over" && s.turn <= 200 && steps++ < 50000) {
        const d = decider(s)!;
        const act = agent(s, rngs[d]!);
        const pre = s, preDeck = s.players.map((p) => p.deck.length), prePrizes = s.players.map((p) => p.prizes.length);
        s = applyAction(s, act);
        const fresh = s.log.slice(seen); seen = s.log.length;
        const taken: Record<string, number> = {};
        let ko = "";
        for (const l of fresh) {
          const k = l.match(/^T\d+ P\d (.+) is Knocked Out$/); if (k) { ko = k[1]!; kos++; }
          const m = l.match(/^T\d+ P(\d) takes (\d+) prize/);
          if (m) {
            const left = prePrizes[Number(m[1])]! - (taken[m[1]!] ?? 0);
            assert.equal(Number(m[2]), Math.min(/ ex$/.test(ko) ? 2 : 1, left), `${label} seed ${seed}: ${ko} prize count`);
            taken[m[1]!] = (taken[m[1]!] ?? 0) + Number(m[2]);
          }
        }
        if (pre.turn > 0 && !s.pendingChoice && s.turn !== pre.turn && s.phase !== "over")
          assert.equal(s.players[s.activePlayer].deck.length - preDeck[s.activePlayer]!, -1, `${label} seed ${seed}: natural draw is exactly 1 card`);
        if (!s.pendingChoice) for (const ps of s.players) {
          const owned = ps.deck.length + ps.hand.length + ps.discard.length + ps.prizes.length + ps.lostZone.length + inPlay(ps).flatMap(allCardsOf).length
            + (s.stadium && s.players[s.stadium.owner] === ps ? 1 : 0);
          assert.equal(owned, 60, `${label} seed ${seed}: card count drifted`);
        }
      }
    }
  }
  assert.ok(kos > 100, "plenty of Knock Outs were checked");
});

test("vanilla attack damage = printed damage, doubled on Weakness", () => {
  const s = mainState(); setActive(s, 0, "sv9-97", { energy: ["basic-d"] }); // N's Zorua, Scratch 20 (Darkness)
  setActive(s, 1, "sv6-95"); // Munkidori: weak to Darkness
  assert.equal(apply(s, { type: "attack", attackIndex: 0 }).players[1].active!.damage, 40);
  const t = mainState(); setActive(t, 0, "sv9-97", { energy: ["basic-d"] }); setActive(t, 1, "sv9-98"); // N's Zoroark ex: weak to Grass only
  assert.equal(apply(t, { type: "attack", attackIndex: 0 }).players[1].active!.damage, 20);
});

// ------------------------------------------------------------------ greedy heuristic agent
test("300 games greedy vs greedy: never throws, and most games end by Prizes / no Pokémon (not deck-out)", (t) => {
  const b = batch(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, 300, false, greedyAgent, greedyAgent);
  t.diagnostic(fmt("greedy vs greedy, Dragapult(A) vs Zoroark(B)", b));
  const decisive = (b.reasons["prizes"] ?? 0) + (b.reasons["no-pokemon"] ?? 0);
  assert.ok(decisive > 150, `only ${decisive}/300 games ended by prizes or no-pokemon`);
  assert.ok(b.uses["Phantom Dive"]! > 0 && b.uses["Night Joker"]! > 0);
});

test("300 games greedy vs random (greedy is deck A's pilot): never throws, finishes", (t) => {
  const b = batch(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, 300, false, greedyAgent, randomAgent);
  t.diagnostic(fmt("greedy(Dragapult, A) vs random(Zoroark, B)", b));
  assert.ok(b.winsA > b.winsB, "greedy beats random");
});
