// Tempo model shared by the greedy and search pilots: which Pokémon is (or will become) the deck's main attacker, and how far is it from using its big attack.
import { isPokemon, isEnergy, registeredDefs, registrySize, defOf, type CardDef } from "../cards/model.js";
import type { Action } from "../actions.js";
import { canEvolveOnto } from "../interpreter.js";
import { findPokemon, inPlay, topDef, type GameState, type PendingChoice, type PlayerId, type PokemonInPlay } from "../state.js";

// ---- tempo: which Pokémon is (or will become) the deck's main attacker, and what does its big attack still need?
export type Main = { dmg: number; cost: string[]; stage: number };
let mainMemo = new Map<string, Main>(), memoSize = -1;
/** The best attack (highest damage estimate) a Pokémon of this def can ever reach by evolving along its line (over all registered cards), or its own best attack. */
function mainAttackOf(p: PokemonInPlay): Main { return mainAttackOfDef(topDef(p)); }
function mainAttackOfDef(top: CardDef): Main {
  if (registrySize() !== memoSize) { mainMemo = new Map(); memoSize = registrySize(); }
  const hit = mainMemo.get(top.id);
  if (hit) return hit;
  const defs = [...registeredDefs()];
  let best: Main = { dmg: 0, cost: [], stage: 0 };
  const visit = (name: string, depth: number): void => {
    if (depth > 3) return;
    for (const d of defs) {
      if (!isPokemon(d)) continue;
      if (d.name === name) for (const a of d.attacks ?? []) { const dmg = a.damage ?? dmgFallback(a.name); if (dmg > best.dmg) best = { dmg, cost: a.cost, stage: depth }; }
      if (d.evolvesFrom === name) visit(d.name, depth + 1);
    }
  };
  visit(top.name, 0);
  mainMemo.set(top.id, best);
  return best;
}
const dmgFallback = (name: string | undefined): number => name === "Powerful Rage" ? 100 : name === "Irritated Outburst" ? 120 : name === "Cruel Arrow" ? 100 : name === "Night Joker" ? 120 : 0;
/** Energy still missing to pay `cost` with `have` (types) plus `extra` more Energy cards. */
export function missing(cost: string[], have: string[]): number {
  const pool = [...have]; let miss = 0, col = 0;
  for (const c of cost) { if (c === "C") { col++; continue; } const i = pool.indexOf(c); if (i >= 0) pool.splice(i, 1); else miss++; }
  return miss + Math.max(0, col - pool.length);
}
export const typesOf = (cards: string[]): string[] => cards.flatMap((e) => defOf(e).types ?? ["C"]);
/** Per in-play Pokémon: its line's main attack; tier 1 = the line with the highest potential damage on our board. */
export function tempoInfo(s: GameState, pl: PlayerId): Map<PokemonInPlay, Main & { tier1: boolean }> {
  const out = new Map<PokemonInPlay, Main & { tier1: boolean }>();
  let top = 0;
  for (const p of inPlay(s.players[pl])) { const m = mainAttackOf(p); out.set(p, { ...m, tier1: false }); top = Math.max(top, m.dmg); }
  for (const v of out.values()) v.tier1 = v.dmg > 0 && v.dmg >= top;
  return out;
}

/** (main-line Pokémon in play, Stage 2 of the same line in hand) pairs a Rare Candy could evolve right now (engine rules: not first turn, not put into play this turn, Basic only). */
export function candyPairs(s: GameState, pl: PlayerId): Array<{ p: PokemonInPlay; card: string }> {
  const info = tempoInfo(s, pl), out: Array<{ p: PokemonInPlay; card: string }> = [];
  for (const [p, m] of info) {
    if (!m.tier1) continue;
    for (const c of s.players[pl].hand) if (canEvolveOnto(s, p, c, true) && mainAttackOfDef(defOf(c)).dmg >= m.dmg) out.push({ p, card: c });
  }
  return out;
}
/** Rare Candy onto a main-line Basic that already waited a turn (Dreepy -> Dragapult ex, skipping Drakloak): always right when legal, and played before any normal evolution
 *  so the Stage 1 is not spent on the Basic the Candy needs. */
export function candyPlay(s: GameState, pl: PlayerId, legal: Action[]): Action | undefined {
  const a = legal.find((x) => x.type === "playItem" && defOf(x.card).name === "Rare Candy");
  return a && candyPairs(s, pl).length ? a : undefined;
}

