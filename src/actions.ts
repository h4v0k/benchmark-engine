import type { Effect } from "./dsl/types.js";
import { defIdOf, defOf, hasSub, isBasicPokemon, isEnergy, isPokemon, type CardDef } from "./cards/model.js";
import { evalCond, newCtx, type Run } from "./interpreter.js";
import { canPay, isFirstTurnOfGame, providedEnergy, retreatCostOf } from "./rules.js";
import { cloneState, hasMarker, inPlay, other, topDef, type GameState, type PendingChoice, type PlayerId, type PokemonInPlay } from "./state.js";

export type Action =
  | { type: "playBasicToBench"; card: string }
  | { type: "evolve"; target: string; card: string }
  | { type: "attachEnergy"; card: string; target: string }
  | { type: "playItem"; card: string; choices?: string[][] }
  | { type: "playSupporter"; card: string; choices?: string[][] }
  | { type: "playStadium"; card: string }
  | { type: "attachTool"; card: string; target: string }
  | { type: "useAbility"; pokemon: string; abilityIndex: number; choices?: string[][] }
  | { type: "retreat"; newActive: string; energyToDiscard: string[] }
  | { type: "attack"; attackIndex: number; choices?: string[][] }
  | { type: "endTurn" }
  | { type: "chooseActive"; card: string }
  | { type: "chooseBench"; card?: string } // no card = done benching
  | { type: "mulliganAck" }
  | { type: "choose"; picks: string[] };

/** Whose decision is it right now (null when the game is over). */
export function decider(s: GameState): PlayerId | null {
  if (s.phase === "over") return null;
  if (s.pendingChoice) return s.pendingChoice.player;
  const su = s.setup;
  switch (s.phase) {
    case "mulliganAck": { const p = ([0, 1] as PlayerId[]).find((x) => su!.mulls[x] > 0 && !su!.acked[x]); return p ?? 0; }
    case "setupActive": return s.players[0].active ? 1 : 0;
    case "setupBench": return su!.benchDone[0] ? 1 : 0;
    case "main": return s.activePlayer;
    default: return s.activePlayer;
  }
}

function combos(options: string[], lo: number, hi: number, sig: (id: string) => string, cap = 256): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  let visited = 0;
  const rec = (start: number, cur: string[], k: number) => {
    if (out.length >= cap || visited++ > 20000) return;
    if (cur.length === k) {
      const key = cur.map(sig).sort().join("|");
      if (!seen.has(key)) { seen.add(key); out.push([...cur]); }
      return;
    }
    for (let i = start; i < options.length; i++) { cur.push(options[i]!); rec(i + 1, cur, k); cur.pop(); }
  };
  for (let k = lo; k <= Math.min(hi, options.length); k++) rec(0, [], k);
  return out;
}
export function chooseActions(pc: PendingChoice, dedupe = true): Action[] {
  const sig = pc.kind === "cards" && dedupe ? defIdOf : (x: string) => x;
  return combos(pc.options, pc.min, pc.max, sig).map((picks) => ({ type: "choose" as const, picks }));
}

/** Effects whose top-level `switch` can't resolve (no Benched Pokémon) make a Trainer unplayable. */
function effectUsable(s: GameState, pl: PlayerId, e: Effect): boolean {
  if (e.e === "seq") return e.steps.every((x) => effectUsable(s, pl, x));
  if (e.e === "switch") {
    const target = e.player === "opp" ? other(pl) : e.player === "active-player" ? s.activePlayer : pl;
    const ps = s.players[target];
    return !!ps.active && ps.bench.length > 0;
  }
  return true;
}
const playEffect = (d: CardDef) => d.rules?.find((r) => r.trigger.t === "play")?.effect;

export function canAttackNow(s: GameState, pl: PlayerId): boolean {
  const a = s.players[pl].active;
  if (!a || s.phase !== "main" || s.pendingChoice) return false;
  if (s.rules.noAttackOnFirstTurnOfGame && isFirstTurnOfGame(s, pl)) return false;
  if (a.status.asleep || a.status.paralyzed) return false;
  return !hasMarker(a.markers, "noAttack");
}
export function canRetreatNow(s: GameState, pl: PlayerId): boolean {
  const ps = s.players[pl];
  const a = ps.active;
  if (!a || ps.flags.retreatedThisTurn || !ps.bench.length) return false;
  if (a.status.asleep || a.status.paralyzed || hasMarker(a.markers, "noRetreat")) return false;
  return true;
}

/** All legal actions for `player` at the current decision point. Identical cards are deduped (first copy). */
export function legalActions(s: GameState, player: PlayerId): Action[] { return enumerate(s, player, true); }

