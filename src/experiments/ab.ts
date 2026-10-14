// Milestone 3c: the A/B experiment framework. The engine as an evaluation oracle: a base list and N variants (each a small
// edit of the base) are played against a weighted field of decks, and every number below comes from the game results or the
// structured event stream (src/events.ts).
//
// Statistical design (details in docs/EXPERIMENTS.md):
//  * Common random numbers. For matchup m and game index g, EVERY arm (base and each variant) uses the same seed and the same
//    seat. Variants that edit a card in place (see `applyChanges`) therefore draw identical opening hands until the changed
//    card is touched, so the per-game win differences are strongly positively correlated and the paired-difference interval
//    is much tighter than the difference of two independent intervals.
//  * Per-matchup win rates carry a 95% Wilson interval. Overall (meta-weighted) rates and deltas propagate per-matchup
//    variance by weight: var = sum_m w_m^2 var_m, normal 95% interval.
//  * A variant's verdict is 'better' / 'worse' only if the overall paired-delta interval excludes 0, else 'too close to call'
//    together with the games needed to shrink the interval half-width to 2 points.
//  * Many variants => some look good by chance. `screenThenConfirm` screens cheaply, then re-runs the top few on FRESH seeds;
//    verdicts come only from the confirm stage.
import { getDef, type CardDef } from "../cards/model.js";
import { CARD_DEFS } from "../cards/standard/index.js";
import { validateDeck } from "../cards/model.js";
import { greedyAgent } from "../agents/greedy.js";
import type { Agent } from "../agents/random.js";
import { searchAgent, SEARCH_PRESETS } from "../agents/search.js";
import { playGame } from "../sim.js";
import type { PlayerId } from "../state.js";

export type AgentName = "greedy" | "search:fast" | "search:strong";
export type Verdict = "better" | "worse" | "too close to call";
export interface DeckEntry { name: string; deck: CardDef[]; /** card name of the deck's main attacker; default = the Pokémon with the highest printed attack damage */ mainAttacker?: string }
export interface VariantSpec extends DeckEntry { /** human description of the edit, e.g. "-1 Night Stretcher +1 Psychic Energy"; also names the tracked cards */ change: string }
export interface FieldEntry { name: string; deck: CardDef[]; /** meta share; normalized across the field */ weight: number }
export interface ExperimentSpec {
  name: string; base: DeckEntry; variants: VariantSpec[]; field: FieldEntry[]; gamesPerMatchup: number;
  agent: AgentName; seedBase: number; stage?: "screen" | "confirm"; /** ISO date for the report (default: today) */ date?: string;
  /** "played by turn N" threshold (game turn number, both players' turns count); default 4 */ turnN?: number;
}

// ---------------------------------------------------------------- change strings
export interface Edit { sign: 1 | -1; count: number; name: string }
/** Parse "-1 Night Stretcher +1 Psychic Energy" into edits. */
export function parseChange(change: string): Edit[] {
  const edits: Edit[] = [];
  const re = /([+-])\s*(\d+)\s+(.+?)(?=\s+[+-]\s*\d+\s|\s*$)/g;
  for (const m of change.trim().matchAll(re)) edits.push({ sign: m[1] === "+" ? 1 : -1, count: Number(m[2]), name: m[3]!.trim() });
  if (!edits.length || !/^\s*[+-]/.test(change)) throw new Error(`applyChanges: cannot parse "${change}" (expected "-N Card +N Card")`);
  return edits;
}
/**
 * Apply "-N CardName +N CardName" count edits to a list. Removed cards are replaced IN PLACE by added cards (same list position)
 * so the seeded shuffle gives paired arms identical draws until the swapped card is touched. Throws unless the result is a
 * legal deck (60 cards, <=4 copies, <=1 ACE SPEC, a Basic Pokémon).
 */
export function applyChanges(deck: CardDef[], change: string, defs: Record<string, CardDef> = CARD_DEFS): CardDef[] {
  const edits = parseChange(change);
  const out: Array<CardDef | null> = deck.slice();
  const vacated: number[] = [];
  for (const e of edits.filter((x) => x.sign < 0)) {
    for (let i = 0; i < e.count; i++) {
      const idx = out.findIndex((c) => c !== null && c.name === e.name);
      if (idx < 0) throw new Error(`applyChanges: cannot remove ${e.count} ${e.name} (deck has fewer)`);
      out[idx] = null; vacated.push(idx);
    }
  }
  vacated.sort((a, b) => a - b);
  const adds: CardDef[] = [];
  for (const e of edits.filter((x) => x.sign > 0)) {
    const def = deck.find((c) => c.name === e.name) ?? Object.values(defs).find((d) => d.name === e.name);
    if (!def) throw new Error(`applyChanges: unknown card "${e.name}"`);
    for (let i = 0; i < e.count; i++) adds.push(def);
  }
  for (const a of adds) { const slot = vacated.shift(); if (slot === undefined) out.push(a); else out[slot] = a; }
  const result = out.filter((c): c is CardDef => c !== null);
  const errs = validateDeck(result);
  if (errs.length) throw new Error(`applyChanges("${change}") makes an illegal deck: ${errs.join("; ")}`);
  return result;
}

