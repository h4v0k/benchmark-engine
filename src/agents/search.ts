// Determinized MCTS pilot (Information-Set style via sampled worlds). See docs/ROADMAP.md (M3) and docs/ENGINE.md (choice model).
//
// For every decision: sample `determinizations` worlds consistent with what the searcher knows, run `iterations` of UCT in each
// (the tree is over `legalActions`, pending `choose` actions included), play leaves out with the greedy agent for `rolloutTurns`
// turns, score unfinished leaves with a heuristic, and pick the action with the most visits summed over worlds.
//
// Hidden information (what a world replaces). The searcher is allowed the contents of `observe(state, me)`; since the engine needs a full
// GameState to simulate, a world is the true state with every unknown card re-dealt:
//   - opponent hand + deck + face-down prizes: pooled, SORTED (so the true order/zone split is erased), shuffled, re-dealt with the same counts;
//   - own deck + prizes: pooled, sorted, shuffled, re-dealt (own hand and all public zones stay as they are);
//   - the game RNG (future coin flips / shuffles) is reseeded from the agent's RNG (not while a choice is open: the replay must reproduce
//     the flips already seen, so the few flips/shuffles after that choice resolves are the real ones);
//   - the event stream is dropped (the engine only appends to it).
// Simplifications: (1) the unknown pool is the opponent's true remaining multiset, i.e. the searcher knows the opponent's decklist (as a
// player scouting the meta would); (2) cards the searcher once saw (reveals, own deck-bottom puts) are NOT tracked as known; (3) while the
// searcher has an open choice whose options are cards of a hidden zone (an own-deck search), that player's hidden zones are left as they are,
// because the options and the replay snapshot (`pendingChoice.origin.base`) must stay consistent; (4) inside a world the opponent
// plays with its (sampled) hand known to the tree, i.e. perfect information per world ("strategy fusion").
// The real hidden state is never read to decide anything: the world depends on it only through the sorted multisets and counts.
import { decider, legalActions, sameAction, wasIssued, type Action } from "../actions.js";
import { applyAction } from "../game.js";
import { isPokemon } from "../cards/model.js";
import { makeRng, next, shuffle, type Rng } from "../rng.js";
import { canPay, providedEnergy } from "../rules.js";
import { cloneState, inPlay, other, topDef, type GameState, type PlayerId, type PokemonInPlay } from "../state.js";
import { greedyAgent } from "./greedy.js";
import type { Agent } from "./random.js";

export interface SearchConfig {
  /** sampled worlds per decision */
  determinizations: number;
  /** UCT iterations per world */
  iterations: number;
  /** leaves are played out (greedy) until this many turns past the root's turn, then scored heuristically */
  rolloutTurns: number;
  cUct: number;
  /** who plays the opponent's decisions inside the tree: greedy (cheap, default) or UCT search (both sides maximize their own value) */
  opponentModel: "greedy" | "search";
  /** soft wall-clock cap per decision; the search stops starting new iterations after it (makes results timing dependent) */
  maxTimeMs?: number;
  /** nodes with more legal actions than this expand only the greedy action plus a seeded random sample of the rest */
  maxBranch: number;
}
export const DEFAULT_SEARCH: SearchConfig = { determinizations: 6, iterations: 60, rolloutTurns: 6, cUct: 1.4, opponentModel: "greedy", maxBranch: 32 };
/** Cheap preset for batch A/B runs. */
export const FAST_SEARCH: SearchConfig = { ...DEFAULT_SEARCH, determinizations: 3, iterations: 20, rolloutTurns: 2 };
/** Thorough preset (several times slower than fast). */
export const STRONG_SEARCH: SearchConfig = { ...DEFAULT_SEARCH, determinizations: 8, iterations: 80, rolloutTurns: 4 };
export const SEARCH_PRESETS = { fast: FAST_SEARCH, strong: STRONG_SEARCH, default: DEFAULT_SEARCH } as const;

export interface ActionEval {
  action: Action;
  /** simulations through this action, summed over worlds */
  visits: number;
  /** estimated probability that `player` wins after this action (null: not expanded, e.g. cut by maxBranch) */
  winProb: number | null;
}

