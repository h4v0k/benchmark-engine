// Continuous ("static") effects. Board state is never cached: every query re-scans the board, so effects stop the moment their
// source (Pokémon, attached Tool, Stadium) leaves play or its `while` condition stops holding. Only the per-card (immutable)
// list of static entries is memoized, which makes the scan a handful of pointer reads for the many cards with no static rules.
import type { Condition, Effect, Entry, Selector } from "./dsl/types.js";
import { defOf, matchesFilter } from "./cards/model.js";
import { evalCond, newCtx, pokemonFacts } from "./interpreter.js";
import { inPlay, other, topDef, type GameState, type PlayerId, type PokemonInPlay } from "./state.js";

interface Source { owner: PlayerId; host?: PokemonInPlay; entry: Entry; /** the entry's effect with `seq`s flattened (precomputed) */ effects: Effect[] }
interface StaticEntry { entry: Entry; effects: Effect[] }

const flat = (e: Effect): Effect[] => (e.e === "seq" ? e.steps.flatMap(flat) : [e]);
const NONE: StaticEntry[] = [];
/** Card defs are immutable data, so the `static` entries of a rules array (and their flattened effects) are computed once. */
const STATIC_OF = new WeakMap<Entry[], StaticEntry[]>();
function staticEntries(rules: Entry[] | undefined): StaticEntry[] {
  if (!rules) return NONE;
  let r = STATIC_OF.get(rules);
  if (!r) {
    r = rules.filter((e) => e.trigger.t === "static").map((entry) => ({ entry, effects: flat(entry.effect) }));
    if (!r.length) r = NONE;
    STATIC_OF.set(rules, r);
  }
  return r;
}

/**
 * Read-only scope cache. Inside `withStaticSnapshot(s, fn)` the live static sources are computed ONCE and reused by every query on that
 * board (`maxHp` over all Pokémon in a KO sweep, the whole of `legalActions`, ...). `fn` MUST NOT change the board (Pokémon in play,
 * Tools, Stadium, anything a `while` condition reads); the cache is dropped when `fn` returns or throws, so nothing can go stale
 * across a state change. Queries outside any scope (and inside the interpreter's mutating code) always re-scan.
 */
let snapshot: { players: GameState["players"]; list: Source[] } | null = null;
export function withStaticSnapshot<T>(s: GameState, fn: () => T): T {
  if (snapshot) return fn(); // nested read-only scope: already cached
  snapshot = { players: s.players, list: scan(s) };
  try { return fn(); } finally { snapshot = null; }
}
const sources = (s: GameState): Source[] => (snapshot !== null && snapshot.players === s.players ? snapshot.list : scan(s));

/** Live static sources: Pokémon and attached Tools whose `while` holds, plus the Stadium. Most cards have none, so this is a cheap scan. */
function scan(s: GameState): Source[] {
  const out: Source[] = [];
  const consider = (owner: PlayerId, host: PokemonInPlay | undefined, rules: Entry[] | undefined, tool: boolean): void => {
    const list = staticEntries(rules);
    if (list === NONE) return;
    for (const { entry, effects } of list) {
      const w = (entry.trigger as { while?: Condition }).while;
      if (w) {
        const ctx = newCtx({ s, answers: [], idx: 0 }, owner, "other", { self: host?.iid, attached: tool ? host?.iid : undefined });
        if (!evalCond(ctx, w)) continue;
      }
      out.push({ owner, host, entry, effects });
    }
  };
  for (let pl = 0; pl < 2; pl++) {
    const ps = s.players[pl]!;
    const a = ps.active;
    if (a) { consider(pl as PlayerId, a, topDef(a).rules, false); if (a.tool) consider(pl as PlayerId, a, defOf(a.tool).rules, true); }
    for (const p of ps.bench) { consider(pl as PlayerId, p, topDef(p).rules, false); if (p.tool) consider(pl as PlayerId, p, defOf(p.tool).rules, true); }
  }
  if (s.stadium) consider(s.stadium.owner, undefined, defOf(s.stadium.iid).rules, false);
  return out;
}

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
    for (const e of src.effects)
      if (e.e === "prevent" && (e.from === "damage" || e.from === "both") && targets(s, src, e.who).includes(p)) return true;
  return false;
}

/** Sum of static numeric modifiers affecting `p` for a stat (hp, retreat, damageDealt, damageTaken). */
export function staticStat(s: GameState, p: PokemonInPlay, stat: string): number {
  let sum = 0;
  for (const src of sources(s))
    for (const e of src.effects) {
      if (e.e === "modify" && e.stat === stat && typeof e.value === "number" && targets(s, src, e.who).includes(p)) sum += e.value;
      else if (e.e === "retreatCost" && stat === "retreat" && targets(s, src, e.who).includes(p)) sum += e.delta;
    }
  return sum;
}

/** True if a static `lock ability` (e.g. Team Rocket's Watchtower) or a global no-Ability marker silences `p`'s Abilities. */
export function abilityLocked(s: GameState, p: PokemonInPlay): boolean {
  if (s.players.some((x) => x.markers.some((m) => m.key === "noAbility"))) return true;
  for (const src of sources(s))
    for (const e of src.effects)
      if (e.e === "lock" && e.what.l === "ability" && matchesFilter(topDef(p), e.what.filter, pokemonFacts(p))) return true;
  return false;
}
