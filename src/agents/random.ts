import { decider, legalActions, type Action } from "../actions.js";
import { int, next, type Rng } from "../rng.js";
import type { GameState } from "../state.js";

export type Agent = (state: GameState, rng: Rng) => Action;
export interface RandomAgentOpts {
  /** probability of choosing an attack when at least one is legal (keeps games moving) */
  attackBias: number;
}
/** Uniformly random legal action; with probability `attackBias` an available attack is taken instead. */
export function randomAgent(state: GameState, rng: Rng, opts: RandomAgentOpts = { attackBias: 0.7 }): Action {
  const pl = decider(state);
  if (pl === null) throw new Error("game over");
  const pc = state.pendingChoice;
  if (pc && pc.kind === "distribute") {
    // assign each unit to a uniformly random target
    const counts = new Map<string, number>();
    for (let i = 0; i < pc.max; i++) { const id = pc.options[int(rng, pc.options.length)]!; counts.set(id, (counts.get(id) ?? 0) + 1); }
    return { type: "choose", picks: [...counts].map(([id, c]) => `${id}=${c}`) };
  }
  const acts = legalActions(state, pl);
  if (!acts.length) throw new Error("no legal actions");
  const attacks = acts.filter((a) => a.type === "attack");
  if (attacks.length && next(rng) < opts.attackBias) return attacks[int(rng, attacks.length)]!;
  return acts[int(rng, acts.length)]!;
}
export const makeRandomAgent = (opts: RandomAgentOpts): Agent => (s, r) => randomAgent(s, r, opts);