/** An evolution of a tier-1 (main attacker line) Pokémon that is legal now: always right, so the search pilot plays it without searching. */
export function mainLineEvolution(s: GameState, pl: PlayerId, legal: Action[]): Action | undefined {
  const candy = candyPlay(s, pl, legal);
  if (candy) return candy;
  let info: ReturnType<typeof tempoInfo> | undefined;
  for (const a of legal) {
    if (a.type !== "evolve") continue;
    info ??= tempoInfo(s, pl);
    const t = findPokemon(s, a.target)?.p;
    if (t && info.get(t)?.tier1) return a;
  }
  return undefined;
}

// ---- setup-turn policy shared by greedy (its own choices) and search (candidate pruning + default answers to pending choices)
const handCards = (s: GameState, pl: PlayerId): CardDef[] => s.players[pl].hand.map((c) => defOf(c));
/** Energy still missing on the closest main-line Pokémon (tier 1) to pay its big attack, counting the one hand Energy it could still receive this turn; 9 = no line on board. */
export function lineShortfall(s: GameState, pl: PlayerId): number {
  const ps = s.players[pl];
  const handE = ps.flags.energyAttachedThisTurn ? [] : ps.hand.filter((c) => isEnergy(defOf(c)));
  let best = 9;
  for (const [p, m] of tempoInfo(s, pl)) {
    if (!m.tier1) continue;
    const have = typesOf(p.energy);
    let miss = missing(m.cost, have);
    if (miss > 0) for (const e of handE) miss = Math.min(miss, missing(m.cost, [...have, ...typesOf([e])]));
    best = Math.min(best, miss);
  }
  return best;
}
/** A Pokémon card in the hand that belongs to the main attacker's line (Basic, Stage 1 or Stage 2). */
function handLineCards(s: GameState, pl: PlayerId): number {
  let top = 0;
  for (const m of tempoInfo(s, pl).values()) if (m.tier1) top = Math.max(top, m.dmg);
  return handCards(s, pl).filter((d) => isPokemon(d) && top > 0 && mainAttackOfDef(d).dmg >= top).length;
}
/** Preference rank of a Supporter on the current turn (lower = play first; null = do not play it now). `gust`: a Boss's-Orders-style gust would KO something this turn.
 *  Order: gust that KOs; the main line short of its attack cost and Crispin in hand -> Crispin; draw Supporters (hand <= 3, deck > 12; ranked last
 *  when the draw would shuffle away a main-line Pokémon that cannot be played yet); other Supporters; Crispin when the line is already online.
 *  Boss's Orders without a KO is never played. */
export function supporterRank(s: GameState, pl: PlayerId, name: string, gust: boolean, useful = true): number | null {
  const ps = s.players[pl];
  if (name === "Boss's Orders") return gust ? 0 : null;
  if (name === "Crispin") return lineShortfall(s, pl) > 0 && lineShortfall(s, pl) < 9 ? 1 : 4;
  if (name === "Lillie's Determination" || name === "Judge") {
    if (!(ps.hand.length <= 3 && ps.deck.length > 12)) return null;
    return handLineCards(s, pl) > 0 ? 5 : 2;
  }
  return useful ? 3 : null;
}
/** Search pruning: drop Supporter plays that are worse than the best-ranked one available, and Boss's Orders when it cannot KO. Everything else is untouched. */
export function pruneSupporters(s: GameState, pl: PlayerId, legal: Action[], gust: boolean): Action[] {
  if (legal.some((a) => a.type === "attachEnergy" && holdForLine(s, pl, a.card))) legal = legal.filter((a) => a.type !== "attachEnergy" || !holdForLine(s, pl, a.card));
  const sup = legal.filter((a): a is Extract<Action, { type: "playSupporter" }> => a.type === "playSupporter");
  if (!sup.length) return legal;
  const ranks = new Map<Action, number | null>(sup.map((a) => [a, supporterRank(s, pl, defOf(a.card).name, gust)]));
  const best = Math.min(9, ...[...ranks.values()].filter((r): r is number => r !== null));
  const drop = new Set<Action>(sup.filter((a) => { const r = ranks.get(a)!; return r === null ? defOf(a.card).name === "Boss's Orders" : r > best; }));
  return drop.size && drop.size < legal.length ? legal.filter((a) => !drop.has(a)) : legal;
}

