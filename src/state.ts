import type { Rng } from "./rng.js";
import { shuffle } from "./rng.js";
import type { Action } from "./actions.js";
import { defOf, type CardDef } from "./cards/model.js";
import { formatEvent, type DrawReason, type EventInput, type GameEvent } from "./events.js";

export type PlayerId = 0 | 1;
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
export type Phase = "mulliganAck" | "mulliganDraw" | "setupActive" | "setupBench" | "main" | "over";

export interface RulesConfig {
  /** The player who goes first cannot attack on their first turn. */
  noAttackOnFirstTurnOfGame: boolean;
  /** The player who goes first cannot play a Supporter on their first turn. VERIFY vs current rulebook (see docs/ENGINE.md). */
  noSupporterOnFirstTurnOfGame: boolean;
  /** Neither player may evolve on their own first turn. */
  noEvolveOnFirstTurn: boolean;
  benchSize: number;
  prizeCount: number;
  handSize: number;
}
export const DEFAULT_RULES: RulesConfig = {
  noAttackOnFirstTurnOfGame: true,
  noSupporterOnFirstTurnOfGame: true,
  noEvolveOnFirstTurn: true,
  benchSize: 5,
  prizeCount: 6,
  handSize: 7,
};

/** Persistent effect marker. expiresAfterTurn: removed once that global turn number has ended (undefined = while in play). */
export interface Marker { key: string; value?: number; expiresAfterTurn?: number; /** only applies when the Defending Pokémon matches (damageDealt markers) */ againstFilter?: import("./dsl/types.js").CardFilter }
export interface StatusSet { asleep: boolean; paralyzed: boolean; confused: boolean; poisoned: boolean; burned: boolean }

export interface PokemonInPlay {
  /** instance id of the top (current) card */
  iid: string;
  /** earlier evolution stages stacked below, bottom first */
  below: string[];
  energy: string[];
  tool?: string;
  /** damage in HP points (always a multiple of 10 = N damage counters) */
  damage: number;
  status: StatusSet;
  turnPlayed: number;
  evolvedThisTurn: boolean;
  usedAbilities: string[];
  markers: Marker[];
}
export interface PlayerFlags {
  energyAttachedThisTurn: boolean;
  supporterPlayedThisTurn: boolean;
  stadiumPlayedThisTurn: boolean;
  retreatedThisTurn: boolean;
  gxUsed: boolean;
  vstarUsed: boolean;
  /** ability names already used this turn by any of the player's Pokémon (oncePerNamePerTurn) */
  abilityNamesUsed: string[];
}
export interface PlayerState {
  deck: string[]; // top first
  hand: string[];
  discard: string[];
  prizes: string[];
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  lostZone: string[];
  flags: PlayerFlags;
  markers: Marker[];
  lastKOTurn: number;
  usedGameAbilities: string[];
}
export type ChoiceKind = "pokemon" | "cards" | "option" | "yesno" | "mulliganDraw" | "distribute";
/** kind "distribute": options are target ids, min=max=total to split; each pick is `${id}=${count}` (counts >= 1, summing to total). */
export interface ChoiceReq { player: PlayerId; kind: ChoiceKind; options: string[]; min: number; max: number; prompt: string }
export interface PendingChoice extends ChoiceReq {
  /** Resume info (replay model, docs/ENGINE.md): originating action, answers so far, and the pre-action snapshot to replay from. The surrounding state shows the partially-resolved position. */
  origin?: { action: Action; answers: string[][]; base: GameState };
  context?: string;
}
export interface SetupInfo { mulls: [number, number]; acked: [boolean, boolean]; benchDone: [boolean, boolean] }

export interface GameState {
  seed: number;
  rng: Rng;
  nextId: number;
  turn: number; // global turn counter, 1-based; turn 1 = first player's first turn
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: Phase;
  players: [PlayerState, PlayerState];
  stadium?: { iid: string; owner: PlayerId };
  /** structured event stream (src/events.ts); append-only within a game */
  events: GameEvent[];
  winner?: PlayerId;
  winReason?: string;
  pendingChoice?: PendingChoice;
  setup?: SetupInfo;
  rules: RulesConfig;
}

export const emptyStatus = (): StatusSet => ({ asleep: false, paralyzed: false, confused: false, poisoned: false, burned: false });
export const emptyFlags = (): PlayerFlags => ({
  energyAttachedThisTurn: false, supporterPlayedThisTurn: false, stadiumPlayedThisTurn: false,
  retreatedThisTurn: false, gxUsed: false, vstarUsed: false, abilityNamesUsed: [],
});
export const newPlayer = (): PlayerState => ({
  deck: [], hand: [], discard: [], prizes: [], active: null, bench: [], lostZone: [],
  flags: emptyFlags(), markers: [], lastKOTurn: -1, usedGameAbilities: [],
});
export const newPokemon = (iid: string, turn: number): PokemonInPlay => ({
  iid, below: [], energy: [], damage: 0, status: emptyStatus(), turnPlayed: turn,
  evolvedThisTurn: false, usedAbilities: [], markers: [],
});