// ------------------------------------------------------------------ heuristic value
const cheapestShortfall = (p: PokemonInPlay): number => {
  const have = providedEnergy(p);
  let best = 9;
  for (const a of topDef(p).attacks ?? []) {
    if (canPay(a.cost, have)) return 0;
    best = Math.min(best, Math.max(0, a.cost.length - have.length));
  }
  return best;
};
/** Board strength in "ready attacker" units: Pokémon able to attack count 1, partly powered ones less; Active counts a bit more. */
function boardScore(s: GameState, pl: PlayerId): number {
  const ps = s.players[pl];
  let v = 0;
  for (const p of inPlay(ps)) {
    const sf = cheapestShortfall(p);
    const hasAtk = (topDef(p).attacks ?? []).length > 0;
    if (!hasAtk) continue;
    v += sf === 0 ? 1 : sf === 1 ? 0.5 : sf === 2 ? 0.2 : 0;
    v += HW.evo * p.below.length; // evolution progress (Stage 1 = 1, Stage 2 = 2)
  }
  if (ps.active && cheapestShortfall(ps.active) === 0) v += 0.5;
  return v + Math.min(ps.bench.length, 4) * 0.1;
}
/** Fraction-of-HP damage on a side's Pokémon (the opponent's damaged board is progress for us). */
function damageTaken(s: GameState, pl: PlayerId): number {
  let d = 0;
  for (const p of inPlay(s.players[pl])) { const hp = topDef(p).hp ?? 100; d += (p.damage / hp) * (isPokemon(topDef(p)) && /ex/i.test(topDef(p).name) ? 2 : 1); }
  return d;
}
const deckRisk = (n: number): number => Math.max(0, 16 - n) * 0.08 + (n < 6 ? (6 - n) * 0.5 : 0);
/** Heuristic probability that `me` wins from a non-terminal state; terminal states give exactly 1 / 0 / 0.5. */
/** Heuristic weights (exported so experiments can tune them; defaults are the shipped values). */
export const HW = { board: 0.35, damage: 0.35, hand: 0.04, deckDiff: 0.03, evo: 0.25, scale: 1.8 };
export function heuristicValue(s: GameState, me: PlayerId): number {
  if (s.phase === "over") return s.winner === undefined ? 0.5 : s.winner === me ? 1 : 0;
  const opp = other(me), mine = s.players[me], theirs = s.players[opp];
  // prize differential is dominant: one prize ~ 1.0, everything else together is worth about a prize or two
  let x = theirs.prizes.length - mine.prizes.length;
  x += HW.board * (boardScore(s, me) - boardScore(s, opp));
  x += HW.damage * (damageTaken(s, opp) - damageTaken(s, me));
  x += HW.hand * (Math.min(mine.hand.length, 8) - Math.min(theirs.hand.length, 8));
  x -= deckRisk(mine.deck.length) - deckRisk(theirs.deck.length);
  x += HW.deckDiff * Math.max(-10, Math.min(10, mine.deck.length - theirs.deck.length)); // the smaller library loses a stall
  if (!mine.active) x -= 1.5;
  if (!theirs.active) x += 1.5;
  return 1 / (1 + Math.exp(-x / HW.scale));
}