export function enumerate(s: GameState, player: PlayerId, dedupe: boolean): Action[] {
  if (s.phase === "over" || decider(s) !== player) return [];
  if (s.pendingChoice) return chooseActions(s.pendingChoice, dedupe);
  const ps = s.players[player];
  const out: Action[] = [];
  const seen = new Set<string>();
  const add = (a: Action, key: string) => { if (dedupe) { if (seen.has(key)) return; seen.add(key); } out.push(a); };

  switch (s.phase) {
    case "mulliganAck": return [{ type: "mulliganAck" }];
    case "setupActive":
      for (const c of ps.hand) if (isBasicPokemon(defOf(c))) add({ type: "chooseActive", card: c }, defIdOf(c));
      return out;
    case "setupBench":
      add({ type: "chooseBench" }, "done");
      if (ps.bench.length < s.rules.benchSize) for (const c of ps.hand) if (isBasicPokemon(defOf(c))) add({ type: "chooseBench", card: c }, defIdOf(c));
      return out;
    case "main": break;
    default: return [];
  }

  const targets = inPlay(ps);
  const canEvolveNow = !(s.rules.noEvolveOnFirstTurn && s.turn <= 2);
  for (const c of ps.hand) {
    const d = defOf(c);
    if (isPokemon(d)) {
      if (isBasicPokemon(d) && ps.bench.length < s.rules.benchSize) add({ type: "playBasicToBench", card: c }, `b:${d.id}`);
      if (d.evolvesFrom && canEvolveNow)
        for (const t of targets)
          if (topDef(t).name === d.evolvesFrom && t.turnPlayed < s.turn && !t.evolvedThisTurn) add({ type: "evolve", target: t.iid, card: c }, `ev:${d.id}:${t.iid}`);
    } else if (isEnergy(d)) {
      if (!ps.flags.energyAttachedThisTurn) for (const t of targets) add({ type: "attachEnergy", card: c, target: t.iid }, `en:${d.id}:${t.iid}`);
    } else if (hasSub(d, "item")) {
      const e = playEffect(d);
      if (!hasMarker(ps.markers, "noPlay:item") && (!e || effectUsable(s, player, e))) add({ type: "playItem", card: c }, `i:${d.id}`);
    } else if (hasSub(d, "supporter")) {
      const e = playEffect(d);
      if (!ps.flags.supporterPlayedThisTurn && !hasMarker(ps.markers, "noPlay:supporter")
        && !(s.rules.noSupporterOnFirstTurnOfGame && isFirstTurnOfGame(s, player)) && (!e || effectUsable(s, player, e)))
        add({ type: "playSupporter", card: c }, `s:${d.id}`);
    } else if (hasSub(d, "stadium")) {
      if (!ps.flags.stadiumPlayedThisTurn && !(s.stadium && defOf(s.stadium.iid).name === d.name)) add({ type: "playStadium", card: c }, `st:${d.id}`);
    } else if (hasSub(d, "tool")) {
      for (const t of targets) if (!t.tool) add({ type: "attachTool", card: c, target: t.iid }, `tl:${d.id}:${t.iid}`);
    }
  }

  // abilities
  if (!s.players.some((x) => hasMarker(x.markers, "noAbility"))) {
    for (const t of targets) {
      const abs = topDef(t).abilities ?? [];
      abs.forEach((ab, i) => {
        if (ab.trigger && ab.trigger.t !== "ability") return;
        if (ab.limit === "oncePerTurn" && t.usedAbilities.includes(ab.name)) return;
        if (ab.limit === "oncePerGame" && ps.usedGameAbilities.includes(ab.name)) return;
        if (!effectUsable(s, player, ab.effect)) return;
        if (ab.requires) {
          const run: Run = { s: cloneState(s), answers: [], idx: 0 };
          if (!evalCond(newCtx(run, player, "ability", { self: t.iid }), ab.requires)) return;
        }
        out.push({ type: "useAbility", pokemon: t.iid, abilityIndex: i });
      });
    }
  }

  // retreat
  if (canRetreatNow(s, player)) {
    const a = ps.active!;
    const cost = retreatCostOf(s, a);
    if (providedEnergy(a).length >= cost) {
      const sets = cost === 0 ? [[]] : combos(a.energy, cost, cost, defIdOf, dedupe ? 64 : 2000).filter((c) => c.reduce((n, e) => n + (defOf(e).types?.length ?? 1), 0) >= cost);
      for (const b of ps.bench) for (const set of sets) out.push({ type: "retreat", newActive: b.iid, energyToDiscard: set });
    }
  }

  // attacks
  if (canAttackNow(s, player)) {
    const a = ps.active!;
    (topDef(a).attacks ?? []).forEach((atk, i) => {
      if (!canPay(atk.cost, providedEnergy(a))) return;
      if (hasMarker(a.markers, `noAttack:${atk.name}`)) return;
      out.push({ type: "attack", attackIndex: i });
    });
  }
  out.push({ type: "endTurn" });
  return out;
}

/** Stable key for comparing actions (ignores pre-supplied `choices`). */
export function actionKey(a: Action): string {
  const o: Record<string, unknown> = { ...a };
  delete o.choices;
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
}
export const pokemonById = (s: GameState, iid: string): PokemonInPlay | undefined => inPlay(s.players[0]).concat(inPlay(s.players[1])).find((p) => p.iid === iid);
