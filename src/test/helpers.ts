import { decider, legalActions, type Action } from "../actions.js";
import { ALL_TEST_CARDS, deckA, deckB } from "../cards/test-cards.js";
import { registerCards, type CardDef } from "../cards/model.js";
import { applyAction, createGame } from "../game.js";
import { mintCard, newPokemon, type GameState, type PlayerId, type PokemonInPlay } from "../state.js";

registerCards(ALL_TEST_CARDS);

/** Drive all setup phases with the first legal action (extra mulligan cards: take the max). */
export function startGame(seed = 1, a: CardDef[] = deckA, b: CardDef[] = deckB): GameState {
  let s = createGame(a, b, seed);
  let guard = 0;
  while (s.phase !== "main") {
    if (guard++ > 100) throw new Error("setup did not finish");
    const d = decider(s)!;
    const acts = legalActions(s, d);
    let act: Action = acts[0]!;
    if (s.pendingChoice) act = acts[acts.length - 1]!;
    s = applyAction(s, act);
  }
  return s;
}
/** A clean main-phase board: P0 to act at `turn`, empty hands/boards, decks intact. */
export function mainState(seed = 1, turn = 5): GameState {
  const s = startGame(seed);
  s.turn = turn; s.activePlayer = 0; s.firstPlayer = 0;
  for (const ps of s.players) {
    ps.hand = []; ps.bench = []; ps.active = null;
    ps.flags = { ...ps.flags, energyAttachedThisTurn: false, supporterPlayedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false };
  }
  return s;
}
export interface PokeOpts { energy?: string[]; damage?: number; turnPlayed?: number; tool?: string }
export function mk(s: GameState, defId: string, o: PokeOpts = {}): PokemonInPlay {
  const p = newPokemon(mintCard(s, defId), o.turnPlayed ?? 0);
  for (const e of o.energy ?? []) p.energy.push(mintCard(s, e));
  if (o.tool) p.tool = mintCard(s, o.tool);
  p.damage = o.damage ?? 0;
  return p;
}
export const setActive = (s: GameState, pl: PlayerId, defId: string, o?: PokeOpts) => (s.players[pl].active = mk(s, defId, o));
export const addBench = (s: GameState, pl: PlayerId, defId: string, o?: PokeOpts) => { const p = mk(s, defId, o); s.players[pl].bench.push(p); return p; };
export function give(s: GameState, pl: PlayerId, defId: string): string {
  const c = mintCard(s, defId);
  s.players[pl].hand.push(c);
  return c;
}
export const acts = (s: GameState, pl: PlayerId, type: Action["type"]) => legalActions(s, pl).filter((a) => a.type === type);
export const coins = (s: GameState): string[] => s.events.flatMap((e) => (e.type === "coin" ? [e.heads ? "H" : "T"] : []));
export { applyAction, legalActions };