/** Keep this Energy in hand: early on (game turn <= 6), the deck's best attacker line (over the Pokémon in hand, deck, discard and play) is not on the board yet and the Energy
 *  is of a type its big attack costs, so spending it on another Pokémon (Munkidori, Fezandipiti ex, ...) would starve the line when its Basic arrives. */
export function holdForLine(s: GameState, pl: PlayerId, energyCard: string): boolean {
  if (s.turn > 6) return false;
  const ps = s.players[pl];
  let board = 0;
  for (const m of tempoInfo(s, pl).values()) board = Math.max(board, m.dmg);
  let top: Main = { dmg: 0, cost: [], stage: 0 };
  for (const c of [...ps.hand, ...ps.deck, ...ps.discard]) { const d = defOf(c); if (!isPokemon(d)) continue; const m = mainAttackOfDef(d); if (m.dmg > top.dmg) top = m; }
  if (top.dmg <= board) return false;
  const types = typesOf([energyCard]);
  return top.cost.some((c) => types.includes(c));
}

/** The Supporter the setup policy plays without searching: the best-ranked one when it is Crispin for a short main line or a draw Supporter on a small hand (rank 1-2).
 *  A gust that KOs (rank 0) is left to the search, which also picks its target. */
export function policySupporter(s: GameState, pl: PlayerId, legal: Action[], gust: boolean): Action | undefined {
  let best: { a: Action; r: number } | undefined;
  for (const a of legal) {
    if (a.type !== "playSupporter") continue;
    const r = supporterRank(s, pl, defOf(a.card).name, gust);
    if (r !== null && (!best || r < best.r)) best = { a, r };
  }
  // a draw Supporter shuffles the hand away: not while Items / Basics in hand are still playable (they may find the line's Pokémon)
  const handLeft = legal.some((a) => a.type === "playItem" || a.type === "playBasicToBench");
  return best && (best.r === 1 || (best.r === 2 && !handLeft)) ? best.a : undefined;
}

/** The attach among `opts` (energy card -> Pokémon) that brings a main-line Pokémon's big attack closest (the Pokémon being evolved included); undefined if none helps. */
export function mainAttach<T extends { card: string; target: string }>(s: GameState, pl: PlayerId, opts: T[]): T | undefined {
  const info = tempoInfo(s, pl), me = s.players[pl].active;
  return opts.filter((a) => !holdForLine(s, pl, a.card)).flatMap((a) => {
    const t = findPokemon(s, a.target)?.p, m = t ? info.get(t) : undefined;
    if (!t || !m?.tier1) return [];
    const cur = missing(m.cost, typesOf(t.energy)), after = missing(m.cost, typesOf([...t.energy, a.card]));
    return after < cur ? [{ a, after, evolved: t.below.length, act: t === me }] : [];
  }).sort((x, y) => x.after - y.after || y.evolved - x.evolved || Number(y.act) - Number(x.act))[0]?.a;
}

/** Searching the deck / discard pile for Pokémon (Buddy-Buddy Poffin, Ultra Ball, Poké Pad, Night Stretcher): the main attacker line first, and within it what the board can use now
 *  (an evolution of a Pokémon in play, else a line Basic while fewer than 2 are in play); everything else by the generic card value left to the caller. */
function pokemonSearchPick(s: GameState, pc: PendingChoice): string[] | undefined {
  if (pc.kind !== "cards" || !/^choose cards from (deck|discard)$/.test(pc.prompt) || pc.max <= 0 || !pc.options.every((c) => isPokemon(defOf(c)))) return undefined;
  const ps = s.players[pc.player];
  let top = 0;
  for (const c of [...ps.hand, ...ps.deck, ...ps.discard, ...pc.options]) { const d = defOf(c); if (isPokemon(d)) top = Math.max(top, mainAttackOfDef(d).dmg); }
  for (const p of inPlay(ps)) top = Math.max(top, mainAttackOf(p).dmg);
  if (top <= 0) return undefined;
  const names = new Set(inPlay(ps).map((p) => topDef(p).name));
  const lineBasics = inPlay(ps).filter((p) => mainAttackOf(p).dmg >= top && p.below.length === 0).length;
  const score = (c: string): number => {
    const d = defOf(c);
    if (!isPokemon(d) || mainAttackOfDef(d).dmg < top) return 0;
    return 100 + (d.evolvesFrom ? (names.has(d.evolvesFrom) ? 40 : 0) : lineBasics < 2 ? 30 : 0) + (d.evolvesFrom ? 5 : 0);
  };
  const ranked = [...pc.options].sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
  return score(ranked[0]!) > 0 ? ranked.slice(0, pc.max) : undefined;
}