/** Fast deep clone for plain JSON-like data (state is clone-on-write; perf note in docs/ENGINE.md). */
export function deepClone<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) { const out = new Array(v.length); for (let i = 0; i < v.length; i++) out[i] = deepClone(v[i]); return out as T; }
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) out[k] = deepClone((v as Record<string, unknown>)[k]);
  return out as T;
}

function clonePokemon(p: PokemonInPlay): PokemonInPlay {
  const st = p.status;
  return {
    iid: p.iid, below: p.below.slice(), energy: p.energy.slice(), tool: p.tool, damage: p.damage,
    status: { asleep: st.asleep, paralyzed: st.paralyzed, confused: st.confused, poisoned: st.poisoned, burned: st.burned },
    turnPlayed: p.turnPlayed, evolvedThisTurn: p.evolvedThisTurn, usedAbilities: p.usedAbilities.slice(),
    // Marker objects are never mutated after creation (only added / filtered out), so the objects are shared and only the list is copied
    markers: p.markers.slice(),
  };
}
function clonePlayer(ps: PlayerState): PlayerState {
  const f = ps.flags;
  return {
    deck: ps.deck.slice(), hand: ps.hand.slice(), discard: ps.discard.slice(), prizes: ps.prizes.slice(),
    active: ps.active && clonePokemon(ps.active), bench: ps.bench.map(clonePokemon), lostZone: ps.lostZone.slice(),
    flags: {
      energyAttachedThisTurn: f.energyAttachedThisTurn, supporterPlayedThisTurn: f.supporterPlayedThisTurn, stadiumPlayedThisTurn: f.stadiumPlayedThisTurn,
      retreatedThisTurn: f.retreatedThisTurn, gxUsed: f.gxUsed, vstarUsed: f.vstarUsed, abilityNamesUsed: f.abilityNamesUsed.slice(),
    },
    markers: ps.markers.slice(), lastKOTurn: ps.lastKOTurn, usedGameAbilities: ps.usedGameAbilities.slice(),
  };
}
/**
 * Copy-on-write clone for `applyAction`: everything the interpreter can mutate is copied (card-id lists via `slice`, Pokémon and
 * player records field by field), while data that is immutable once created is SHARED with the source state: event objects (the
 * stream is an append-only list), markers, `rules`, `stadium`, and `pendingChoice` (with its `origin.base` snapshot — replaced, never edited).
 * Several times faster than a generic deep clone, which dominated profiles (docs/ENGINE.md, Performance).
 * Must list every GameState field: `src/test/engine.test.ts` checks clone == deepClone and that mutating a clone never leaks.
 */
export function cloneState(s: GameState): GameState {
  return {
    seed: s.seed, rng: { s: s.rng.s }, nextId: s.nextId, turn: s.turn, activePlayer: s.activePlayer, firstPlayer: s.firstPlayer, phase: s.phase,
    players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
    stadium: s.stadium, events: s.events.slice(), winner: s.winner, winReason: s.winReason, pendingChoice: s.pendingChoice,
    setup: s.setup && { mulls: [s.setup.mulls[0], s.setup.mulls[1]], acked: [s.setup.acked[0], s.setup.acked[1]], benchDone: [s.setup.benchDone[0], s.setup.benchDone[1]] },
    rules: s.rules,
  };
}

export const mintCard = (s: GameState, defId: string): string => `${defId}#${s.nextId++}`;
/** Append an event to the stream, stamped with the current global turn. */
export const emit = (s: GameState, e: EventInput): void => { s.events.push({ ...e, turn: s.turn } as GameEvent); };
/** The event stream rendered as prose lines (debugging, error messages, string-asserting tests). */
export const logText = (s: { events: GameEvent[] }): string[] => s.events.map(formatEvent);

export const inPlay = (ps: PlayerState): PokemonInPlay[] => (ps.active ? [ps.active, ...ps.bench] : [...ps.bench]);
export interface Loc { player: PlayerId; p: PokemonInPlay; where: "active" | "bench" }
export function findPokemon(s: GameState, iid: string): Loc | undefined {
  for (const pl of [0, 1] as PlayerId[]) {
    const ps = s.players[pl];
    if (ps.active?.iid === iid) return { player: pl, p: ps.active, where: "active" };
    const b = ps.bench.find((x) => x.iid === iid);
    if (b) return { player: pl, p: b, where: "bench" };
  }
  return undefined;
}
export const topDef = (p: PokemonInPlay): CardDef => defOf(p.iid);
export const allCardsOf = (p: PokemonInPlay): string[] => [p.iid, ...p.below, ...p.energy, ...(p.tool ? [p.tool] : [])];
export function removeItem<T>(arr: T[], item: T): boolean {
  const i = arr.indexOf(item);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}
export const hasMarker = (ms: Marker[], key: string): boolean => ms.some((m) => m.key === key);
export const markerSum = (ms: Marker[], key: string): number => ms.reduce((a, m) => a + (m.key === key ? m.value ?? 0 : 0), 0);
export function clearStatuses(p: PokemonInPlay): void { p.status = emptyStatus(); }

