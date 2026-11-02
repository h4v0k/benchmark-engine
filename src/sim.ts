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
  return { winner: null, reason: s.turn > maxTurns ? "maxTurns" : "actionLimit", turns: s.turn, log: s.log };
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

/** Names scanned for by `keyEffectUses` (log-based proof that real card effects, not just vanilla attacks, are exercised). */
export const KEY_EFFECTS = ["Phantom Dive", "Night Joker", "Trade", "Recon Directive", "Adrena-Brain", "Flip the Script", "Subjugating Chains", "Run Away Draw", "Last-Ditch Catch"] as const;
/** Count uses of key attacks/abilities in a game log. Last-Ditch Catch is an on-bench trigger: counted as "benches Meowth ex" immediately followed by a deck search. */
export function keyEffectUses(log: string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(KEY_EFFECTS.map((k) => [k, 0]));
  log.forEach((l, i) => {
    for (const k of KEY_EFFECTS) {
      if (k === "Last-Ditch Catch") { if (/ benches Meowth ex$/.test(l) && /searches deck/.test(log[i + 1] ?? "")) out[k]!++; }
      else if (l.endsWith(` uses ${k}`) || l.endsWith(` uses ability ${k}`)) out[k]!++;
    }
  });
  return out;
}