/** Default answers to the pending choices of Energy-fetching effects (Crispin: which Energy to fetch, which goes to hand, which Pokémon gets the other). undefined = not one of those. */
export function preferredChoice(s: GameState, pc: PendingChoice): string[] | undefined {
  const origin = pc.origin?.action;
  if (origin?.type === "playItem" && defOf(origin.card).name === "Rare Candy") { // which Basic and which Stage 2: the main line's, the biggest attacker first
    const pairs = candyPairs(s, pc.player);
    if (pc.kind === "pokemon") { const t = pairs.map((x) => x.p.iid).find((i) => pc.options.includes(i)); return t ? [t] : undefined; }
    if (pc.kind === "cards") { const c = [...pc.options].sort((a, b) => mainAttackOfDef(defOf(b)).dmg - mainAttackOfDef(defOf(a)).dmg || (a < b ? -1 : 1))[0]; return c ? [c] : undefined; }
    return undefined;
  }
  const picked = pokemonSearchPick(s, pc);
  if (picked) return picked;
  if (!origin || origin.type !== "playSupporter" || defOf(origin.card).name !== "Crispin") return undefined;
  const pl = pc.player;
  // how much would attaching this Energy to its best main-line Pokémon close the gap (0 = nothing, bigger = better)
  const gain = (e: string): number => {
    let g = 0;
    for (const [p, m] of tempoInfo(s, pl)) { if (!m.tier1) continue; g = Math.max(g, missing(m.cost, typesOf(p.energy)) - missing(m.cost, typesOf([...p.energy, e]))); }
    return g;
  };
  // ties: Energy of a type the main attack costs before off-types (Darkness), then by id
  const costTypes = new Set([...tempoInfo(s, pl).values()].filter((m) => m.tier1).flatMap((m) => m.cost));
  const wanted = (e: string): number => (typesOf([e]).some((x) => costTypes.has(x)) ? 1 : 0);
  const byGain = (ids: string[]): string[] => [...ids].sort((a, b) => gain(b) - gain(a) || wanted(b) - wanted(a) || (a < b ? -1 : 1));
  if (pc.kind === "cards" && pc.prompt === "search") return pc.min === 0 ? [byGain(pc.options)[0]!] : undefined;
  if (pc.kind === "cards" && /^put into your hand/.test(pc.prompt)) return [byGain(pc.options)[pc.options.length - 1]!]; // the Energy the line needs least goes to the hand
  if (pc.kind === "pokemon") {
    const ans = pc.origin!.answers.flat(), hand = ans[ans.length - 1], attached = ans.filter((c) => c !== hand && isEnergy(defOf(c)))[0];
    if (!attached) return undefined;
    const opts = pc.options.map((id) => ({ card: attached, target: id }));
    const best = mainAttach(s, pl, opts);
    return best ? [best.target] : undefined;
  }
  return undefined;
}

/** Benching a Basic of the deck's best attacker line (over Pokémon in hand, deck, discard and play) while fewer than 2 of that line are in play: the payoff (a Stage 2 two turns later)
 *  is beyond a 2-turn horizon, so the search pilot plays it without searching. */
export function mainLineBasic(s: GameState, pl: PlayerId, legal: Action[]): Action | undefined {
  const ps = s.players[pl];
  if (ps.bench.length >= 3) return undefined;
  let top = 0;
  for (const c of [...ps.hand, ...ps.deck, ...ps.discard]) { const d = defOf(c); if (isPokemon(d)) top = Math.max(top, mainAttackOfDef(d).dmg); }
  for (const p of inPlay(ps)) top = Math.max(top, mainAttackOf(p).dmg);
  if (top <= 0) return undefined;
  if (inPlay(ps).filter((p) => mainAttackOf(p).dmg >= top).length >= 2) return undefined;
  return legal.find((a) => a.type === "playBasicToBench" && mainAttackOfDef(defOf(a.card)).dmg >= top);
}
