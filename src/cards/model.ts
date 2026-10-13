import type { CardFilter, Condition, Effect, Entry, EnergyType, Trigger } from "../dsl/types.js";

export type Supertype = "Pokemon" | "Trainer" | "Energy";
export type Subtype =
  | "Basic" | "Stage1" | "Stage2" | "ex" | "MegaEx" | "Tera" | "AceSpec"
  | "Item" | "Supporter" | "Stadium" | "Tool" | "Basic Energy" | "Special Energy";

export interface AttackDef {
  name: string;
  cost: EnergyType[];
  /** printed damage; null = attack has no printed damage */
  damage: number | null;
  damageSuffix?: "+" | "x" | "-";
  effect?: Effect;
  text?: string;
}
export interface AbilityDef {
  name: string;
  trigger?: Trigger; // {t:"ability",...}
  effect: Effect;
  limit?: "oncePerTurn" | "oncePerGame";
  requires?: Condition;
  /** original printed text, for reviewers */
  text?: string;
}
export interface CardDef {
  id: string;
  name: string;
  supertype: Supertype;
  subtypes: Subtype[];
  hp?: number;
  /** Pokémon: its type(s). Energy: what it provides. */
  types?: EnergyType[];
  evolvesFrom?: string;
  attacks?: AttackDef[];
  abilities?: AbilityDef[];
  /** DSL entries for Trainers / Energy / static card text (play, static, attach...) */
  rules?: Entry[];
  weakness?: { type: EnergyType; multiplier: 2 };
  resistance?: { type: EnergyType; amount: 30 };
  retreatCost?: number;
  prizeValue?: 1 | 2 | 3;
  /** original printed card text (all of it), alongside the DSL, for review */
  text?: string;
  regulationMark?: string;
  setCode?: string;
  number?: string;
}
export interface CardInstance { iid: string; defId: string }

// ---- registry: instance ids are `${defId}#${n}`; defs are immutable data looked up by id -------------
const REG = new Map<string, CardDef>();
export function registerCards(defs: Iterable<CardDef>): void { for (const d of defs) REG.set(d.id, d); }
export function getDef(id: string): CardDef {
  const d = REG.get(id);
  if (!d) throw new Error(`unknown card def: ${id}`);
  return d;
}
export const defIdOf = (iid: string): string => iid.slice(0, iid.lastIndexOf("#"));
export const defOf = (iid: string): CardDef => getDef(defIdOf(iid));
export const instanceOf = (iid: string): CardInstance => ({ iid, defId: defIdOf(iid) });

// ---- predicates -------------------------------------------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
export function hasSub(d: CardDef, sub: string): boolean {
  const n = norm(sub);
  const subs = d.subtypes.map(norm);
  if (n === "mega") return subs.includes("megaex");
  if (n === "rulebox") return subs.some((x) => ["ex", "megaex", "v", "vmax", "vstar"].includes(x));
  return subs.includes(n);
}
export const isPokemon = (d: CardDef) => d.supertype === "Pokemon";
export const isEnergy = (d: CardDef) => d.supertype === "Energy";
export const isBasicPokemon = (d: CardDef) => isPokemon(d) && d.subtypes.includes("Basic");
export function prizeValueOf(d: CardDef): number {
  return d.prizeValue ?? (d.subtypes.includes("MegaEx") ? 3 : d.subtypes.includes("ex") ? 2 : 1);
}
export interface PokemonFacts { damaged?: boolean; hasEnergy?: boolean; hasTool?: boolean }
export function matchesFilter(d: CardDef, f: CardFilter | undefined, facts: PokemonFacts = {}): boolean {
  if (!f) return true;
  if (f.supertype && norm(f.supertype) !== norm(d.supertype)) return false;
  if (f.subtype && !f.subtype.every((s) => hasSub(d, s))) return false;
  if (f.noRuleBox && hasSub(d, "rule-box")) return false;
  if (f.type && !f.type.some((t) => d.types?.includes(t))) return false;
  if (f.name !== undefined && d.name !== f.name) return false;
  if (f.nameIncludes !== undefined && !d.name.includes(f.nameIncludes)) return false;
  if (f.hpMax !== undefined && (d.hp ?? Infinity) > f.hpMax) return false;
  if (f.hpMin !== undefined && (d.hp ?? 0) < f.hpMin) return false;
  if (f.attackNamed !== undefined && !d.attacks?.some((a) => a.name === f.attackNamed)) return false;
  if (f.abilityNamed !== undefined && !d.abilities?.some((a) => a.name === f.abilityNamed)) return false;
  if (f.evolvesFrom !== undefined && d.evolvesFrom !== f.evolvesFrom) return false;
  if (f.hasEnergy !== undefined && !!facts.hasEnergy !== f.hasEnergy) return false;
  if (f.hasTool !== undefined && !!facts.hasTool !== f.hasTool) return false;
  if (f.damaged !== undefined && !!facts.damaged !== f.damaged) return false;
  if (f.not && matchesFilter(d, f.not, facts)) return false;
  if (f.any && !f.any.some((g) => matchesFilter(d, g, facts))) return false;
  return true;
}
/** Deck legality: 60 cards, <=4 copies per name (basic Energy exempt), >=1 Basic Pokémon. */
export function validateDeck(deck: CardDef[], size = 60): string[] {
  const errs: string[] = [];
  if (deck.length !== size) errs.push(`deck has ${deck.length} cards, expected ${size}`);
  const counts = new Map<string, number>();
  for (const d of deck) if (!d.subtypes.includes("Basic Energy")) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  for (const [n, c] of counts) if (c > 4) errs.push(`${c} copies of ${n}`);
  if (!deck.some(isBasicPokemon)) errs.push("no Basic Pokémon");
  return errs;
}