// ------------------------------------------------------------------ determinization
const sortedCopy = (xs: string[]): string[] => xs.slice().sort();
/** Re-deal one player's hidden cards. `keepHand`: the hand is known (own) and only deck + prizes are pooled. */
function redeal(st: GameState, pl: PlayerId, keepHand: boolean, seed: number): void {
  const ps = st.players[pl];
  const rng = makeRng(seed);
  const pool = sortedCopy(keepHand ? [...ps.deck, ...ps.prizes] : [...ps.hand, ...ps.deck, ...ps.prizes]);
  shuffle(pool, rng);
  const nHand = keepHand ? 0 : ps.hand.length, nDeck = ps.deck.length, nPrize = ps.prizes.length;
  if (!keepHand) ps.hand = pool.slice(0, nHand);
  ps.deck = pool.slice(nHand, nHand + nDeck);
  ps.prizes = pool.slice(nHand + nDeck, nHand + nDeck + nPrize);
}
/** A world: the true state with hidden information re-sampled (see the file header). Never mutates `real`. */
function determinize(real: GameState, me: PlayerId, rng: Rng, keepAll = false): GameState {
  const opp = other(me);
  const seedMe = Math.floor(next(rng) * 4294967296), seedOpp = Math.floor(next(rng) * 4294967296), seedRng = Math.floor(next(rng) * 4294967296);
  const pc = real.pendingChoice;
  // ids the open choice refers to: its options and the answers already given (replays re-resolve those against the base snapshot's zones)
  const refs = new Set<string>(pc?.options ?? []);
  for (const a of pc?.origin?.answers ?? []) for (const x of a) refs.add(x.split("=")[0]!);
  const touches = (pl: PlayerId): boolean => {
    if (!refs.size) return false;
    const zones = [real, pc?.origin?.base].flatMap((st) => (st ? [...st.players[pl].hand, ...st.players[pl].deck, ...st.players[pl].prizes] : []));
    return zones.some((c) => refs.has(c));
  };
  // a half-answered choice (answers already given) was resolved against the real zones: replaying it in another world could ask other questions
  const keepAllHere = keepAll || (pc?.origin?.answers.length ?? 0) > 0;
  const keepMe = keepAllHere || touches(me), keepOpp = keepAllHere || touches(opp);
  const apply = (st: GameState): void => {
    st.events = [];
    if (!keepOpp) redeal(st, opp, false, seedOpp);
    if (!keepMe) redeal(st, me, true, seedMe);
    if (!pc?.origin) st.rng = { s: seedRng >>> 0 }; // an open choice replays from `base`: its coin flips so far are already public, so its RNG stays
  };
  const w = cloneState(real);
  apply(w);
  if (pc?.origin) { // the replay snapshot holds the same hidden zones: give it the identical world so replays stay consistent
    const base = cloneState(pc.origin.base);
    apply(base);
    w.pendingChoice = { ...pc, origin: { ...pc.origin, base } };
  }
  return w;
}

// ------------------------------------------------------------------ search
interface Node {
  s: GameState;
  mover: PlayerId | null;
  acts: Action[];
  untried: number[];
  kids: Array<Node | null>;
  dead: boolean[]; // actions that failed to replay (open-choice resampling only)
  n: number;
  w: number; // sum of values from the ROOT player's point of view
}
const noRng: Rng = { s: 0 };

function step(s: GameState, a: Action, trusted: boolean): GameState { return applyAction(s, a, { trusted }); }

/** Legal actions of a node, ordered with the greedy agent's choice first. `forceGreedy`: expand only that one action. */
function makeNode(s: GameState, root: PlayerId, cfg: SearchConfig, rng: Rng): Node {
  const mover = decider(s);
  const node: Node = { s, mover, acts: [], untried: [], kids: [], dead: [], n: 0, w: 0 };
  if (mover === null) return node;
  const g = greedyAgent(s, noRng);
  if (mover !== root && cfg.opponentModel === "greedy") { node.acts = [g]; node.untried = [0]; node.kids = [null]; return node; }
  const acts = legalActions(s, mover);
  let idx = acts.map((_, i) => i);
  const gi = acts.findIndex((a) => sameAction(a, g));
  if (gi > 0) idx = [gi, ...idx.filter((i) => i !== gi)];
  if (idx.length > cfg.maxBranch) { // greedy action + a seeded sample of the rest
    const rest = shuffle(idx.slice(1), rng).slice(0, cfg.maxBranch - 1);
    idx = [idx[0]!, ...rest];
  }
  node.acts = idx.map((i) => acts[i]!);
  node.untried = node.acts.map((_, i) => i);
  node.kids = node.acts.map(() => null);
  return node;
}

function playOut(s: GameState, limitTurn: number): GameState {
  let guard = 0;
  while (s.phase !== "over" && s.turn < limitTurn && guard++ < 600) {
    const a = greedyAgent(s, noRng);
    s = step(s, a, wasIssued(s, a));
  }
  return s;
}

