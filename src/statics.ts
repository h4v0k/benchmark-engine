// Continuous ("static") effects. Never cached: every query re-scans the board, so effects stop the moment their
// source (Pokémon, attached Tool, Stadium) leaves play or its `while` condition stops holding.
import type { Effect, Entry, Selector } from "./dsl/types.js";
import { defOf, matchesFilter } from "./cards/model.js";
import { evalCond, newCtx, pokemonFacts } from "./interpreter.js";
import { inPlay, other, topDef, type GameState, type PlayerId, type PokemonInPlay } from "./state.js";

interface Source { owner: PlayerId; host?: PokemonInPlay; entry: Entry }

function* sources(s: GameState): Generator<Source> {
  const consider = function* (owner: PlayerId, host: PokemonInPlay | undefined, rules: Entry[] | undefined, tool: boolean): Generator<Source> {
    for (const entry of rules ?? []) {
      if (entry.trigger.t !== "static") continue;
      const ctx = newCtx({ s, answers: [], idx: 0 }, owner, "other", { self: host?.iid, attached: tool ? host?.iid : undefined });
      if (entry.trigger.while && !evalCond(ctx, entry.trigger.while)) continue;
      yield { owner, host, entry };
    }
  };
  for (const pl of [0, 1] as PlayerId[]) {
    for (const p of inPlay(s.players[pl])) {
      yield* consider(pl, p, topDef(p).rules, false);
      if (p.tool) yield* consider(pl, p, defOf(p.tool).rules, true);
    }
  }
  if (s.stadium) yield* consider(s.stadium.owner, undefined, defOf(s.stadium.iid).rules, false);
}

const flat = (e: Effect): Effect[] => (e.e === "seq" ? e.steps.flatMap(flat) : [e]);

/** Resolve a selector without asking anyone: `pick` yields every candidate (static effects affect all matches). */
function targets(s: GameState, src: Source, sel: Selector): PokemonInPlay[] {
  switch (sel.s) {
    // a Stadium has no host: its numeric `modify` with self/attached-to applies to every Pokémon in play (legacy Stadium semantics)
    case "self": case "attached-to": return src.host ? [src.host] : [...inPlay(s.players[0]), ...inPlay(s.players[1])];
    case "pick": {
      const pls: PlayerId[] = sel.player === "self" ? [src.owner] : sel.player === "opp" ? [other(src.owner)] : sel.player === "both" ? [0, 1] : [s.activePlayer];
      const out: PokemonInPlay[] = [];
      for (const pl of pls) {
        const ps = s.players[pl];
        const list = sel.where === "active" ? (ps.active ? [ps.active] : []) : sel.where === "bench" ? ps.bench : inPlay(ps);
        for (const p of list) if (matchesFilter(topDef(p), sel.filter, pokemonFacts(p))) out.push(p);
      }
      return out;
    }
    default: return [];
  }
}

/** Damage from attacks to `p` is prevented by a static `prevent` (e.g. Tera Pokémon on the Bench). */
export function staticPreventsDamage(s: GameState, p: PokemonInPlay): boolean {
  for (const src of sources(s))
    for (const e of flat(src.entry.effect))
      if (e.e === "prevent" && (e.from === "damage" || e.from === "both") && targets(s, src, e.who).includes(p)) return true;
  return false;
}

/** Sum of static numeric modifiers affecting `p` for a stat (hp, retreat, damageDealt, damageTaken). */
export function staticStat(s: GameState, p: PokemonInPlay, stat: string): number {
  let sum = 0;
  for (const src of sources(s))
    for (const e of flat(src.entry.effect)) {
      if (e.e === "modify" && e.stat === stat && typeof e.value === "number" && targets(s, src, e.who).includes(p)) sum += e.value;
      else if (e.e === "retreatCost" && stat === "retreat" && targets(s, src, e.who).includes(p)) sum += e.delta;
    }
  return sum;
}

/** True if a static `lock ability` (e.g. Team Rocket's Watchtower) or a global no-Ability marker silences `p`'s Abilities. */
export function abilityLocked(s: GameState, p: PokemonInPlay): boolean {
  if (s.players.some((x) => x.markers.some((m) => m.key === "noAbility"))) return true;
  for (const src of sources(s))
    for (const e of flat(src.entry.effect))
      if (e.e === "lock" && e.what.l === "ability" && matchesFilter(topDef(p), e.what.filter, pokemonFacts(p))) return true;
  return false;
}
