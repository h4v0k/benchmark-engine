// Milestone 3c: the A/B experiment framework (src/experiments/ab.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, applyChanges, parseChange, renderReport, runExperiment, runGames, screenThenConfirm, seatFor, seedFor, toJSON, wilson, type ExperimentSpec } from "../experiments/ab.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../cards/standard/index.js";

const D = DRAGAPULT_EX_DECK, Z = NS_ZOROARK_EX_DECK;
const count = (deck: typeof D, name: string): number => deck.filter((c) => c.name === name).length;

const spec = (variants: ExperimentSpec["variants"], n: number, extra: Partial<ExperimentSpec> = {}): ExperimentSpec => ({
  name: "t", base: { name: "Dragapult", deck: D }, variants,
  field: [{ name: "Dragapult", deck: D, weight: 33.4 }, { name: "Zoroark", deck: Z, weight: 9.4 }],
  gamesPerMatchup: n, agent: "greedy", seedBase: 77, date: "2026-01-01", ...extra,
});

test("applyChanges: edits counts, swaps in place, validates", () => {
  assert.deepEqual(parseChange("-1 Night Stretcher +1 Psychic Energy").map((e) => [e.sign, e.count, e.name]), [[-1, 1, "Night Stretcher"], [1, 1, "Psychic Energy"]]);
  const v = applyChanges(D, "-1 Night Stretcher +1 Psychic Energy");
  assert.equal(v.length, 60);
  assert.equal(count(v, "Night Stretcher"), 2);
  assert.equal(count(v, "Psychic Energy"), 4);
  // in-place: only the swapped position differs
  assert.equal(v.filter((c, i) => c !== D[i]).length, 1);
  assert.equal(applyChanges(D, "-1 Poké Pad -1 Judge +1 Ultra Ball +1 Psychic Energy").length, 60);
  assert.throws(() => applyChanges(D, "+1 Psychic Energy"), /61 cards/);                  // wrong size
  assert.throws(() => applyChanges(D, "-1 Boss's Orders +1 Dreepy"), /5 copies of Dreepy/); // 4-copy rule
  assert.throws(() => applyChanges(D, "-5 Judge +5 Psychic Energy"), /cannot remove/);      // not enough copies
  assert.throws(() => applyChanges(D, "-1 Judge +1 Not A Card"), /unknown card/);
  assert.throws(() => applyChanges(D, "swap a card"), /cannot parse/);
  // ACE SPEC limit: two copies of an ACE SPEC (here a stand-in def) is rejected
  const ace = { ...D.find((c) => c.name === "Judge")!, name: "Test Ace", id: "test-ace", subtypes: ["Item", "AceSpec"] as never };
  assert.throws(() => applyChanges(D, "-2 Poké Pad +2 Test Ace", { "test-ace": ace }), /ACE SPEC/);
});

test("wilson interval sanity", () => {
  const w = wilson(50, 100);
  assert.ok(Math.abs(w.p - 0.5) < 1e-12 && Math.abs(w.lo - 0.404) < 0.002 && Math.abs(w.hi - 0.596) < 0.002, JSON.stringify(w));
  const z = wilson(0, 20); assert.equal(z.lo, 0); assert.ok(z.hi > 0.1 && z.hi < 0.2);
  assert.ok(wilson(500, 1000).hi - wilson(500, 1000).lo < wilson(50, 100).hi - wilson(50, 100).lo);
  assert.ok(wilson(7, 10).lo > 0.3 && wilson(7, 10).hi < 0.95);
});