interface RootStat { action: Action; n: number; w: number; dead: boolean }
/** One world: UCT from `rootState`; returns per-root-action statistics. */
function searchWorld(rootState: GameState, me: PlayerId, cfg: SearchConfig, rng: Rng, deadline: number): RootStat[] {
  const limitTurn = rootState.turn + cfg.rolloutTurns;
  const root = makeNode(rootState, me, cfg, rng);
  const rootPending = !!rootState.pendingChoice;
  for (let it = 0; it < cfg.iterations; it++) {
    if (it > 0 && performance.now() > deadline) break;
    const path: Node[] = [root];
    let node = root;
    // selection / expansion
    for (;;) {
      if (node.mover === null || node.s.turn >= limitTurn) break;
      if (node.untried.length) {
        let child: Node | null = null;
        while (!child && node.untried.length) {
          const ai = node.untried.shift()!;
          try { child = makeNode(step(node.s, node.acts[ai]!, true), me, cfg, rng); } catch (e) {
            if (node !== root || !rootPending) throw e; // only a resampled open choice may legitimately fail to replay
            node.dead[ai] = true; continue;
          }
          node.kids[ai] = child;
        }
        if (child) { path.push(child); node = child; }
        break;
      }
      const lnN = Math.log(Math.max(1, node.n));
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < node.kids.length; i++) {
        const k = node.kids[i];
        if (!k) continue;
        const q = k.n ? k.w / k.n : 0.5;
        const score = (node.mover === me ? q : 1 - q) + cfg.cUct * Math.sqrt(lnN / Math.max(1, k.n));
        if (score > bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) break;
      node = node.kids[best]!;
      path.push(node);
    }
    // evaluation: greedy playout, then heuristic
    const end = node.s.phase === "over" ? node.s : playOut(node.s, limitTurn);
    const v = heuristicValue(end, me);
    for (const p of path) { p.n++; p.w += v; }
  }
  return root.acts.map((action, i) => ({ action, n: root.kids[i]?.n ?? 0, w: root.kids[i]?.w ?? 0, dead: root.dead[i] === true }));
}

/** Estimated win probability and visit count for every legal action of `player` (who must be the one to move). Deterministic given `rng`. */
export function evaluateActions(state: GameState, player: PlayerId, config: Partial<SearchConfig> = {}, rng: Rng = makeRng(0x5eed + state.turn)): ActionEval[] {
  const cfg: SearchConfig = { ...DEFAULT_SEARCH, ...config };
  if (decider(state) !== player) throw new Error(`evaluateActions: it is not P${player}'s decision`);
  const real = legalActions(state, player);
  const tot = real.map(() => ({ n: 0, w: 0 }));
  const deadline = cfg.maxTimeMs === undefined ? Infinity : performance.now() + cfg.maxTimeMs;
  for (let d = 0; d < cfg.determinizations; d++) {
    if (d > 0 && performance.now() > deadline) break;
    let stats = searchWorld(determinize(state, player, rng), player, cfg, rng, deadline);
    // an open choice whose resampled replay fails for (nearly) every action: search the unresampled state instead (documented leak)
    if (state.pendingChoice && stats.filter((x) => x.dead).length * 2 > stats.length) stats = searchWorld(determinize(state, player, rng, true), player, cfg, rng, deadline);
    for (const st of stats) {
      if (st.dead) continue;
      const i = real.findIndex((a) => sameAction(a, st.action));
      if (i >= 0) { tot[i]!.n += st.n; tot[i]!.w += st.w; }
    }
  }
  return real.map((action, i) => ({ action, visits: tot[i]!.n, winProb: tot[i]!.n ? tot[i]!.w / tot[i]!.n : null }));
}

/** Index of the most visited action (ties: higher win probability, then earlier). */
export function bestIndex(evals: ActionEval[]): number {
  let best = 0;
  for (let i = 1; i < evals.length; i++) {
    const a = evals[i]!, b = evals[best]!;
    if (a.visits > b.visits || (a.visits === b.visits && (a.winProb ?? 0) > (b.winProb ?? 0))) best = i;
  }
  return best;
}

/** The search pilot as an `Agent` (see sim.ts). Setup decisions and forced moves are delegated without searching. */
export function searchAgent(config: Partial<SearchConfig> = {}): Agent {
  const cfg: SearchConfig = { ...DEFAULT_SEARCH, ...config };
  return (state, rng) => {
    const pl = decider(state);
    if (pl === null) throw new Error("game over");
    if (state.phase !== "main") return greedyAgent(state, rng);
    const acts = legalActions(state, pl);
    if (acts.length === 1) return acts[0]!;
    const ev = evaluateActions(state, pl, cfg, rng);
    return ev[bestIndex(ev)]!.action;
  };
}
