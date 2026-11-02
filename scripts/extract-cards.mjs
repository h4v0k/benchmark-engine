#!/usr/bin/env node
// Usage: node scripts/extract-cards.mjs <path-to-pokemon-tcg-data-clone> <decklist.txt> [more.txt ...] [--out data/cards]
// Resolves "count name SET number" lines against the pokemon-tcg-data clone and writes data/cards/<setId>-<number>.json.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
let out = "data/cards";
const oi = argv.indexOf("--out");
if (oi >= 0) { out = argv[oi + 1]; argv.splice(oi, 2); }
const [dataDir, ...lists] = argv;
if (!dataDir || !lists.length) { console.error("usage: extract-cards.mjs <pokemon-tcg-data dir> <decklist...> [--out dir]"); process.exit(2); }

const KEEP = ["id","name","supertype","subtypes","hp","types","evolvesFrom","abilities","attacks","rules","weaknesses","resistances","retreatCost","regulationMark","number","rarity"];
const sets = JSON.parse(fs.readFileSync(path.join(dataDir, "sets/en.json"), "utf8"));
const byCode = new Map(sets.map((s) => [s.ptcgoCode, s]));
const cache = new Map();
const setCards = (id) => cache.get(id) ?? (cache.set(id, JSON.parse(fs.readFileSync(path.join(dataDir, "cards/en", id + ".json"), "utf8"))), cache.get(id));
const BASIC_E = /^(?:Basic )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal) Energy$/;

const wanted = new Map(); // key -> {name, code, number}
for (const f of lists) {
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^(\d+)\s+(.+?)(?:\s+([A-Z0-9]{2,4})\s+(\d+))?$/);
    if (!m) continue;
    const [, , name, code, number] = m;
    wanted.set(`${name}|${code ?? ""}|${number ?? ""}`, { name, code, number });
  }
}

const rows = [];
fs.mkdirSync(out, { recursive: true });
for (const { name, code, number } of wanted.values()) {
  if (BASIC_E.test(name)) { rows.push(["basic-energy (synthesized in code)", name, code, number, ""]); continue; }
  let card, status = "resolved";
  const set = code && byCode.get(code);
  if (set) card = setCards(set.id).find((c) => c.number === number && c.name === name);
  if (!card) {
    // fallback: exact name, any set, newest Standard-legal (regulationMark >= H) printing
    const cands = [];
    for (const s of sets) for (const c of setCards(s.id)) if (c.name === name && (c.regulationMark ?? "") >= "H") cands.push({ c, date: s.releaseDate });
    cands.sort((a, b) => b.date.localeCompare(a.date));
    card = cands[0]?.c; status = card ? "fallback-by-name" : "unresolved";
  }
  if (!card) { rows.push([status, name, code, number, ""]); continue; }
  const raw = {};
  for (const k of KEEP) if (card[k] !== undefined) raw[k] = card[k];
  const sid = card.id.slice(0, card.id.lastIndexOf("-"));
  const s = sets.find((x) => x.id === sid);
  raw.set = { id: sid, ptcgoCode: s?.ptcgoCode };
  const file = `${sid}-${card.number}.json`;
  fs.writeFileSync(path.join(out, file), JSON.stringify(raw, null, 2) + "\n");
  rows.push([status, name, code, number, file]);
}
for (const r of rows.sort()) console.log(r.join("\t"));
const n = (s) => rows.filter((r) => r[0].startsWith(s)).length;
console.log(`\nresolved=${n("resolved")} fallback=${n("fallback")} unresolved=${n("unresolved")} basic-energy=${n("basic-energy")}`);
