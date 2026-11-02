// Permanent regression guard: greedy-vs-greedy, Dragapult ex vs N's Zoroark ex, seeds 1..50 (seat alternates by seed).
// The fixture was generated BEFORE the speed pass; performance work must not change a single game's winner, reason or length.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { greedyAgent } from "../agents/greedy.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../cards/standard/index.js";
import { playGame } from "../sim.js";

interface Golden { seed: number; winner: number | null; reason: string; turns: number }
// tests run from dist/test; the fixture lives in src/test/fixtures (not copied by tsc)
const GOLDEN: Golden[] = JSON.parse(readFileSync(new URL("../../src/test/fixtures/golden-50.json", import.meta.url).pathname, "utf8"));

test("golden-50: greedy-vs-greedy results are reproduced exactly (winner, reason, turns)", () => {
  assert.equal(GOLDEN.length, 50);
  for (let i = 0; i < GOLDEN.length; i++) {
    const g = GOLDEN[i]!;
    const [a, b] = i % 2 === 0 ? [DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK] : [NS_ZOROARK_EX_DECK, DRAGAPULT_EX_DECK];
    const r = playGame(a, b, g.seed, greedyAgent, greedyAgent);
    assert.deepEqual({ seed: r.seed, winner: r.winner, reason: r.reason, turns: r.turns }, g, `seed ${g.seed} diverged from the golden fixture`);
  }
});
