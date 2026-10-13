#!/usr/bin/env node
// Usage: node scripts/experiment.mjs <spec.json> [--shards N] [--budget-min M]     (run `npm run build` first)
// Spec JSON: { name, base: {deck:"dragapult"}, variants: [{name, change:"-1 Night Stretcher +1 Psychic Energy"}],
//   field: [{deck:"dragapult", weight:33.4}, {deck:"zoroark", weight:9.4}], gamesPerMatchup, agent, seedBase,
//   screen?: {agent, gamesPerMatchup, keep}, confirm?: {agent, gamesPerMatchup, seedBase?} }
// With screen+confirm: runs screenThenConfirm. --shards N splits game indices across N processes (default 1);
// --budget-min M stops the (final) stage after M wall-clock minutes at a game-index boundary (all arms stay balanced).
// Writes experiments/<name>-<date>/{report.md,result.json,*-spec.json}.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyze, applyChanges, confirmSpecFrom, renderReport, runGames, toJSON } from "../dist/index.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../dist/cards/standard/index.js";

const DECKS = { dragapult: DRAGAPULT_EX_DECK, zoroark: NS_ZOROARK_EX_DECK };
const deckByName = (n) => { if (!DECKS[n]) throw new Error(`unknown deck "${n}" (${Object.keys(DECKS).join(" | ")})`); return DECKS[n]; };

/** JSON spec -> ExperimentSpec (decks resolved, changes applied and validated). */
export function buildSpec(j) {
  const baseDeck = deckByName(j.base.deck);
  return {
    name: j.name, base: { name: j.base.name ?? j.base.deck, deck: baseDeck, mainAttacker: j.base.mainAttacker },
    variants: j.variants.map((v) => ({ name: v.name, change: v.change, deck: applyChanges(baseDeck, v.change) })),
    field: j.field.map((f) => ({ name: f.name ?? f.deck, deck: deckByName(f.deck), weight: f.weight })),
    gamesPerMatchup: j.gamesPerMatchup, agent: j.agent, seedBase: j.seedBase, stage: j.stage, date: j.date, turnN: j.turnN,
  };
}

const argv = process.argv.slice(2);
if (argv[0] === "--worker") {
  const [, specFile, shard, shards, out, deadline] = argv;
  const recs = runGames(buildSpec(JSON.parse(readFileSync(specFile, "utf8"))), { shard: Number(shard), shards: Number(shards), deadline: deadline === "0" ? undefined : Number(deadline) });
  writeFileSync(out, JSON.stringify(recs));
  process.exit(0);
}

const takeOpt = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const shards = Number(takeOpt("--shards") ?? 1), budgetMin = takeOpt("--budget-min");
const [specPath] = argv;
if (!specPath) { console.error("usage: experiment.mjs <spec.json> [--shards N] [--budget-min M]"); process.exit(2); }
const J = JSON.parse(readFileSync(specPath, "utf8"));
const date = J.date ?? new Date().toISOString().slice(0, 10);
const dir = `experiments/${J.name}-${date}`;
mkdirSync(dir, { recursive: true });
const self = fileURLToPath(import.meta.url);

async function runStage(stageJson, label, budget) {
  const specFile = `${dir}/${label}-spec.json`;
  writeFileSync(specFile, JSON.stringify(stageJson, null, 2));
  const deadline = budget ? Date.now() + budget * 60000 : 0;
  const t0 = Date.now();
  const outs = await Promise.all(Array.from({ length: shards }, (_, s) => new Promise((res, rej) => {
    const out = `${dir}/${label}-records-${s}.json`;
    const c = fork(self, ["--worker", specFile, String(s), String(shards), out, String(deadline)]);
    c.on("exit", (code) => (code === 0 ? res(out) : rej(new Error(`worker ${s} exited ${code}`))));
  })));
  const records = outs.flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
  console.error(`${label}: ${records.length} games in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  return analyze(buildSpec(stageJson), records);
}

const common = { name: J.name, base: J.base, variants: J.variants, field: J.field, date, turnN: J.turnN };
let result;
if (J.screen && J.confirm) {
  const screen = await runStage({ ...common, gamesPerMatchup: J.screen.gamesPerMatchup, agent: J.screen.agent, seedBase: J.seedBase, stage: "screen" }, "screen");
  const o = { screenGames: J.screen.gamesPerMatchup, confirmGames: J.confirm.gamesPerMatchup, keep: J.screen.keep, confirmAgent: J.confirm.agent, confirmSeedBase: J.confirm.seedBase };
  const cs = confirmSpecFrom(buildSpec({ ...common, gamesPerMatchup: 1, agent: J.screen.agent, seedBase: J.seedBase }), screen, o);
  const kept = new Set(cs.variants.map((v) => v.name));
  writeFileSync(`${dir}/screen-result.json`, toJSON(screen));
  result = await runStage({ ...common, variants: J.variants.filter((v) => kept.has(v.name)), gamesPerMatchup: o.confirmGames, agent: o.confirmAgent, seedBase: cs.seedBase, stage: "confirm" }, "confirm", budgetMin ? Number(budgetMin) : 0);
  result.screen = { agent: screen.meta.agent, gamesPerMatchup: screen.meta.gamesPerMatchup, kept: [...kept], deltas: screen.arms.slice(1).map((r) => ({ name: r.name, delta: r.delta.est, lo: r.delta.lo, hi: r.delta.hi })) };
} else {
  result = await runStage({ ...common, gamesPerMatchup: J.gamesPerMatchup, agent: J.agent, seedBase: J.seedBase }, "run", budgetMin ? Number(budgetMin) : 0);
}
writeFileSync(`${dir}/report.md`, renderReport(result));
writeFileSync(`${dir}/result.json`, toJSON(result));
console.error(`wrote ${dir}/report.md and result.json`);
