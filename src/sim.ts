import { writeFileSync } from "node:fs";
import { decider, wasIssued } from "./actions.js";
import type { Agent } from "./agents/random.js";
import type { CardDef } from "./cards/model.js";
import type { GameEvent } from "./events.js";
import { applyAction, createGame } from "./game.js";
import { makeRng } from "./rng.js";
import type { PlayerId, RulesConfig } from "./state.js";

/** Per-game statistics, all derived from the event stream (see `statsFromEvents`). Pair entries are indexed by player. */
export interface GameStats {
  /** Knock Outs scored by each player (opposing Pokémon they knocked out) */
  kos: [number, number];
  /** KOs scored by an attack */
  attackKos: [number, number];
  prizesTaken: [number, number];
  attacks: [number, number];
  /** attacks that dealt 0 damage to the Defending Pokémon (including failed attacks) */
  zeroDamageAttacks: [number, number];
  /** damage dealt to Defending Pokémon by attacks */
  damageDealt: [number, number];
  /** uses of the KEY_EFFECTS attacks / abilities / triggers, both players combined */
  keyEffects: Record<string, number>;
}
export interface GameResult {
  seed: number; winner: PlayerId | null; reason: string; turns: number; events: GameEvent[];
  /** each player's decklist as sorted card def ids (from the gameStart event) */
  decks: [string[], string[]]; stats: GameStats;
}

/** Names counted by `keyEffectUses` (proof that real card effects, not just vanilla attacks, are exercised). */
export const KEY_EFFECTS = ["Phantom Dive", "Night Joker", "Trade", "Recon Directive", "Adrena-Brain", "Flip the Script", "Subjugating Chains", "Run Away Draw", "Last-Ditch Catch"] as const;
/** Count uses of key attacks / abilities in an event stream. Last-Ditch Catch is an on-bench trigger: counted as "benches Meowth ex" immediately followed by a deck search. */
export function keyEffectUses(events: GameEvent[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(KEY_EFFECTS.map((k) => [k, 0]));
  const has = (k: string): boolean => k in out;
  events.forEach((e, i) => {
    if (e.type === "attack" && !e.failed && has(e.attackName)) out[e.attackName]!++;
    else if (e.type === "ability" && has(e.name)) out[e.name]!++;
    else if (e.type === "play" && e.kind === "basic" && e.cardName === "Meowth ex" && events[i + 1]?.type === "search") out["Last-Ditch Catch"]!++;
  });
  return out;
}
export function statsFromEvents(events: GameEvent[]): GameStats {
  const st: GameStats = {
    kos: [0, 0], attackKos: [0, 0], prizesTaken: [0, 0], attacks: [0, 0], zeroDamageAttacks: [0, 0], damageDealt: [0, 0], keyEffects: keyEffectUses(events),
  };
  for (const e of events) {
    switch (e.type) {
      case "ko": st.kos[e.takenBy]++; if (e.byAttack) st.attackKos[e.takenBy]++; break;
      case "prize": st.prizesTaken[e.player] += e.count; break;
      case "attack": st.attacks[e.player]++; st.damageDealt[e.player] += e.damage; if (e.damage === 0) st.zeroDamageAttacks[e.player]++; break;
    }
  }
  return st;
}

export function playGame(
  deckA: CardDef[], deckB: CardDef[], seed: number, agentA: Agent, agentB: Agent,
  maxTurns = 200, rules: Partial<RulesConfig> = {},
): GameResult {
  let s = createGame(deckA, deckB, seed, rules);
  const rngs = [makeRng(seed ^ 0x9e3779b9), makeRng(seed ^ 0x85ebca6b)];
  const agents = [agentA, agentB];
  let guard = 0;
  while (s.phase !== "over" && s.turn <= maxTurns && guard++ < maxTurns * 400) {
    const d = decider(s)!;
    const act = agents[d]!(s, rngs[d]!);
    // the states here are never touched by anyone but the engine, so an action taken verbatim from legalActions(s) needs no second legality check
    s = applyAction(s, act, { trusted: wasIssued(s, act) });
  }
  const over = s.phase === "over";
  const reason = over ? s.winReason ?? "" : s.turn > maxTurns ? "maxTurns" : "actionLimit";
  const events = over ? s.events : [...s.events, { type: "gameEnd", turn: s.turn, winner: null, reason, turns: s.turn } satisfies GameEvent];
  const start = events[0];
  return {
    seed, winner: over ? s.winner ?? null : null, reason, turns: s.turn, events,
    decks: start?.type === "gameStart" ? start.decks : [[], []], stats: statsFromEvents(events),
  };
}

export interface SimStats {
  games: number; wins: [number, number]; draws: number; avgTurns: number; maxTurnsSeen: number;
  reasons: Record<string, number>;
  kos: [number, number]; prizesTaken: [number, number]; attacks: [number, number]; zeroDamageAttacks: [number, number];
  keyEffects: Record<string, number>;
}
const add2 = (a: [number, number], b: [number, number]): void => { a[0] += b[0]; a[1] += b[1]; };
export function simulate(
  n: number, deckA: CardDef[], deckB: CardDef[], agentA: Agent, agentB: Agent,
  baseSeed = 1, maxTurns = 200, rules: Partial<RulesConfig> = {},
): SimStats {
  const st: SimStats = {
    games: n, wins: [0, 0], draws: 0, avgTurns: 0, maxTurnsSeen: 0, reasons: {},
    kos: [0, 0], prizesTaken: [0, 0], attacks: [0, 0], zeroDamageAttacks: [0, 0], keyEffects: Object.fromEntries(KEY_EFFECTS.map((k) => [k, 0])),
  };
  let total = 0;
  for (let i = 0; i < n; i++) {
    const r = playGame(deckA, deckB, baseSeed + i, agentA, agentB, maxTurns, rules);
    if (r.winner === null) st.draws++; else st.wins[r.winner]++;
    total += r.turns;
    st.maxTurnsSeen = Math.max(st.maxTurnsSeen, r.turns);
    st.reasons[r.reason] = (st.reasons[r.reason] ?? 0) + 1;
    add2(st.kos, r.stats.kos); add2(st.prizesTaken, r.stats.prizesTaken); add2(st.attacks, r.stats.attacks); add2(st.zeroDamageAttacks, r.stats.zeroDamageAttacks);
    for (const [k, c] of Object.entries(r.stats.keyEffects)) st.keyEffects[k] = (st.keyEffects[k] ?? 0) + c;
  }
  st.avgTurns = total / n;
  return st;
}

/** One JSON line per game for offline analytics: `{seed, decks, winner, reason, turns, events}`. */
export function gameToJsonl(r: GameResult): string {
  return JSON.stringify({ seed: r.seed, decks: r.decks, winner: r.winner, reason: r.reason, turns: r.turns, events: r.events });
}
/** Write games as JSON Lines (one game per line) to `path`, overwriting it. */
export function exportGamesJsonl(results: GameResult[], path: string): void {
  writeFileSync(path, results.map((r) => gameToJsonl(r) + "\n").join(""));
}
