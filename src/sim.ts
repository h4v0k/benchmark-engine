import { decider } from "./actions.js";
import type { Agent } from "./agents/random.js";
import type { CardDef } from "./cards/model.js";
import { applyAction, createGame } from "./game.js";
import { makeRng } from "./rng.js";
import type { PlayerId, RulesConfig } from "./state.js";

export interface GameResult { winner: PlayerId | null; reason: string; turns: number; log: string[] }

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
    s = applyAction(s, agents[d]!(s, rngs[d]!));
  }
  if (s.phase === "over") return { winner: s.winner ?? null, reason: s.winReason ?? "", turns: s.turn, log: s.log };
  return { winner: null, reason: "maxTurns", turns: s.turn, log: s.log };
}

export interface SimStats { games: number; wins: [number, number]; draws: number; avgTurns: number; maxTurnsSeen: number }
export function simulate(
  n: number, deckA: CardDef[], deckB: CardDef[], agentA: Agent, agentB: Agent,
  baseSeed = 1, maxTurns = 200, rules: Partial<RulesConfig> = {},
): SimStats {
  const st: SimStats = { games: n, wins: [0, 0], draws: 0, avgTurns: 0, maxTurnsSeen: 0 };
  let total = 0;
  for (let i = 0; i < n; i++) {
    const r = playGame(deckA, deckB, baseSeed + i, agentA, agentB, maxTurns, rules);
    if (r.winner === null) st.draws++; else st.wins[r.winner]++;
    total += r.turns;
    st.maxTurnsSeen = Math.max(st.maxTurnsSeen, r.turns);
  }
  st.avgTurns = total / n;
  return st;
}
