// Derived stats & small rule helpers shared by the interpreter, legal-action generator and game loop.
import type { Effect, EnergyType } from "./dsl/types.js";
import { defOf, matchesFilter, type CardDef } from "./cards/model.js";
import { staticStat } from "./statics.js";
import { markerSum, topDef, type GameState, type PlayerId, type PokemonInPlay } from "./state.js";

/** Sum of numeric `static` modify entries on a card for a stat (Tools, Stadiums). */
export function staticModifiers(def: CardDef | undefined, stat: string): number {
  if (!def?.rules) return 0;
  let sum = 0;
  const walk = (e: Effect) => {
    if (e.e === "seq") e.steps.forEach(walk);
    else if (e.e === "modify" && e.stat === stat && typeof e.value === "number") sum += e.value;
  };
  for (const r of def.rules) if (r.trigger.t === "static") walk(r.effect);
  return sum;
}
export const toolDef = (p: PokemonInPlay): CardDef | undefined => (p.tool ? defOf(p.tool) : undefined);
export function maxHp(s: GameState, p: PokemonInPlay): number {
  return (topDef(p).hp ?? 0) + staticStat(s, p, "hp") + markerSum(p.markers, "mod:hp");
}
export function retreatCostOf(s: GameState, p: PokemonInPlay): number {
  const c = (topDef(p).retreatCost ?? 0) + staticStat(s, p, "retreat") + markerSum(p.markers, "mod:retreat");
  return Math.max(0, c);
}
/** Energy units provided by attached Energy (each card contributes its `types`). */
export function providedEnergy(p: PokemonInPlay): EnergyType[] {
  const out: EnergyType[] = [];
  for (const e of p.energy) out.push(...(defOf(e).types ?? ["C"]));
  return out;
}
/** Can `provided` pay `cost`? Specific types need a matching unit; Colorless is payable by anything. */
export function canPay(cost: EnergyType[], provided: EnergyType[]): boolean {
  const pool = [...provided];
  let colorless = 0;
  for (const c of cost) {
    if (c === "C") { colorless++; continue; }
    const i = pool.indexOf(c);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return pool.length >= colorless;
}
/** Extra damage dealt by `p` (static + markers). `defender` is needed to evaluate conditional (`againstFilter`) markers. */
export function attackerBonus(s: GameState, p: PokemonInPlay, defender?: PokemonInPlay): number {
  let sum = staticStat(s, p, "damageDealt");
  for (const m of p.markers) {
    if (m.key !== "mod:damageDealt") continue;
    if (m.againstFilter && !(defender && matchesFilter(topDef(defender), m.againstFilter, { damaged: defender.damage > 0, hasEnergy: defender.energy.length > 0, hasTool: !!defender.tool }))) continue;
    sum += m.value ?? 0;
  }
  return sum;
}
export function weaknessResistance(attacker: PokemonInPlay | undefined, target: PokemonInPlay, raw: number): number {
  const at = attacker ? topDef(attacker).types ?? [] : [];
  const td = topDef(target);
  let d = raw;
  if (td.weakness && at.includes(td.weakness.type)) d *= td.weakness.multiplier;
  if (td.resistance && at.includes(td.resistance.type)) d -= td.resistance.amount;
  return Math.max(0, d);
}
export const isFirstTurnOfGame = (s: GameState, pl: PlayerId): boolean => s.turn === 1 && pl === s.firstPlayer;
