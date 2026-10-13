// Milestone 2 part 2b: the two real Standard decks play complete games end to end (random agents).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomAgent } from "../agents/random.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../cards/standard/index.js";
import type { CardDef } from "../cards/model.js";
import { KEY_EFFECTS, keyEffectUses, playGame, type GameResult } from "../sim.js";

interface Batch { games: number; winsA: number; winsB: number; draws: number; turns: number; reasons: Record<string, number>; uses: Record<string, number>; results: GameResult[] }
/** Games seeds 1..n; deck A is player 0 on odd seeds' complement (alternating) so both decks go first equally often. */
function batch(a: CardDef[], b: CardDef[], n: number, keepLogs = false): Batch {
  const r: Batch = { games: n, winsA: 0, winsB: 0, draws: 0, turns: 0, reasons: {}, uses: Object.fromEntries(KEY_EFFECTS.map((k) => [k, 0])), results: [] };
  for (let seed = 1; seed <= n; seed++) {
    const aFirst = seed % 2 === 1;
    const res = playGame(aFirst ? a : b, aFirst ? b : a, seed, randomAgent, randomAgent, 200); // any exception fails the test
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