// ---------------------------------------------------------------- statistics
export const Z95 = 1.959964;
/** Wilson score interval for `k` successes in `n` trials (k may be fractional when draws count 1/2). */
export function wilson(k: number, n: number, z = Z95): { p: number; lo: number; hi: number } {
  if (n <= 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n, z2 = z * z, den = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / den, h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
const variance = (a: number[]): number => { if (a.length < 2) return 0; const m = mean(a); return a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1); };
export interface Est { est: number; se: number; lo: number; hi: number }
const mkEst = (est: number, se: number): Est => ({ est, se, lo: est - Z95 * se, hi: est + Z95 * se });

// ---------------------------------------------------------------- per-game records
interface CardRec { drawn3: boolean; played: boolean; playedTurn: number | null }
/** One game of one arm, reduced from the event stream. */
export interface GameRecord {
  m: number; arm: number; g: number; seed: number; seat: PlayerId;
  /** 1 win, 0.5 draw, 0 loss for the arm's deck */ score: number; reason: string; turns: number;
  kos: number; prizes: number; firstKo: number | null; mainAtk: number | null; deckOut: number; cards: Record<string, CardRec>;
}
export const seedFor = (spec: Pick<ExperimentSpec, "seedBase">, m: number, g: number): number => spec.seedBase + m * 100000 + g;
export const seatFor = (g: number): PlayerId => (g % 2) as PlayerId;

export function resolveAgent(name: AgentName): Agent {
  if (name === "greedy") return greedyAgent;
  const preset = name === "search:fast" ? SEARCH_PRESETS.fast : name === "search:strong" ? SEARCH_PRESETS.strong : null;
  if (!preset) throw new Error(`unknown agent "${name}"`);
  return searchAgent(preset);
}
export function defaultMainAttacker(deck: CardDef[]): string {
  let best = "", dmg = -1;
  for (const d of deck) for (const a of d.attacks ?? []) if ((a.damage ?? 0) > dmg) { dmg = a.damage ?? 0; best = d.name; }
  return best;
}
export function changedCards(spec: Pick<ExperimentSpec, "variants">): string[] {
  return [...new Set(spec.variants.flatMap((v) => parseChange(v.change).map((e) => e.name)))];
}
const armsOf = (spec: ExperimentSpec): Array<DeckEntry & { change?: string }> => [spec.base, ...spec.variants];

function reduceGame(events: import("../events.js").GameEvent[], seat: PlayerId, mainAttacker: string, tracked: string[], winner: PlayerId | null, reason: string, turns: number): Omit<GameRecord, "m" | "arm" | "g" | "seed" | "seat"> {
  let kos = 0, prizes = 0, firstKo: number | null = null, mainAtk: number | null = null;
  const cards: Record<string, CardRec> = Object.fromEntries(tracked.map((n) => [n, { drawn3: false, played: false, playedTurn: null as number | null }]));
  const markPlayed = (name: string, turn: number): void => { const c = cards[name]; if (c) { c.played = true; if (c.playedTurn === null || turn < c.playedTurn) c.playedTurn = turn; } };
  for (const e of events) {
    switch (e.type) {
      case "ko": if (e.takenBy === seat) { kos++; if (firstKo === null) firstKo = e.turn; } break;
      case "prize": if (e.player === seat) prizes += e.count; break;
      case "attack": if (e.player === seat && e.attackerName === mainAttacker && mainAtk === null) mainAtk = e.turn; break;
      case "draw": if (e.player === seat && e.turn <= 3) for (const id of e.cardIds) { const c = cards[getDef(id.split("#")[0]!).name]; if (c) c.drawn3 = true; } break;
      case "play": if (e.player === seat) markPlayed(e.cardName, e.turn); break;
      case "attachEnergy": if (e.player === seat) markPlayed(e.cardName, e.turn); break;
      case "evolve": if (e.player === seat) markPlayed(e.toName, e.turn); break;
      case "putOnBench": if (e.player === seat) markPlayed(e.pokemonName, e.turn); break;
    }
  }
  const score = winner === null ? 0.5 : winner === seat ? 1 : 0;
  return { score, reason, turns, kos, prizes, firstKo, mainAtk, deckOut: reason === "deckout" && winner !== seat ? 1 : 0, cards };
}

export interface RunOptions { shard?: number; shards?: number; /** stop starting new game indices after this wall-clock time (ms epoch) */ deadline?: number; onProgress?: (g: number) => void }
/**
 * Play the games. Loop order is game-index major (g, then matchup, then arm), so stopping at a deadline leaves every
 * matchup and arm with the same completed prefix. Shard s of S plays the indices g with g % S == s.
 */
export function runGames(spec: ExperimentSpec, opts: RunOptions = {}): GameRecord[] {
  const shard = opts.shard ?? 0, shards = opts.shards ?? 1;
  const agent = resolveAgent(spec.agent);
  const tracked = changedCards(spec);
  const arms = armsOf(spec);
  const mains = arms.map((a) => a.mainAttacker ?? defaultMainAttacker(a.deck));
  const out: GameRecord[] = [];
  for (let g = 0; g < spec.gamesPerMatchup; g++) {
    if (g % shards !== shard) continue;
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    for (let m = 0; m < spec.field.length; m++) {
      const seed = seedFor(spec, m, g), seat = seatFor(g);
      for (let a = 0; a < arms.length; a++) {
        const [d0, d1] = seat === 0 ? [arms[a]!.deck, spec.field[m]!.deck] : [spec.field[m]!.deck, arms[a]!.deck];
        const r = playGame(d0, d1, seed, agent, agent);
        out.push({ m, arm: a, g, seed, seat, ...reduceGame(r.events, seat, mains[a]!, tracked, r.winner, r.reason, r.turns) });
      }
    }
    opts.onProgress?.(g);
  }
  return out;
}

// ---------------------------------------------------------------- analysis
export interface CardMech {
  copies: number; drawnBy3: number; played: number; playedByN: number; avgFirstPlayTurn: number | null;
  /** share of ALL games where the card was first played by the seat's own turn k (k = 1..6, cumulative), and the mean own turn of the first play */
  playedByOwn: number[]; avgFirstPlayOwnTurn: number | null;
  /** OBSERVATIONAL split (not causal: games where a card gets played differ in many other ways) */
  whenPlayed: { n: number; score: number }; whenNotPlayed: { n: number; score: number };
}
export interface Mech {
  n: number; avgTurns: number; reasons: Record<string, number>; kosPerGame: number; prizesPerGame: number;
  firstKoTurn: number | null; mainAttackTurn: number | null; mainAttackRate: number; deckOutRate: number; cards: Record<string, CardMech>;
  /** own-turn numbers (the seat's k-th turn = ceil(game turn / 2)): mean first-KO / first main-attacker-attack own turn, and share of ALL games with a main-attacker attack by own turn 2 / 3 / 4 */
  firstKoOwnTurn: number | null; mainAttackOwnTurn: number | null; mainAttackByOwn: number[];
}
export const ownTurn = (gameTurn: number): number => Math.ceil(gameTurn / 2);
export interface MatchupRow { field: string; weight: number; n: number; score: number; lo: number; hi: number; mech: Mech }
export interface DeltaRow { field: string; delta: number; lo: number; hi: number; se: number }
export interface ArmResult {
  name: string; change: string | null; mainAttacker: string; matchups: MatchupRow[];
  overall: Est & { mech: Mech };
  /** present for variants */ deltas?: DeltaRow[]; delta?: Est; verdict?: Verdict; /** games per matchup (per arm, paired) for a 2-point interval half-width; null unless too close */ gamesNeeded?: number | null;
  mechanism?: MechFinding[];
}
export interface MechFinding { scope: string; metric: string; diff: number; se: number; significant: boolean; text: string }
export interface ExperimentResult {
  name: string; stage: "screen" | "confirm" | "single"; arms: ArmResult[];
  meta: { date: string; agent: AgentName; seedBase: number; gamesPerMatchup: number; gamesRequested: number; totalGames: number; field: Array<{ name: string; weight: number }>; changedCards: string[]; turnN: number };
  screen?: { agent: AgentName; gamesPerMatchup: number; kept: string[]; deltas: Array<{ name: string; delta: number; lo: number; hi: number }> };
}

function mechOf(recs: GameRecord[], tracked: string[], copies: Record<string, number>, turnN: number): Mech {
  const n = recs.length;
  const reasons: Record<string, number> = {};
  for (const r of recs) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1 / n;
  const ko = recs.filter((r) => r.firstKo !== null), at = recs.filter((r) => r.mainAtk !== null);
  const cards: Record<string, CardMech> = {};
  for (const c of tracked) {
    const pl = recs.filter((r) => r.cards[c]!.played), np = recs.filter((r) => !r.cards[c]!.played);
    const turns = pl.map((r) => r.cards[c]!.playedTurn!);
    cards[c] = {
      copies: copies[c] ?? 0, drawnBy3: recs.filter((r) => r.cards[c]!.drawn3).length / n, played: pl.length / n,
      playedByN: recs.filter((r) => r.cards[c]!.playedTurn !== null && r.cards[c]!.playedTurn! <= turnN).length / n,
      avgFirstPlayTurn: turns.length ? mean(turns) : null,
      playedByOwn: [1, 2, 3, 4, 5, 6].map((k) => recs.filter((r) => r.cards[c]!.playedTurn !== null && ownTurn(r.cards[c]!.playedTurn!) <= k).length / n),
      avgFirstPlayOwnTurn: turns.length ? mean(turns.map(ownTurn)) : null,
      whenPlayed: { n: pl.length, score: pl.reduce((x, r) => x + r.score, 0) }, whenNotPlayed: { n: np.length, score: np.reduce((x, r) => x + r.score, 0) },
    };
  }
  return {
    n, avgTurns: mean(recs.map((r) => r.turns)), reasons, kosPerGame: mean(recs.map((r) => r.kos)), prizesPerGame: mean(recs.map((r) => r.prizes)),
    firstKoTurn: ko.length ? mean(ko.map((r) => r.firstKo!)) : null, mainAttackTurn: at.length ? mean(at.map((r) => r.mainAtk!)) : null,
    mainAttackRate: at.length / n, deckOutRate: mean(recs.map((r) => r.deckOut)), cards,
    firstKoOwnTurn: ko.length ? mean(ko.map((r) => ownTurn(r.firstKo!))) : null, mainAttackOwnTurn: at.length ? mean(at.map((r) => ownTurn(r.mainAtk!))) : null,
    mainAttackByOwn: [2, 3, 4].map((k) => at.filter((r) => ownTurn(r.mainAtk!) <= k).length / n),
  };
}
/** Field-weighted combination of per-matchup Mech (scalars weighted; nulls renormalized; played-vs-not splits pooled unweighted). */
function combineMech(ms: Mech[], w: number[]): Mech {
  const wm = (get: (m: Mech) => number | null): number | null => {
    let s = 0, t = 0; ms.forEach((m, i) => { const v = get(m); if (v !== null) { s += w[i]! * v; t += w[i]!; } });
    return t ? s / t : null;
  };
  const reasons: Record<string, number> = {};
  ms.forEach((m, i) => { for (const [k, v] of Object.entries(m.reasons)) reasons[k] = (reasons[k] ?? 0) + w[i]! * v; });
  const cards: Record<string, CardMech> = {};
  for (const c of Object.keys(ms[0]!.cards)) {
    const pool = (sel: (cm: CardMech) => { n: number; score: number }): { n: number; score: number } => ({ n: ms.reduce((x, m) => x + sel(m.cards[c]!).n, 0), score: ms.reduce((x, m) => x + sel(m.cards[c]!).score, 0) });
    cards[c] = {
      copies: ms[0]!.cards[c]!.copies, drawnBy3: wm((m) => m.cards[c]!.drawnBy3)!, played: wm((m) => m.cards[c]!.played)!, playedByN: wm((m) => m.cards[c]!.playedByN)!,
      avgFirstPlayTurn: wm((m) => m.cards[c]!.avgFirstPlayTurn), avgFirstPlayOwnTurn: wm((m) => m.cards[c]!.avgFirstPlayOwnTurn),
      playedByOwn: ms[0]!.cards[c]!.playedByOwn.map((_, k) => wm((m) => m.cards[c]!.playedByOwn[k]!)!), whenPlayed: pool((cm) => cm.whenPlayed), whenNotPlayed: pool((cm) => cm.whenNotPlayed),
    };
  }
  return {
    n: ms.reduce((x, m) => x + m.n, 0), avgTurns: wm((m) => m.avgTurns)!, reasons, kosPerGame: wm((m) => m.kosPerGame)!, prizesPerGame: wm((m) => m.prizesPerGame)!,
    firstKoTurn: wm((m) => m.firstKoTurn), mainAttackTurn: wm((m) => m.mainAttackTurn), mainAttackRate: wm((m) => m.mainAttackRate)!, deckOutRate: wm((m) => m.deckOutRate)!, cards,
    firstKoOwnTurn: wm((m) => m.firstKoOwnTurn), mainAttackOwnTurn: wm((m) => m.mainAttackOwnTurn), mainAttackByOwn: ms[0]!.mainAttackByOwn.map((_, k) => wm((m) => m.mainAttackByOwn[k]!)!),
  };
}

interface Metric { key: string; label: string; get: (r: GameRecord) => number | null; /** how to word a positive difference */ word: (d: number, scope: string) => string }
const abs1 = (x: number): string => Math.abs(x).toFixed(1), abs2 = (x: number): string => Math.abs(x).toFixed(2);
function metrics(main: string): Metric[] {
  return [
    { key: "firstKo", label: "first KO turn", get: (r) => r.firstKo, word: (d, s) => `took its first KO ${abs1(d)} turns ${d < 0 ? "earlier" : "later"} ${s}` },
    { key: "mainAtk", label: `${main} first attack`, get: (r) => r.mainAtk, word: (d, s) => `first attacked with ${main} ${abs1(d)} turns ${d < 0 ? "earlier" : "later"} ${s}` },
    { key: "mainAtkOwn", label: `${main} first attack (own turn)`, get: (r) => (r.mainAtk === null ? null : ownTurn(r.mainAtk)), word: (d, s) => `first attacked with ${main} ${abs2(d)} own turns ${d < 0 ? "earlier" : "later"} ${s}` },
    { key: "atkBy2", label: `${main} attack by own turn 2`, get: (r) => (r.mainAtk !== null && ownTurn(r.mainAtk) <= 2 ? 1 : 0), word: (d, s) => `attacked with ${main} by its own turn 2 in ${abs1(d * 100)} points ${d > 0 ? "more" : "fewer"} games ${s}` },
    { key: "atkBy3", label: `${main} attack by own turn 3`, get: (r) => (r.mainAtk !== null && ownTurn(r.mainAtk) <= 3 ? 1 : 0), word: (d, s) => `attacked with ${main} by its own turn 3 in ${abs1(d * 100)} points ${d > 0 ? "more" : "fewer"} games ${s}` },
    { key: "turns", label: "game length", get: (r) => r.turns, word: (d, s) => `finished games ${abs1(d)} turns ${d < 0 ? "sooner" : "later"} ${s}` },
    { key: "kos", label: "KOs per game", get: (r) => r.kos, word: (d, s) => `scored ${abs2(d)} ${d > 0 ? "more" : "fewer"} KOs per game ${s}` },
    { key: "prizes", label: "prizes per game", get: (r) => r.prizes, word: (d, s) => `took ${abs2(d)} ${d > 0 ? "more" : "fewer"} prizes per game ${s}` },
    { key: "deckOut", label: "deck-out rate", get: (r) => r.deckOut, word: (d, s) => `decked out ${abs1(d * 100)} points ${d > 0 ? "more" : "less"} often ${s}` },
  ];
}
function diffEst(a: number[], b: number[]): { d: number; se: number } | null {
  if (a.length < 2 || b.length < 2) return null;
  return { d: mean(b) - mean(a), se: Math.sqrt(variance(a) / a.length + variance(b) / b.length) };
}

/** Turn raw game records into the full result. Only game indices complete for every (matchup, arm) are used. */
export function analyze(spec: ExperimentSpec, records: GameRecord[], gamesRequested = spec.gamesPerMatchup): ExperimentResult {
  const arms = armsOf(spec), M = spec.field.length, A = arms.length;
  const tracked = changedCards(spec), turnN = spec.turnN ?? 4;
  const cellCount = new Map<number, number>();
  for (const r of records) cellCount.set(r.g, (cellCount.get(r.g) ?? 0) + 1);
  const complete = new Set([...cellCount].filter(([, c]) => c === M * A).map(([g]) => g));
  const cell: GameRecord[][][] = Array.from({ length: A }, () => Array.from({ length: M }, () => []));
  for (const r of records) if (complete.has(r.g)) cell[r.arm]![r.m]!.push(r);
  for (const row of cell) for (const c of row) c.sort((x, y) => x.g - y.g);
  const n = complete.size;
  if (n === 0) throw new Error("analyze: no complete games");
  const tw = spec.field.reduce((x, f) => x + f.weight, 0);
  const w = spec.field.map((f) => f.weight / tw);
  const copiesOf = (deck: CardDef[]): Record<string, number> => Object.fromEntries(tracked.map((c) => [c, deck.filter((d) => d.name === c).length]));
  const mains = arms.map((a) => a.mainAttacker ?? defaultMainAttacker(a.deck));

  const results: ArmResult[] = arms.map((arm, a) => {
    const matchups: MatchupRow[] = spec.field.map((f, m) => {
      const recs = cell[a]![m]!, k = recs.reduce((x, r) => x + r.score, 0), wl = wilson(k, recs.length);
      return { field: f.name, weight: w[m]!, n: recs.length, score: wl.p, lo: wl.lo, hi: wl.hi, mech: mechOf(recs, tracked, copiesOf(arm.deck), turnN) };
    });
    // overall: weighted mean; variance sum w^2 p~(1-p~)/n with the Agresti-Coull-style adjusted p~ so tiny samples don't get zero variance
    const p = matchups.reduce((x, r, m) => x + w[m]! * r.score, 0);
    const v = matchups.reduce((x, r, m) => { const pt = (r.score * r.n + 2) / (r.n + 4); return x + w[m]! ** 2 * pt * (1 - pt) / r.n; }, 0);
    return { name: arm.name, change: (arm as VariantSpec).change ?? null, mainAttacker: mains[a]!, matchups, overall: { ...mkEst(p, Math.sqrt(v)), mech: combineMech(matchups.map((r) => r.mech), w) } };
  });

  for (let a = 1; a < A; a++) {
    const deltas: DeltaRow[] = spec.field.map((f, m) => {
      const d = cell[a]![m]!.map((r, i) => r.score - cell[0]![m]![i]!.score);
      const e = mkEst(mean(d), Math.sqrt(variance(d) / d.length));
      return { field: f.name, delta: e.est, lo: e.lo, hi: e.hi, se: e.se };
    });
    const delta = mkEst(deltas.reduce((x, r, m) => x + w[m]! * r.delta, 0), Math.sqrt(deltas.reduce((x, r, m) => x + w[m]! ** 2 * r.se ** 2, 0)));
    const verdict: Verdict = delta.lo > 0 ? "better" : delta.hi < 0 ? "worse" : "too close to call";
    const need = delta.se > 0 ? Math.ceil(n * (Z95 * delta.se / 0.02) ** 2) : null;
    const res = results[a]!;
    res.deltas = deltas; res.delta = delta; res.verdict = verdict; res.gamesNeeded = verdict === "too close to call" ? need : null;
    res.mechanism = mechanismFindings(spec, cell, a, w, mains[a]!, results[0]!, res);
  }
  return {
    name: spec.name, stage: spec.stage ?? "single", arms: results,
    meta: { date: spec.date ?? new Date().toISOString().slice(0, 10), agent: spec.agent, seedBase: spec.seedBase, gamesPerMatchup: n, gamesRequested, totalGames: n * M * A, field: spec.field.map((f, m) => ({ name: f.name, weight: w[m]! })), changedCards: tracked, turnN },
  };
}

function mechanismFindings(spec: ExperimentSpec, cell: GameRecord[][][], a: number, w: number[], main: string, base: ArmResult, v: ArmResult): MechFinding[] {
  const out: MechFinding[] = [];
  const mets = metrics(main);
  const scopeOverall = "across the weighted field";
  for (const met of mets) {
    const per = spec.field.map((_, m) => diffEst(cell[0]![m]!.map(met.get).filter((x): x is number => x !== null), cell[a]![m]!.map(met.get).filter((x): x is number => x !== null)));
    const ok = per.every((x) => x !== null);
    if (ok) {
      const d = per.reduce((x, e, m) => x + w[m]! * e!.d, 0), se = Math.sqrt(per.reduce((x, e, m) => x + w[m]! ** 2 * e!.se ** 2, 0));
      const sig = se > 0 && Math.abs(d) > Z95 * se;
      out.push({ scope: "overall", metric: met.label, diff: d, se, significant: sig, text: sig ? `${v.name} ${met.word(d, scopeOverall)}.` : `${met.label}: no detectable change ${scopeOverall} (${d >= 0 ? "+" : "-"}${Math.abs(d).toFixed(2)} +/- ${(Z95 * se).toFixed(2)}).` });
    }
    per.forEach((e, m) => {
      if (!e) return;
      const sig = e.se > 0 && Math.abs(e.d) > Z95 * e.se;
      if (sig) out.push({ scope: spec.field[m]!.name, metric: met.label, diff: e.d, se: e.se, significant: true, text: `${v.name} ${met.word(e.d, `vs ${spec.field[m]!.name}`)}.` });
    });
  }
  const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
  for (const c of spec.variants.length ? changedCards(spec) : []) {
    const b = base.overall.mech.cards[c]!, x = v.overall.mech.cards[c]!;
    if (b.copies === x.copies) continue;
    const split = (cm: CardMech): string => cm.copies && cm.whenPlayed.n && cm.whenNotPlayed.n ? `win rate ${pct(cm.whenPlayed.score / cm.whenPlayed.n)} when played (n=${cm.whenPlayed.n}) vs ${pct(cm.whenNotPlayed.score / cm.whenNotPlayed.n)} when not (n=${cm.whenNotPlayed.n})` : "no played/not-played split (card always or never played)";
    out.push({
      scope: "overall", metric: `card:${c}`, diff: x.copies - b.copies, se: 0, significant: false,
      text: `${c} (${b.copies} -> ${x.copies} copies): drawn by turn 3 in ${pct(b.drawnBy3)} -> ${pct(x.drawnBy3)} of games; played at all ${pct(b.played)} -> ${pct(x.played)}; played by turn ${spec.turnN ?? 4} ${pct(b.playedByN)} -> ${pct(x.playedByN)}. ` +
        `Observational (not causal): base ${split(b)}; variant ${split(x)}.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- drivers
export function runExperiment(spec: ExperimentSpec, opts: RunOptions = {}): ExperimentResult {
  return analyze(spec, runGames(spec, opts));
}
export interface TwoStageOptions { screenGames: number; confirmGames: number; keep: number; screenAgent?: AgentName; confirmAgent?: AgentName; confirmSeedBase?: number }
/** Spec for the confirm stage: top `keep` variants by overall delta, fresh seeds. */
export function confirmSpecFrom(spec: ExperimentSpec, screen: ExperimentResult, o: TwoStageOptions): ExperimentSpec {
  const ranked = screen.arms.slice(1).sort((x, y) => y.delta!.est - x.delta!.est).slice(0, o.keep).map((r) => r.name);
  return {
    ...spec, variants: spec.variants.filter((v) => ranked.includes(v.name)), gamesPerMatchup: o.confirmGames, agent: o.confirmAgent ?? spec.agent,
    seedBase: o.confirmSeedBase ?? spec.seedBase + 50_000_000, stage: "confirm",
  };
}
/**
 * Screen cheaply, keep the top `keep` variants by overall delta, re-run only those on FRESH seeds. The returned `final` carries
 * the verdicts: the screen picks the luckiest-looking variants (a winner's-curse selection among many comparisons), so its
 * intervals are optimistic; the confirm stage tests only pre-selected hypotheses on data the selection never saw.
 * `runner` lets callers parallelise (the CLI shards across processes).
 */
export async function screenThenConfirm(
  spec: ExperimentSpec, o: TwoStageOptions, runner: (s: ExperimentSpec) => ExperimentResult | Promise<ExperimentResult> = (s) => runExperiment(s),
): Promise<{ screen: ExperimentResult; final: ExperimentResult }> {
  const screen = await runner({ ...spec, gamesPerMatchup: o.screenGames, agent: o.screenAgent ?? spec.agent, stage: "screen" });
  const cspec = confirmSpecFrom(spec, screen, o);
  const final = await runner(cspec);
  final.screen = { agent: screen.meta.agent, gamesPerMatchup: screen.meta.gamesPerMatchup, kept: cspec.variants.map((v) => v.name), deltas: screen.arms.slice(1).map((r) => ({ name: r.name, delta: r.delta!.est, lo: r.delta!.lo, hi: r.delta!.hi })) };
  return { screen, final };
}

// ---------------------------------------------------------------- output
const pc = (x: number): string => `${(x * 100).toFixed(1)}%`;
const pts = (x: number): string => `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(1)}`;
const ci = (lo: number, hi: number): string => `[${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}]`;
export function toJSON(result: ExperimentResult): string { return JSON.stringify(result, null, 2); }

export function renderReport(r: ExperimentResult): string {
  const base = r.arms[0]!, vars = r.arms.slice(1), L: string[] = [];
  const N = r.meta.gamesPerMatchup;
  L.push(`# Experiment: ${r.name}`, "");
  L.push("## Verdict", "");
  for (const v of vars) {
    const d = v.delta!;
    const tail = v.verdict === "too close to call" ? ` Games needed to detect a 2-point difference at 95%: about ${v.gamesNeeded === null ? "n/a" : `${v.gamesNeeded} per matchup (we ran ${N})`}.` : "";
    L.push(`- **${v.name}** (${v.change}): **${v.verdict}**. Meta-weighted win rate ${pc(v.overall.est)} vs base ${pc(base.overall.est)}, delta ${pts(d.est)} points, 95% interval ${ci(d.lo, d.hi)} points.${tail}`);
  }
  if (r.stage === "confirm" && r.screen) L.push("", `Final verdicts come from the confirm stage only (fresh seeds, ${r.meta.agent}). The screen (${r.screen.agent}, ${r.screen.gamesPerMatchup} games/matchup) is used only to choose what to confirm: ${r.screen.deltas.map((d) => `${d.name} ${pts(d.delta)} ${ci(d.lo, d.hi)}${r.screen!.kept.includes(d.name) ? " (kept)" : " (dropped)"}`).join("; ")}.`);
  L.push("", "## Overall (meta-weighted)", "", "| Deck | Change | Win rate | 95% interval | Delta vs base (pts) | Delta 95% interval | Verdict |", "|---|---|---|---|---|---|---|");
  L.push(`| ${base.name} (base) | - | ${pc(base.overall.est)} | ${ci(base.overall.lo, base.overall.hi)} | - | - | - |`);
  for (const v of vars) L.push(`| ${v.name} | ${v.change} | ${pc(v.overall.est)} | ${ci(v.overall.lo, v.overall.hi)} | ${pts(v.delta!.est)} | ${ci(v.delta!.lo, v.delta!.hi)} | ${v.verdict} |`);
  L.push("", "## Per matchup", "", "| Matchup (weight) | Deck | Games | Win rate | 95% Wilson | Delta vs base (pts) | Delta 95% interval |", "|---|---|---|---|---|---|---|");
  base.matchups.forEach((bm, m) => {
    L.push(`| vs ${bm.field} (${(bm.weight * 100).toFixed(1)}%) | ${base.name} (base) | ${bm.n} | ${pc(bm.score)} | ${ci(bm.lo, bm.hi)} | - | - |`);
    for (const v of vars) { const x = v.matchups[m]!, d = v.deltas![m]!; L.push(`| | ${v.name} | ${x.n} | ${pc(x.score)} | ${ci(x.lo, x.hi)} | ${pts(d.delta)} | ${ci(d.lo, d.hi)} |`); }
  });
  L.push("", "## Mechanism", "");
  for (const v of vars) {
    L.push(`### ${v.name} (${v.change})`, "");
    const sig = v.mechanism!.filter((f) => f.significant || f.metric.startsWith("card:"));
    const sigNonCard = v.mechanism!.filter((f) => f.significant);
    if (!sigNonCard.length) L.push("- No game-flow metric (first KO turn, main-attacker timing, game length, KOs, prizes, deck-outs) changed by more than its noise at this sample size.");
    for (const f of sig) L.push(`- ${f.text}`);
    L.push("");
    // fixed table: base vs variant, field-weighted, own-turn numbers (the seat's k-th turn), whether or not a difference is significant
    const b = base.overall.mech, x = v.overall.mech, f1 = (q: number | null): string => (q === null ? "n/a" : q.toFixed(2));
    L.push(`| Own-turn mechanism (field-weighted) | ${base.name} (base) | ${v.name} |`, "|---|---|---|");
    L.push(`| ${v.mainAttacker} first attack, mean own turn (games where it attacks) | ${f1(b.mainAttackOwnTurn)} | ${f1(x.mainAttackOwnTurn)} |`);
    L.push(`| ${v.mainAttacker} attacked by own turn 2 / 3 / 4 (% of all games) | ${b.mainAttackByOwn.map(pc).join(" / ")} | ${x.mainAttackByOwn.map(pc).join(" / ")} |`);
    L.push(`| games with a ${v.mainAttacker} attack at all | ${pc(b.mainAttackRate)} | ${pc(x.mainAttackRate)} |`);
    L.push(`| first KO, mean own turn | ${f1(b.firstKoOwnTurn)} | ${f1(x.firstKoOwnTurn)} |`);
    L.push(`| deck-out rate (the arm loses by decking) | ${pc(b.deckOutRate)} | ${pc(x.deckOutRate)} |`);
    for (const [c, cm] of Object.entries(x.cards)) {
      if (cm.copies === b.cards[c]!.copies) continue;
      L.push(`| ${c} played by own turn 2 / 3 / 4 / 5 (% of all games) | ${b.cards[c]!.playedByOwn.slice(1, 5).map(pc).join(" / ")} | ${cm.playedByOwn.slice(1, 5).map(pc).join(" / ")} |`);
      L.push(`| ${c} first played, mean own turn (when played) | ${f1(b.cards[c]!.avgFirstPlayOwnTurn)} | ${f1(cm.avgFirstPlayOwnTurn)} |`);
    }
    L.push("");
  }
  L.push("### Baseline game flow (base list)", "");
  const bm = base.overall.mech;
  L.push(`- Average game length ${bm.avgTurns.toFixed(1)} turns; ${bm.kosPerGame.toFixed(2)} KOs and ${bm.prizesPerGame.toFixed(2)} prizes per game; first KO on turn ${bm.firstKoTurn?.toFixed(1) ?? "n/a"}; ${base.mainAttacker} first attacks on turn ${bm.mainAttackTurn?.toFixed(1) ?? "n/a"} (attacks in ${pc(bm.mainAttackRate)} of games); deck-out rate ${pc(bm.deckOutRate)}.`);
  L.push(`- Win reasons: ${Object.entries(bm.reasons).sort((a, b) => b[1] - a[1]).map(([k, x]) => `${k} ${pc(x)}`).join(", ")}.`);
  for (const bmu of base.matchups) L.push(`- vs ${bmu.field}: ${bmu.mech.avgTurns.toFixed(1)} turns, first KO T${bmu.mech.firstKoTurn?.toFixed(1) ?? "n/a"}, ${base.mainAttacker} first attacks T${bmu.mech.mainAttackTurn?.toFixed(1) ?? "n/a"}, ${bmu.mech.kosPerGame.toFixed(2)} KOs/game.`);
  L.push("", "## Method notes", "");
  L.push(`- Date ${r.meta.date}. Agent: ${r.meta.agent} for both seats (the same pilot plays every deck; a strong pilot reduces but does not remove pilot-skill bias). Stage: ${r.stage}.`);
  L.push(`- Games: ${N} per matchup per deck (${r.meta.gamesRequested === N ? "as requested" : `${r.meta.gamesRequested} requested, stopped at a time budget`}), ${r.meta.totalGames} games in total, seats alternate by game index, seeds ${r.meta.seedBase} + matchup*100000 + game index.`);
  L.push(`- Paired design: base and every variant use the SAME seed and seat in each game (common random numbers), so deltas are intervals on paired differences, much tighter than comparing two independent win rates. Draws count 1/2.`);
  L.push(`- Field (normalized meta share): ${r.meta.field.map((f) => `${f.name} ${(f.weight * 100).toFixed(1)}%`).join(", ")}. Field coverage: this field contains only ${r.meta.field.length} archetype${r.meta.field.length === 1 ? "" : "s"}; results say nothing about matchups outside it, and a real meta has many more.`);
  L.push(`- Intervals: per-matchup Wilson 95%; overall and deltas are normal 95% intervals with per-matchup variances propagated by weight (sum of w^2 var). Verdict = whether the overall delta interval excludes 0. Games needed = games per matchup for a 2-point half-width at the observed variance (about 50% power to detect a true 2-point edge; multiply by ~1.6 for 80% power).`);
  L.push(`- Mechanism stats are read from the event stream. "Drawn by turn 3" counts draw events (opening hand and draws) by game turn 3, not searches; "played" = benched / evolved into / attached / played; turn numbers in the sentences are game turns (both players' turns count), "by turn N" uses N=${r.meta.turnN}; the own-turn tables count the seat's own turns (k-th own turn = ceil(game turn / 2)). Played-vs-not-played win-rate splits are observational and confounded. Mechanism sentences are shown only when the difference exceeds its 95% noise band (unpaired, so conservative).`);
  L.push(`- Caveats: only cards implemented in the engine can appear in lists; the pilot plays no hidden-information bluffs; the verdict is about this pilot and this field, not about human play. Testing many variants inflates false positives; use the two-stage workflow and trust only the confirm stage.`);
  return L.join("\n") + "\n";
}