test("paired seeds and seats are identical across arms (common random numbers)", () => {
  const s = spec([{ name: "v", change: "-1 Night Stretcher +1 Psychic Energy", deck: applyChanges(D, "-1 Night Stretcher +1 Psychic Energy") }], 4);
  const recs = runGames(s);
  assert.equal(recs.length, 4 * 2 * 2);
  for (let g = 0; g < 4; g++) for (let m = 0; m < 2; m++) {
    const cell = recs.filter((r) => r.g === g && r.m === m);
    assert.equal(cell.length, 2);
    assert.equal(cell[0]!.seed, cell[1]!.seed);
    assert.equal(cell[0]!.seed, seedFor(s, m, g));
    assert.equal(cell[0]!.seat, seatFor(g));
    assert.equal(cell[1]!.seat, cell[0]!.seat);
  }
  assert.equal(new Set(recs.map((r) => r.seat)).size, 2, "seats alternate");
  // identical decks => identical games => zero delta with zero variance
  const same = analyze({ ...s, variants: [{ name: "same", change: "-0 x", deck: D }] }, runGames({ ...s, variants: [{ name: "same", change: "-0 x", deck: D }] }));
  assert.equal(same.arms[1]!.delta!.est, 0);
  assert.equal(same.arms[1]!.verdict, "too close to call");
  // sharding: union of shards == one run
  const parts = [...runGames(s, { shard: 0, shards: 2 }), ...runGames(s, { shard: 1, shards: 2 })];
  assert.equal(JSON.stringify(analyze(s, parts)), JSON.stringify(analyze(s, recs)));
});

test("end to end: greedy, 20 games/matchup, parseable report + JSON", () => {
  const s = spec([{ name: "9 Energy", change: "-1 Night Stretcher +1 Psychic Energy", deck: applyChanges(D, "-1 Night Stretcher +1 Psychic Energy") }], 20);
  const res = runExperiment(s);
  assert.equal(res.meta.totalGames, 20 * 2 * 2);
  assert.equal(res.meta.gamesPerMatchup, 20);
  assert.ok(Math.abs(res.meta.field.reduce((x, f) => x + f.weight, 0) - 1) < 1e-9);
  const md = renderReport(res);
  for (const h of ["## Verdict", "## Overall (meta-weighted)", "## Per matchup", "## Mechanism", "## Method notes"]) assert.ok(md.includes(h), h);
  assert.ok(md.indexOf("## Verdict") < md.indexOf("## Overall"));
  assert.ok(/\*\*(better|worse|too close to call)\*\*/.test(md));
  assert.ok(/only 2 archetypes/.test(md));
  assert.ok(/Observational/.test(md));
  const back = JSON.parse(toJSON(res));
  assert.equal(back.arms.length, 2);
  for (const a of back.arms) { assert.ok(a.overall.est >= 0 && a.overall.est <= 1); assert.ok(a.overall.lo <= a.overall.est && a.overall.est <= a.overall.hi); }
  const n = back.arms[1].overall.mech.cards["Psychic Energy"];
  assert.equal(n.copies, 4);
  assert.ok(n.drawnBy3 >= 0 && n.drawnBy3 <= 1 && n.played >= n.playedByN);
});

test("an obviously worse variant (no Dragapult/Drakloak line) is flagged worse at modest n", () => {
  const change = "-3 Dragapult ex -4 Drakloak +7 Psychic Energy";
  const s = spec([{ name: "no payoff", change, deck: applyChanges(D, change) }], 40);
  const res = runExperiment(s);
  const v = res.arms[1]!;
  assert.equal(v.verdict, "worse", `delta ${v.delta!.est} [${v.delta!.lo}, ${v.delta!.hi}]`);
  assert.ok(v.delta!.hi < 0 && v.gamesNeeded === null);
  assert.ok(renderReport(res).includes("**worse**"));
});

test("screenThenConfirm keeps the top variants and confirms them on fresh seeds", async () => {
  const mk = (c: string) => ({ name: c, change: c, deck: applyChanges(D, c) });
  const s = spec([mk("-3 Dragapult ex -4 Drakloak +7 Psychic Energy"), mk("-1 Night Stretcher +1 Psychic Energy"), mk("-1 Judge +1 Psychic Energy")], 0);
  const { screen, final } = await screenThenConfirm(s, { screenGames: 6, confirmGames: 8, keep: 2 });
  assert.equal(screen.stage, "screen"); assert.equal(screen.arms.length, 4);
  assert.equal(final.stage, "confirm"); assert.equal(final.arms.length, 3);
  assert.ok(!final.arms.some((a) => a.change?.includes("Dragapult ex")), "the clearly worst screened variant is dropped");
  assert.equal(final.meta.gamesPerMatchup, 8);
  assert.notEqual(final.meta.seedBase, screen.meta.seedBase);
  assert.equal(final.screen!.kept.length, 2);
  assert.ok(/Final verdicts come from the confirm stage only/.test(renderReport(final)));
});