export function drawCards(s: GameState, pl: PlayerId, n: number): number {
  const ps = s.players[pl];
  let k = 0;
  while (k < n && ps.deck.length) { ps.hand.push(ps.deck.shift()!); k++; }
  return k;
}
/** Draw with an event (nothing emitted when no card moved); returns the number drawn. */
export function drawEmit(s: GameState, pl: PlayerId, n: number, reason: DrawReason): number {
  const ps = s.players[pl];
  const before = ps.hand.length;
  const k = drawCards(s, pl, n);
  if (k > 0) emit(s, { type: "draw", player: pl, count: k, cardIds: ps.hand.slice(before), reason });
  return k;
}
/** Swap the benched Pokémon `benchIid` with the Active; old Active loses statuses and effects. */
export function swapActive(s: GameState, pl: PlayerId, benchIid: string): void {
  const ps = s.players[pl];
  const i = ps.bench.findIndex((b) => b.iid === benchIid);
  if (i < 0) throw new Error("swapActive: not on bench");
  const nu = ps.bench[i]!;
  const old = ps.active;
  if (old) { clearStatuses(old); old.markers = []; ps.bench[i] = old; } else ps.bench.splice(i, 1);
  ps.active = nu;
}
/** Send a Pokémon and everything attached to the owner's discard pile; remove it from play. */
export function discardPokemon(s: GameState, pl: PlayerId, p: PokemonInPlay): void {
  const ps = s.players[pl];
  ps.discard.push(...allCardsOf(p));
  if (ps.active === p) ps.active = null;
  else removeItem(ps.bench, p);
}
export function expireMarkers(s: GameState): void {
  const keep = (m: Marker) => m.expiresAfterTurn === undefined || m.expiresAfterTurn > s.turn;
  for (const ps of s.players) {
    ps.markers = ps.markers.filter(keep);
    for (const p of inPlay(ps)) p.markers = p.markers.filter(keep);
  }
}
export function shuffleDeck(s: GameState, pl: PlayerId): void { shuffle(s.players[pl].deck, s.rng); }
export function setWinner(s: GameState, w: PlayerId, reason: string): void {
  if (s.phase === "over") return;
  s.phase = "over"; s.winner = w; s.winReason = reason; s.pendingChoice = undefined;
  emit(s, { type: "gameEnd", winner: w, reason, turns: s.turn });
}

// ---------------------------------------------------------------- observation (hidden info redacted)
export interface ObservedPlayer {
  deckCount: number; handCount: number; hand?: string[]; discard: string[]; prizeCount: number;
  active: PokemonInPlay | null; bench: PokemonInPlay[]; lostZone: string[]; flags: PlayerFlags;
}
export interface Observation {
  viewer: PlayerId; turn: number; activePlayer: PlayerId; firstPlayer: PlayerId; phase: Phase;
  stadium?: { iid: string; owner: PlayerId }; winner?: PlayerId; winReason?: string; rules: RulesConfig;
  players: [ObservedPlayer, ObservedPlayer];
  pendingChoice?: { player: PlayerId; kind: ChoiceKind; min: number; max: number; prompt: string; options?: string[]; optionCount: number };
  /** public event stream; the opponent's drawn card ids are redacted */
  events: GameEvent[];
}
/** Hide what `viewer` could not have seen: the opponent's decklist, drawn cards and (unrevealed) searches. */
function redactEvent(e: GameEvent, viewer: PlayerId): GameEvent {
  switch (e.type) {
    case "gameStart": { const decks: [string[], string[]] = [[], []]; decks[viewer] = e.decks[viewer]; return { ...e, decks }; }
    case "draw": return e.player === viewer ? e : { ...e, cardIds: [] };
    case "search": return e.player === viewer ? e : { ...e, cardIds: [], cardNames: [] };
    default: return e;
  }
}
/** Player's view: own hand visible; opponent hand, all decks and all prizes are counts only. */
export function observe(s: GameState, viewer: PlayerId): Observation {
  const view = (pl: PlayerId): ObservedPlayer => {
    const p = s.players[pl];
    return {
      deckCount: p.deck.length, handCount: p.hand.length, hand: pl === viewer ? [...p.hand] : undefined,
      discard: [...p.discard], prizeCount: p.prizes.length, active: deepClone(p.active), bench: deepClone(p.bench),
      lostZone: [...p.lostZone], flags: { ...p.flags },
    };
  };
  const pc = s.pendingChoice;
  return {
    viewer, turn: s.turn, activePlayer: s.activePlayer, firstPlayer: s.firstPlayer, phase: s.phase,
    stadium: s.stadium, winner: s.winner, winReason: s.winReason, rules: { ...s.rules },
    players: [view(0), view(1)],
    pendingChoice: pc && {
      player: pc.player, kind: pc.kind, min: pc.min, max: pc.max, prompt: pc.prompt,
      options: pc.player === viewer ? [...pc.options] : undefined, optionCount: pc.options.length,
    },
    events: s.events.map((e) => redactEvent(e, viewer)),
  };
}
