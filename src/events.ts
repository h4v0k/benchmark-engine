// Structured event stream. Every state change worth analysing is appended to `GameState.events` as typed data;
// all stats (src/sim.ts), the A/B framework and mechanism analytics read this stream, never prose.
// Cards are identified by stable instance ids (`"<defId>#<n>"`, unique within a game) plus their printed names.
import type { PlayerId } from "./state.js";

type P = PlayerId;

export type PlayKind = "basic" | "item" | "supporter" | "stadium" | "tool";
export type SwitchReason = "retreat" | "gust" | "promote" | "effect";
export type StatusCondition = "asleep" | "paralyzed" | "confused" | "poisoned" | "burned";
/** Where damage counters came from (negative `amount` on a `damageCounters` event = counters removed). */
export type CounterSource = "attack" | "effect" | "bench" | "self" | "move" | "heal" | "confusion" | "poison" | "burn";
export type DrawReason = "setup" | "turn" | "effect" | "mulligan";
export type CheckupKind = "poison" | "burn" | "burnCured" | "wokeUp" | "paralysisEnded";

export interface CheckupResult { player: P; pokemonId: string; pokemonName: string; kind: CheckupKind; /** damage for poison / burn */ damage?: number }

export type GameEvent =
  | { type: "gameStart"; turn: number; seed: number; /** sorted card def ids per player */ decks: [string[], string[]]; firstPlayer: P }
  | { type: "mulligan"; turn: number; player: P }
  | { type: "setupComplete"; turn: number }
  | { type: "turnStart"; turn: number; player: P }
  | { type: "draw"; turn: number; player: P; count: number; cardIds: string[]; reason: DrawReason }
  | { type: "coin"; turn: number; heads: boolean }
  | { type: "play"; turn: number; player: P; cardId: string; cardName: string; kind: PlayKind; /** Tool attach target */ targetId?: string }
  | { type: "putOnBench"; turn: number; player: P; pokemonId: string; pokemonName: string }
  | { type: "evolve"; turn: number; player: P; from: string; to: string; fromName: string; toName: string }
  | { type: "attachEnergy"; turn: number; player: P; cardId: string; cardName: string; targetId: string; targetName: string; source: "hand" | "effect" }
  | { type: "ability"; turn: number; player: P; pokemonId: string; pokemonName: string; name: string }
  | {
    type: "attack"; turn: number; player: P; attackerId: string; attackerName: string; attackName: string;
    targetId: string | null; targetName: string | null;
    /** damage actually dealt to the Defending Pokémon after weakness / resistance / effects (0 if none) */
    damage: number; /** the Defending Pokémon was Knocked Out by this attack's damage */ ko: boolean;
    /** name of the attack that was copied (Night Joker etc.) */ copied?: string;
    /** the attack did nothing: confusion tails or an `attackTry` coin */ failed?: "confused" | "attackTry";
  }
  | { type: "damageCounters"; turn: number; player: P; /** owner of the target */ owner: P; targetId: string; targetName: string; amount: number; source: CounterSource }
  | { type: "ko"; turn: number; owner: P; pokemonId: string; pokemonName: string; byAttack: boolean; prizesTaken: number; takenBy: P }
  | { type: "prize"; turn: number; player: P; count: number; remaining: number }
  | { type: "switch"; turn: number; player: P; /** the Pokémon that becomes Active */ pokemonId: string; pokemonName: string; replacedId?: string; reason: SwitchReason }
  | { type: "status"; turn: number; player: P; pokemonId: string; pokemonName: string; condition: StatusCondition }
  | { type: "checkup"; turn: number; results: CheckupResult[] }
  | { type: "search"; turn: number; player: P; zone: string; cardIds: string[]; cardNames: string[] }
  | { type: "discard"; turn: number; player: P; zone: string; cardIds: string[] }
  | { type: "reveal"; turn: number; player: P; cardIds: string[]; cardNames: string[] }
  | { type: "moveInPlay"; turn: number; player: P; pokemonId: string; pokemonName: string; to: string; cardCount: number }
  | { type: "gameEnd"; turn: number; winner: P | null; reason: string; turns: number };

export type GameEventType = GameEvent["type"];
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What emit sites pass: the event without its `turn` (stamped from the state). */
export type EventInput = DistOmit<GameEvent, "turn">;
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

const nm = (names: string[]): string => (names.length ? names.join(", ") : "nothing");

/** One-line prose rendering of an event (debugging, error messages, `logText`). */
export function formatEvent(e: GameEvent): string {
  const t = `T${e.turn} `;
  switch (e.type) {
    case "gameStart": return `${t}game start (seed ${e.seed}), P${e.firstPlayer} goes first`;
    case "mulligan": return `${t}P${e.player} mulligans (reveals hand)`;
    case "setupComplete": return `${t}setup complete`;
    case "turnStart": return `${t}P${e.player} turn begins`;
    case "draw": return `${t}P${e.player} draws ${e.count} (${e.reason})`;
    case "coin": return `${t}coin ${e.heads ? "H" : "T"}`;
    case "play":
      return `${t}P${e.player} ${e.kind === "basic" ? "benches" : e.kind === "tool" ? "attaches tool" : e.kind === "stadium" ? "plays stadium" : "plays"} ${e.cardName}`;
    case "putOnBench": return `${t}P${e.player} puts ${e.pokemonName} onto the Bench`;
    case "evolve": return `${t}P${e.player} evolves ${e.fromName} into ${e.toName}`;
    case "attachEnergy": return `${t}P${e.player} attaches ${e.cardName} to ${e.targetName}`;
    case "ability": return `${t}P${e.player} ${e.pokemonName} uses ability ${e.name}`;
    case "attack":
      return `${t}P${e.player} ${e.attackerName} uses ${e.attackName}${e.copied ? ` (copies ${e.copied})` : ""}` +
        (e.failed ? ` - fails (${e.failed})` : e.targetName ? ` -> ${e.targetName} takes ${e.damage}${e.ko ? " (KO)" : ""}` : "");
    case "damageCounters": return `${t}P${e.owner} ${e.targetName} ${e.amount >= 0 ? "+" : ""}${e.amount} damage counter(s) (${e.source})`;
    case "ko": return `${t}P${e.owner} ${e.pokemonName} is Knocked Out${e.byAttack ? " by an attack" : ""}`;
    case "prize": return `${t}P${e.player} takes ${e.count} prize(s), ${e.remaining} left`;
    case "switch": return `${t}P${e.player} ${e.reason}: ${e.pokemonName} becomes Active`;
    case "status": return `${t}P${e.player} ${e.pokemonName} is now ${e.condition}`;
    case "checkup": return `${t}checkup: ${e.results.map((r) => `P${r.player} ${r.pokemonName} ${r.kind}${r.damage ? ` ${r.damage}` : ""}`).join("; ")}`;
    case "search": return `${t}P${e.player} searches ${e.zone}: ${nm(e.cardNames)}`;
    case "discard": return `${t}P${e.player} discards ${e.cardIds.length} from ${e.zone}`;
    case "reveal": return `${t}P${e.player} reveals ${nm(e.cardNames)}`;
    case "moveInPlay": return `${t}P${e.player} moves ${e.pokemonName} and ${e.cardCount - 1} attached/stacked card(s) to ${e.to}`;
    case "gameEnd": return `${t}${e.winner === null ? "no winner" : `P${e.winner} wins`} (${e.reason}) after ${e.turns} turns`;
  }
}
