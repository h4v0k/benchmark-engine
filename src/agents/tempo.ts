// Tempo model shared by the greedy and search pilots: which Pokémon is (or will become) the deck's main attacker, and how far is it from using its big attack.
import { isPokemon } from "../cards/model.js";
import { registeredDefs, registrySize } from "../cards/model.js";
import { defOf } from "../cards/model.js";
import type { Action } from "../actions.js";
import { findPokemon, inPlay, topDef, type GameState, type PlayerId, type PokemonInPlay } from "../state.js";

// ---- tempo: which Pokémon is (or will become) the deck's main attacker, and what does its big attack still need?
export type Main = { dmg: number; cost: string[]; stage: number };
let mainMemo = new Map<string, Main>(), memoSize = -1;
/** The best attack (highest damage estimate) a Pokémon of this def can ever reach by evolving along its line (over all registered cards), or its own best attack. */
function mainAttackOf(p: PokemonInPlay): Main {
  const top = topDef(p);
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

/** An evolution of a tier-1 (main attacker line) Pokémon that is legal now: always right, so the search pilot plays it without searching. */
export function mainLineEvolution(s: GameState, pl: PlayerId, legal: Action[]): Action | undefined {
  let info: ReturnType<typeof tempoInfo> | undefined;
  for (const a of legal) {
    if (a.type !== "evolve") continue;
    info ??= tempoInfo(s, pl);
    const t = findPokemon(s, a.target)?.p;
    if (t && info.get(t)?.tier1) return a;
  }
  return undefined;
}
