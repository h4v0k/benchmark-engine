// DSL effect interpreter. Pure state machine: when a decision is needed and no recorded answer exists,
// `ask` throws NeedChoice; the caller (game.ts) turns that into state.pendingChoice and later REPLAYS the
// originating action with the recorded answers (deterministic because the rng lives in the state).
import type { Amount, CardFilter, CardSel, Condition, Duration, Effect, Entry, PlayerRef, Selector, Status, Trigger, Zone } from "./dsl/types.js";
import { defOf, isBasicPokemon, matchesFilter } from "./cards/model.js";
import { flip, shuffle } from "./rng.js";
import {
  type ChoiceReq, type GameState, type Marker, type PlayerId, type PlayerState, type PokemonInPlay,
  allCardsOf, clearStatuses, drawCards, findPokemon, hasMarker, inPlay, log, markerSum, newPokemon, other,
  removeItem, swapActive, topDef,
} from "./state.js";
import { maxHp, weaknessResistance } from "./rules.js";
import { abilityLocked, staticPreventsDamage, staticStat } from "./statics.js";

export class NeedChoice extends Error {
  constructor(public req: ChoiceReq) { super("need choice"); }
}
export interface Run {
  s: GameState; answers: string[][]; idx: number;
  /** iids that were at/over lethal damage right after the current attack (for onKnockedOut `byAttack`) */
  attackKOs?: string[];
}
export type CtxKind = "attack" | "ability" | "item" | "supporter" | "stadium" | "tool" | "other";
export interface Ctx {
  run: Run; player: PlayerId; kind: CtxKind;
  self?: string; attached?: string;
  binds: Record<string, string[]>;
  /** attack damage pool toward the Defending Pokémon; null = attack deals no damage */
  dmg: number | null; mods: number; cancelled: boolean;
  didPrev: boolean; discarded: number; endTurn: boolean;
  /** an attack's damage ignores effects on the Defending Pokémon (`damage{effects:false}`) */
  ignoreDefEffects: boolean;
  /** inside a copied attack (recursion guard for copyAttack) */
  copying: boolean;
}
export const newCtx = (run: Run, player: PlayerId, kind: CtxKind, o: { self?: string; attached?: string } = {}): Ctx => ({
  run, player, kind, self: o.self, attached: o.attached, binds: {}, dmg: null, mods: 0, cancelled: false,
  didPrev: false, discarded: 0, endTurn: false, ignoreDefEffects: false, copying: false,
});

export function notImplemented(node: { e?: string; k?: string; c?: string; s?: string }): never {
  throw new Error(`notImplemented: DSL node ${JSON.stringify(node.e ?? node.k ?? node.c ?? node.s)}`);
}

// ------------------------------------------------------------------ choices
export function ask(run: Run, req: ChoiceReq): string[] {
  const n = req.options.length;
  if (n === 0 || req.max <= 0) return [];
  if (req.kind === "distribute" && n === 1) return [`${req.options[0]}=${req.max}`];
  if (req.kind !== "distribute" && req.min >= n) return req.options.slice();
  if (run.idx < run.answers.length) {
    const a = run.answers[run.idx++]!;
    if (!validPicks(req, a)) throw new Error(`invalid choice ${JSON.stringify(a)} for ${req.prompt}`);
    return a;
  }
  throw new NeedChoice(req);
}
export function validPicks(req: ChoiceReq, picks: string[]): boolean {
  if (req.kind === "distribute") {
    const seen = new Set<string>();
    let sum = 0;
    for (const p of picks) {
      const [id, c, ...rest] = p.split("=");
      const k = Number(c);
      if (rest.length || !id || !req.options.includes(id) || seen.has(id) || !Number.isInteger(k) || k < 1) return false;
      seen.add(id); sum += k;
    }
    return sum === req.max;
  }
  if (picks.length < req.min || picks.length > req.max) return false;
  if (new Set(picks).size !== picks.length) return false;
  return picks.every((p) => req.options.includes(p));
}

// ------------------------------------------------------------------ helpers
const players = (ctx: Ctx, ref: PlayerRef): PlayerId[] => {
  switch (ref) {
    case "self": return [ctx.player];
    case "opp": return [other(ctx.player)];
    case "both": return [ctx.player, other(ctx.player)];
    case "active-player": return [ctx.run.s.activePlayer];
  }
};
const player1 = (ctx: Ctx, ref: PlayerRef): PlayerId => players(ctx, ref)[0]!;
const S = (ctx: Ctx): GameState => ctx.run.s;
export const coin = (s: GameState): boolean => {
  const h = flip(s.rng);
  s.log.push(`T${s.turn} coin ${h ? "H" : "T"}`);
  return h;
};
export function zoneArr(ps: PlayerState, z: Zone): string[] {
  switch (z) {
    case "deck": return ps.deck; case "hand": return ps.hand; case "discard": return ps.discard;
    case "prizes": return ps.prizes; case "lostzone": return ps.lostZone;
    default: throw new Error(`zone ${z} is not a card list`);
  }
}
const byIid = (s: GameState, iid: string): PokemonInPlay => {
  const l = findPokemon(s, iid);
  if (!l) throw new Error(`pokemon not in play: ${iid}`);
  return l.p;
};
export const pokemonFacts = (p: PokemonInPlay) => ({ damaged: p.damage > 0, hasEnergy: p.energy.length > 0, hasTool: !!p.tool });
const cardMatches = (iid: string, f: CardSel["filter"]) => matchesFilter(defOf(iid), f);

// ------------------------------------------------------------------ amounts
export function evalAmount(ctx: Ctx, a: Amount): number {
  if (typeof a === "number") return a;
  const s = S(ctx);
  switch (a.k) {
    case "count": {
      const per = a.per ?? 1;
      const of = a.of;
      if ("s" in of) return per * selectPokemon(ctx, of).length;
      return per * countCards(ctx, { player: of.player, zone: of.zone, from: of.from, filter: of });
    }
    case "flips": { const n = evalAmount(ctx, a.n); let h = 0; for (let i = 0; i < n; i++) if (coin(s)) h++; return h * a.per; }
    case "flipUntilTails": { let h = 0; while (coin(s)) h++; return h * a.per; }
    case "prizesTaken": return players(ctx, a.player).reduce<number>((t, p) => t + (6 - s.players[p].prizes.length), 0);
    case "prizesLeft": return players(ctx, a.player).reduce<number>((t, p) => t + s.players[p].prizes.length, 0);
    case "damageCounters": return selectPokemon(ctx, a.of).reduce<number>((t, p) => t + p.damage / 10, 0);
    case "handSize": return players(ctx, a.player).reduce<number>((t, p) => t + s.players[p].hand.length, 0);
    case "cardsDiscardedThisWay": return ctx.discarded;
    case "math": {
      const x = evalAmount(ctx, a.a), y = evalAmount(ctx, a.b);
      switch (a.op) { case "+": return x + y; case "-": return x - y; case "*": return x * y; case "min": return Math.min(x, y); case "max": return Math.max(x, y); }
      break;
    }
    case "upTo": return evalAmount(ctx, a.n);
    case "any": case "all": return Infinity;
  }
  return notImplemented(a as never);
}
function countCards(ctx: Ctx, of: { player: PlayerRef; zone: Zone; from?: Selector; filter?: CardSel["filter"] }): number {
  const s = S(ctx);
  let total = 0;
  for (const pl of players(ctx, of.player)) {
    const ps = s.players[pl];
    switch (of.zone) {
      case "bench": total += ps.bench.filter((p) => matchesFilter(topDef(p), of.filter, pokemonFacts(p))).length; break;
      case "active": total += ps.active && matchesFilter(topDef(ps.active), of.filter, pokemonFacts(ps.active)) ? 1 : 0; break;
      case "play": total += inPlay(ps).filter((p) => matchesFilter(topDef(p), of.filter, pokemonFacts(p))).length; break;
      case "attached": {
        const hosts = of.from ? selectPokemon(ctx, of.from) : inPlay(ps);
        for (const h of hosts) total += h.energy.filter((e) => cardMatches(e, of.filter)).length;
        break;
      }
      default: total += zoneArr(ps, of.zone).filter((c) => cardMatches(c, of.filter)).length;
    }
  }
  return total;
}
export function countRange(ctx: Ctx, a: Amount): { min: number; max: number } {
  if (typeof a === "number") return { min: a, max: a };
  if (a.k === "upTo") return { min: 0, max: evalAmount(ctx, a.n) };
  if (a.k === "any") return { min: 0, max: Infinity };
  if (a.k === "all") return { min: Infinity, max: Infinity };
  const v = evalAmount(ctx, a);
  return { min: v, max: v };
}

// ------------------------------------------------------------------ conditions
export function evalCond(ctx: Ctx, c: Condition): boolean {
  const s = S(ctx);
  switch (c.c) {
    case "and": return c.of.every((x) => evalCond(ctx, x));
    case "or": return c.of.some((x) => evalCond(ctx, x));
    case "not": return !evalCond(ctx, c.of);
    case "cmp": {
      const a = evalAmount(ctx, c.a), b = evalAmount(ctx, c.b);
      switch (c.op) { case "<": return a < b; case "<=": return a <= b; case "=": return a === b; case ">=": return a >= b; case ">": return a > b; }
      break;
    }
    case "is": { const t = selectPokemon(ctx, c.who); return t.length > 0 && t.every((p) => matchesFilter(topDef(p), c.filter, pokemonFacts(p))); }
    case "has": {
      const need = c.min ?? 1;
      return countCards(ctx, { player: c.player, zone: c.zone, filter: c.filter, from: c.from }) >= need;
    }
    case "status": return selectPokemon(ctx, c.who).some((p) => p.status[statusKey(c.status)]);
    case "coin": return coin(s);
    case "didPrev": return ctx.didPrev;
    case "koLastTurn": return players(ctx, c.player).some((p) => s.players[p].lastKOTurn === s.turn - 1);
    case "stadiumInPlay": return !!s.stadium && (c.name === undefined || defOf(s.stadium.iid).name === c.name);
    case "firstTurn": return s.turn <= 2;
    case "lastCardInHand": return s.players[ctx.player].hand.length === 1;
    case "inPlayActive": return !!ctx.self && s.players[ctx.player].active?.iid === ctx.self;
    case "playedFromHandThisTurn": return false;
    case "tagged": return s.players[ctx.player].markers.some((m) => m.key === `tag:${c.key}`);
  }
  return notImplemented(c as never);
}
const statusKey = (st: Status): keyof PokemonInPlay["status"] =>
  ({ paralyzed: "paralyzed", confused: "confused", asleep: "asleep", burned: "burned", poisoned: "poisoned" } as const)[st];

// ------------------------------------------------------------------ selectors
/** Candidates of a `pick` selector (no choice asked). Used to tell whether a "choose 1 of your ..." effect can resolve at all. */
export function pickCandidates(ctx: Ctx, sel: Extract<Selector, { s: "pick" }>): PokemonInPlay[] {
  const s = S(ctx);
  const cands: PokemonInPlay[] = [];
  for (const pl of players(ctx, sel.player)) {
    const ps = s.players[pl];
    const list = sel.where === "active" ? (ps.active ? [ps.active] : []) : sel.where === "bench" ? ps.bench : inPlay(ps);
    for (const p of list) if (matchesFilter(topDef(p), sel.filter, pokemonFacts(p))) cands.push(p);
  }
  return cands;
}
export function selectPokemon(ctx: Ctx, sel: Selector, chooserOverride?: PlayerRef, extra?: CardFilter): PokemonInPlay[] {
  const s = S(ctx);
  switch (sel.s) {
    case "self": return ctx.self && findPokemon(s, ctx.self) ? [byIid(s, ctx.self)] : [];
    case "defending": { const a = s.players[other(ctx.player)].active; return a ? [a] : []; }
    case "attached-to": return ctx.attached && findPokemon(s, ctx.attached) ? [byIid(s, ctx.attached)] : [];
    case "ref": return (ctx.binds[sel.id] ?? []).filter((i) => findPokemon(s, i)).map((i) => byIid(s, i));
    case "pick": {
      const cands: PokemonInPlay[] = [];
      for (const pl of players(ctx, sel.player)) {
        const ps = s.players[pl];
        const list = sel.where === "active" ? (ps.active ? [ps.active] : []) : sel.where === "bench" ? ps.bench : inPlay(ps);
        for (const p of list) if (matchesFilter(topDef(p), sel.filter, pokemonFacts(p)) && matchesFilter(topDef(p), extra, pokemonFacts(p))) cands.push(p);
      }
      const { min, max } = countRange(ctx, sel.count);
      if (sel.mode === "all" || sel.mode === "divide" || min === Infinity) return cands;
      const n = cands.length;
      const lo = Math.min(min, n), hi = Math.min(max, n);
      if (sel.mode === "random") return shuffle(cands.slice(), s.rng).slice(0, hi);
      const chooser = player1(ctx, sel.chooser ?? chooserOverride ?? "self");
      const ids = ask(ctx.run, { player: chooser, kind: "pokemon", options: cands.map((p) => p.iid), min: lo, max: hi, prompt: "choose Pokémon" });
      return ids.map((i) => byIid(s, i));
    }
  }
}

// ------------------------------------------------------------------ card selection
interface Picked { owner: PlayerId; ids: string[] }
function selectCards(ctx: Ctx, sel: CardSel, owner: PlayerId, upTo: boolean): Picked {
  const s = S(ctx);
  const ps = s.players[owner];
  let ids: string[];
  if (sel.zone === "attached") {
    const hosts = sel.from ? selectPokemon(ctx, sel.from) : inPlay(ps);
    ids = hosts.flatMap((h) => h.energy);
  } else ids = zoneArr(ps, sel.zone).slice();
  let { min, max } = countRange(ctx, sel.count);
  if (upTo) min = 0;
  if (sel.zone === "deck" && sel.position === "top" && max !== Infinity) ids = ids.slice(0, max);
  if (sel.zone === "deck" && sel.position === "bottom" && max !== Infinity) ids = ids.slice(-max);
  ids = ids.filter((c) => cardMatches(c, sel.filter));
  if (min === Infinity) return { owner, ids };
  const n = ids.length;
  const lo = Math.min(min, n), hi = Math.min(max, n);
  if (sel.random || (sel.zone === "deck" && sel.position && sel.position !== "any")) {
    const picked = sel.random ? shuffle(ids.slice(), s.rng).slice(0, hi) : ids.slice(0, hi);
    return { owner, ids: picked };
  }
  const chooser = player1(ctx, sel.chooser ?? "self");
  const picks = ask(ctx.run, { player: chooser, kind: "cards", options: ids, min: lo, max: hi, prompt: `choose cards from ${sel.zone}` });
  if (sel.reveal && picks.length) log(s, `P${chooser} reveals ${picks.map((p) => defOf(p).name).join(", ")}`);
  return { owner, ids: picks };
}
function detach(s: GameState, ids: string[]): void {
  for (const ps of s.players) for (const p of inPlay(ps)) {
    p.energy = p.energy.filter((e) => !ids.includes(e));
    if (p.tool && ids.includes(p.tool)) p.tool = undefined;
  }
}
function removeCards(s: GameState, owner: PlayerId, zone: Zone, ids: string[]): void {
  if (zone === "attached") { detach(s, ids); return; }
  const arr = zoneArr(s.players[owner], zone);
  for (const id of ids) removeItem(arr, id);
}
function addToBench(s: GameState, pl: PlayerId, iid: string): PokemonInPlay | null {
  const ps = s.players[pl];
  if (ps.bench.length >= s.rules.benchSize) return null;
  const p = newPokemon(iid, s.turn);
  ps.bench.push(p);
  return p;
}
function placeCards(run: Run, owner: PlayerId, to: Zone, ids: string[], pos?: "top" | "bottom" | "shuffle"): void {
  const s = run.s;
  const ps = s.players[owner];
  switch (to) {
    case "hand": ps.hand.push(...ids); break;
    case "discard": ps.discard.push(...ids); break;
    case "lostzone": ps.lostZone.push(...ids); break;
    case "deck":
      if (pos === "bottom") ps.deck.push(...ids); else ps.deck.unshift(...ids);
      if (pos === "shuffle") shuffle(ps.deck, s.rng);
      break;
    case "bench":
      for (const id of ids) {
        const p = addToBench(s, owner, id);
        if (!p) ps.discard.push(id); else { log(s, `P${owner} puts ${defOf(id).name} onto the Bench`); fireOnBenched(run, p, owner, false); }
      }
      break;
    default: throw new Error(`cannot place cards into ${to}`);
  }
}

// ------------------------------------------------------------------ damage
export interface DmgOpts { attacker?: PokemonInPlay; wr: boolean; /** damage done by an attack (static damage prevention applies) */ byAttack?: boolean; /** skip all defender-side effects (Shred) */ ignoreEffects?: boolean }
/** Apply damage to a Pokémon: weakness/resistance (if wr), prevention & reduction markers. Returns damage dealt. */
export function applyDamage(s: GameState, target: PokemonInPlay, amount: number, o: DmgOpts): number {
  if (amount <= 0) return 0;
  let d = amount;
  if (o.wr) d = weaknessResistance(o.attacker, target, d);
  if (!o.ignoreEffects) {
    if (hasMarker(target.markers, "preventDamage") || (o.byAttack && staticPreventsDamage(s, target))) return 0;
    d += markerSum(target.markers, "mod:damageTaken") + staticStat(s, target, "damageTaken");
  }
  d = Math.max(0, d);
  target.damage += d;
  return d;
}

// ------------------------------------------------------------------ durations / markers
function expiry(s: GameState, d: Duration): number | undefined | "now" {
  switch (d) {
    case "now": return "now";
    case "thisTurn": return s.turn;
    case "oppNextTurn": case "untilEndOfNextOppTurn": return s.turn + 1;
    case "yourNextTurn": return s.turn + 2;
    case "whileInPlay": return undefined;
  }
}
/** An attack's effects on an opposing Pokémon that has "prevent all effects of attacks" (Dunsparce Dig) are ignored. */
const shielded = (ctx: Ctx, p: PokemonInPlay): boolean =>
  ctx.kind === "attack" && !ctx.ignoreDefEffects && hasMarker(p.markers, "preventEffects") && findPokemon(S(ctx), p.iid)?.player !== ctx.player;
function mark(ctx: Ctx, who: Selector, key: string, d: Duration, value?: number, againstFilter?: CardFilter): void {
  const e = expiry(S(ctx), d);
  if (e === "now") return;
  for (const p of selectPokemon(ctx, who)) {
    if (shielded(ctx, p)) continue;
    const m: Marker = { key, value, expiresAfterTurn: e, ...(againstFilter ? { againstFilter } : {}) };
    p.markers.push(m);
  }
}

// ------------------------------------------------------------------ effects
export function runEffect(ctx: Ctx, e: Effect): void {
  const s = S(ctx);
  switch (e.e) {
    case "noop": if (ctx.kind === "attack") ctx.cancelled = true; return;
    case "seq": for (const st of e.steps) runEffect(ctx, st); return;
    case "if": if (evalCond(ctx, e.cond)) runEffect(ctx, e.then); else if (e.else) runEffect(ctx, e.else); return;
    case "optional": {
      const [a] = ask(ctx.run, { player: ctx.player, kind: "yesno", options: ["yes", "no"], min: 1, max: 1, prompt: "do it?" });
      ctx.didPrev = a === "yes";
      if (ctx.didPrev) { runEffect(ctx, e.do); ctx.didPrev = true; if (e.then) runEffect(ctx, e.then); }
      return;
    }
    case "repeat": { const n = evalAmount(ctx, e.times); for (let i = 0; i < n; i++) runEffect(ctx, e.do); return; }
    case "choose": {
      const k = e.n ?? 1;
      const idx = ask(ctx.run, { player: ctx.player, kind: "option", options: e.options.map((_, i) => String(i)), min: k, max: k, prompt: "choose one" });
      for (const i of idx) runEffect(ctx, e.options[Number(i)]!);
      return;
    }
    case "bind": ctx.binds[e.as] = selectPokemon(ctx, e.sel).map((p) => p.iid); runEffect(ctx, e.then); return;
    case "forEach": {
      for (const p of selectPokemon(ctx, e.over)) { ctx.binds[e.bind] = [p.iid]; runEffect(ctx, e.do); }
      return;
    }
    case "cost": runEffect(ctx, e.pay); runEffect(ctx, e.then); return;

    case "damage": {
      const amt = evalAmount(ctx, e.amount);
      const attacker = ctx.self && findPokemon(s, ctx.self) ? byIid(s, ctx.self) : undefined;
      for (const t of selectPokemon(ctx, e.to)) {
        const loc = findPokemon(s, t.iid)!;
        const isDefActive = loc.player !== ctx.player && loc.where === "active";
        if (ctx.kind === "attack" && isDefActive && e.weakRes !== false) { ctx.dmg = (ctx.dmg ?? 0) + amt; if (e.effects === false) ctx.ignoreDefEffects = true; }
        else {
          const dealt = applyDamage(s, t, amt, { attacker, wr: e.weakRes === true && isDefActive, byAttack: ctx.kind === "attack", ignoreEffects: e.effects === false });
          if (ctx.kind === "attack") fireOnDamaged(ctx.run, attacker, t, dealt);
        }
      }
      return;
    }
    case "damageMod": ctx.mods += evalAmount(ctx, e.amount); return;
    case "selfDamage": { const p = ctx.self ? findPokemon(s, ctx.self)?.p : undefined; if (p) applyDamage(s, p, evalAmount(ctx, e.amount), { wr: false }); return; }
    case "heal":
      for (const t of selectPokemon(ctx, e.to)) if (!hasMarker(t.markers, "noHeal")) t.damage = Math.max(0, t.damage - evalAmount(ctx, e.amount));
      return;
    case "counters": {
      const n = evalAmount(ctx, e.n);
      const targets = selectPokemon(ctx, e.to).filter((t) => e.remove || !shielded(ctx, t));
      if (!targets.length) return;
      if (e.remove) { for (const t of targets) t.damage = Math.max(0, t.damage - n * 10); return; }
      if (!e.distribute || targets.length === 1) { for (const t of targets) t.damage += n * 10; return; }
      if (!(n > 0) || n === Infinity) return;
      const picks = ask(ctx.run, { player: ctx.player, kind: "distribute", options: targets.map((t) => t.iid), min: n, max: n, prompt: `distribute ${n} damage counters` });
      for (const pk of picks) { const [id, c] = pk.split("="); byIid(s, id!).damage += Number(c) * 10; }
      return;
    }
    case "moveCounters": {
      const [from] = selectPokemon(ctx, e.from);
      const [to] = selectPokemon(ctx, e.to);
      if (!from || !to || from === to) { ctx.didPrev = false; return; }
      const { min, max } = countRange(ctx, e.n);
      const hi = Math.min(max, from.damage / 10), lo = Math.min(min, hi);
      const opts: string[] = [];
      for (let k = lo; k <= hi; k++) opts.push(String(k));
      const [pick] = ask(ctx.run, { player: ctx.player, kind: "option", options: opts, min: 1, max: 1, prompt: "damage counters to move" });
      const k = Number(pick ?? 0);
      from.damage -= k * 10; to.damage += k * 10;
      ctx.didPrev = k > 0;
      log(s, `${k} damage counter(s) moved from ${topDef(from).name} to ${topDef(to).name}`);
      return;
    }
    case "searchSplit": {
      for (const pl of players(ctx, e.player)) {
        const ps = s.players[pl];
        const arr = zoneArr(ps, e.zone ?? "deck");
        const cands = arr.filter((c) => cardMatches(c, e.filter));
        const key = (c: string) => (e.distinct === "name" ? defOf(c).name : (defOf(c).types ?? []).join(""));
        const picked: string[] = [];
        for (let i = 0; i < e.upTo; i++) {
          const opts = cands.filter((c) => !picked.includes(c) && (!e.distinct || !picked.some((q) => key(q) === key(c))));
          if (!opts.length) break;
          const [c] = ask(ctx.run, { player: ctx.player, kind: "cards", options: opts, min: 0, max: 1, prompt: "search" });
          if (!c) break;
          picked.push(c);
        }
        for (const c of picked) removeItem(arr, c);
        if (picked.length) log(s, `P${pl} reveals ${picked.map((c) => defOf(c).name).join(", ")}`);
        let toHand = picked, toAttach: string[] = [];
        if (picked.length === 2) {
          const [h] = ask(ctx.run, { player: ctx.player, kind: "cards", options: picked, min: 1, max: 1, prompt: "put into your hand (the other is attached)" });
          toHand = [h!]; toAttach = picked.filter((c) => c !== h);
        }
        ps.hand.push(...toHand);
        if (toAttach.length) {
          const [target] = selectPokemon(ctx, e.b.attachTo);
          if (target) target.energy.push(...toAttach); else ps.hand.push(...toAttach);
        }
        if (e.shuffle !== false) shuffle(ps.deck, s.rng);
        ctx.didPrev = picked.length > 0;
      }
      return;
    }
    case "knockOut": for (const t of selectPokemon(ctx, e.who)) t.damage = Math.max(t.damage, maxHp(s, t)); return;

    case "flip": {
      if (e.n === undefined) { if (coin(s)) { if (e.heads) runEffect(ctx, e.heads); } else if (e.tails) runEffect(ctx, e.tails); return; }
      const n = evalAmount(ctx, e.n);
      for (let i = 0; i < n; i++) {
        const h = coin(s);
        if (e.each) runEffect(ctx, e.each);
        if (h && e.heads) runEffect(ctx, e.heads);
        if (!h && e.tails) runEffect(ctx, e.tails);
      }
      return;
    }
    case "status":
      for (const t of selectPokemon(ctx, e.to)) {
        if (findPokemon(s, t.iid)?.where !== "active" || hasMarker(t.markers, "noStatus") || hasMarker(t.markers, "preventEffects")) continue;
        if (e.status === "asleep" || e.status === "paralyzed" || e.status === "confused") { t.status.asleep = t.status.paralyzed = t.status.confused = false; }
        t.status[statusKey(e.status)] = true;
        log(s, `${topDef(t).name} is now ${e.status}`);
      }
      return;
    case "clearStatus": for (const t of selectPokemon(ctx, e.to)) clearStatuses(t); return;

    case "draw": {
      for (const pl of players(ctx, e.player)) {
        const n = e.untilHand !== undefined ? Math.max(0, evalAmount(ctx, e.untilHand) - s.players[pl].hand.length) : evalAmount(ctx, e.n);
        const k = drawCards(s, pl, n);
        log(s, `P${pl} draws ${k}`);
        ctx.didPrev = k > 0;
      }
      return;
    }
    case "shuffle": for (const pl of players(ctx, e.player)) shuffle(zoneArr(s.players[pl], e.zone), s.rng); return;
    case "search": {
      for (const pl of players(ctx, e.player)) {
        let sel: CardSel = { ...e.sel, player: "self" };
        if (e.to === "bench") { // can't put more cards onto the Bench than there is room for
          const free = Math.max(0, s.rules.benchSize - s.players[pl].bench.length);
          if (countRange(ctx, sel.count).max > free) sel = { ...sel, count: { k: "upTo", n: free } };
        }
        const { ids } = selectCards(ctx, sel, pl, true);
        removeCards(s, pl, e.sel.zone, ids);
        if (e.to === "attached") throw new Error("search→attached: use attachEnergy");
        placeCards(ctx.run, pl, e.to, ids);
        if (e.shuffle) shuffle(s.players[pl].deck, s.rng);
        log(s, `P${pl} searches ${e.sel.zone}: ${ids.length ? ids.map((i) => defOf(i).name).join(", ") : "nothing"}`);
        ctx.didPrev = ids.length > 0;
      }
      return;
    }
    case "discard": {
      for (const pl of players(ctx, e.sel.player)) {
        const { ids } = selectCards(ctx, e.sel, pl, false);
        removeCards(s, pl, e.sel.zone, ids);
        s.players[pl].discard.push(...ids);
        ctx.discarded = ids.length; ctx.didPrev = ids.length > 0;
        log(s, `P${pl} discards ${ids.length} from ${e.sel.zone}`);
      }
      return;
    }
    case "move": {
      if (e.sel.zone === "play" || e.sel.zone === "active" || e.sel.zone === "bench") {
        // move whole in-play Pokémon stacks (Pokémon + evolutions + Energy + Tool) to another zone
        const pokes = e.sel.from ? selectPokemon(ctx, e.sel.from) : selectPokemon(ctx, { s: "pick", player: e.sel.player, where: e.sel.zone, filter: e.sel.filter, count: e.sel.count, chooser: e.sel.chooser });
        for (const p of pokes) {
          const loc = findPokemon(s, p.iid);
          if (!loc) continue;
          const ps = s.players[loc.player];
          if (ps.active === p) ps.active = null; else removeItem(ps.bench, p);
          const cards = allCardsOf(p);
          if (e.shuffleFirst) shuffle(cards, s.rng);
          log(s, `P${loc.player} moves ${topDef(p).name} and ${cards.length - 1} attached/stacked card(s) to ${e.to}`);
          placeCards(ctx.run, loc.player, e.to, cards, e.position);
          ctx.didPrev = true;
        }
        return;
      }
      for (const pl of players(ctx, e.sel.player)) {
        const { ids } = selectCards(ctx, e.sel, pl, false);
        removeCards(s, pl, e.sel.zone, ids);
        if (e.shuffleFirst) shuffle(ids, s.rng);
        placeCards(ctx.run, pl, e.to, ids, e.position);
        ctx.didPrev = ids.length > 0;
      }
      return;
    }
    case "look": {
      for (const pl of players(ctx, e.player)) {
        const ps = s.players[pl];
        const n = evalAmount(ctx, e.n);
        const top = zoneArr(ps, e.zone).slice(0, n);
        const take = e.take === undefined ? 0 : evalAmount(ctx, e.take);
        const taken = ask(ctx.run, { player: ctx.player, kind: "cards", options: top, min: Math.min(take, top.length), max: Math.min(take, top.length), prompt: "take cards" });
        for (const t of taken) removeItem(zoneArr(ps, e.zone), t);
        ps.hand.push(...taken);
        const rest = top.filter((t) => !taken.includes(t));
        if (e.rest === "discard") { for (const r of rest) removeItem(zoneArr(ps, e.zone), r); ps.discard.push(...rest); }
        else if (e.rest === "bottom") { for (const r of rest) removeItem(ps.deck, r); ps.deck.push(...rest); }
      }
      return;
    }
    case "reveal": {
      for (const pl of players(ctx, e.player)) {
        const { ids } = selectCards(ctx, e.sel, pl, true);
        log(s, `P${pl} reveals ${ids.map((i) => defOf(i).name).join(", ")}`);
      }
      return;
    }
    case "attachEnergy": {
      const owner = ctx.player;
      const { ids } = selectCards(ctx, e.sel, owner, false); // exact counts are mandatory ("Attach a Basic Energy card"); `upTo` counts stay optional
      if (!ids.length) { ctx.didPrev = false; return; }
      const [target] = selectPokemon(ctx, e.to);
      if (!target) return;
      removeCards(s, owner, e.sel.zone, ids);
      target.energy.push(...ids);
      if (e.sel.zone === "deck") shuffle(s.players[owner].deck, s.rng);
      log(s, `P${owner} attaches ${ids.length} energy to ${topDef(target).name}`);
      ctx.didPrev = true;
      return;
    }
    case "moveEnergy": {
      const [from] = selectPokemon(ctx, e.from);
      const [to] = selectPokemon(ctx, e.to);
      if (!from || !to) return;
      const opts = from.energy.filter((c) => cardMatches(c, e.filter));
      const { min, max } = countRange(ctx, e.count);
      const picks = ask(ctx.run, { player: ctx.player, kind: "cards", options: opts, min: Math.min(min, opts.length), max: Math.min(max, opts.length), prompt: "move energy" });
      from.energy = from.energy.filter((c) => !picks.includes(c));
      to.energy.push(...picks);
      return;
    }
    case "putOnBench": {
      const { ids } = selectCards(ctx, e.sel, ctx.player, true);
      removeCards(s, ctx.player, e.sel.zone, ids);
      for (const id of ids) if (isBasicPokemon(defOf(id))) {
        const p = addToBench(s, ctx.player, id);
        if (!p) s.players[ctx.player].discard.push(id); else { log(s, `P${ctx.player} puts ${defOf(id).name} onto the Bench`); fireOnBenched(ctx.run, p, ctx.player, false); }
      }
      if (e.sel.zone === "deck") shuffle(s.players[ctx.player].deck, s.rng);
      return;
    }
    case "returnToHand": {
      for (const t of selectPokemon(ctx, e.who)) {
        const loc = findPokemon(s, t.iid)!;
        const ps = s.players[loc.player];
        if (ps.active === t) ps.active = null; else removeItem(ps.bench, t);
        ps.hand.push(t.iid, ...t.below);
        if (e.withAttached) ps.hand.push(...t.energy, ...(t.tool ? [t.tool] : [])); else ps.discard.push(...t.energy, ...(t.tool ? [t.tool] : []));
      }
      return;
    }
    case "switch": {
      for (const pl of players(ctx, e.player)) {
        const ps = s.players[pl];
        if (!ps.active || !ps.bench.length) continue;
        const [t] = selectPokemon(ctx, e.whichBench, e.chooser);
        if (!t || !ps.bench.includes(t)) continue;
        log(s, `P${pl} switches ${topDef(ps.active).name} for ${topDef(t).name}`);
        swapActive(s, pl, t.iid);
      }
      return;
    }
    case "retreatCost": mark(ctx, e.who, "mod:retreat", e.duration, e.delta); return;
    case "lock": {
      const l = e.what, d = e.duration;
      switch (l.l) {
        case "attack": mark(ctx, l.who, l.attackName ? `noAttack:${l.attackName}` : "noAttack", d); return;
        case "retreat": mark(ctx, l.who, "noRetreat", d); return;
        case "attackTry": mark(ctx, l.who, "attackTry", d); return;
        case "heal": mark(ctx, l.who, "noHeal", d); return;
        case "status": mark(ctx, l.who, "noStatus", d); return;
        case "play": {
          const x = expiry(s, d);
          if (x === "now") return;
          const kind = l.filter.subtype?.[0] ?? "item";
          for (const pl of players(ctx, l.player)) s.players[pl].markers.push({ key: `noPlay:${kind}`, expiresAfterTurn: x });
          return;
        }
        case "ability": {
          const x = expiry(s, d);
          if (x === "now") return;
          for (const ps of s.players) ps.markers.push({ key: "noAbility", expiresAfterTurn: x });
          return;
        }
      }
      return;
    }
    case "prevent":
      if (e.from === "damage" || e.from === "both") mark(ctx, e.who, "preventDamage", e.duration);
      if (e.from === "effects" || e.from === "both") mark(ctx, e.who, "preventEffects", e.duration);
      return;
    case "modify": {
      if (e.stat === "hp" || e.stat === "retreat" || e.stat === "damageDealt" || e.stat === "damageTaken") {
        if (typeof e.value === "string") return notImplemented(e);
        mark(ctx, e.who, `mod:${e.stat}`, e.duration, evalAmount(ctx, e.value), e.stat === "damageDealt" ? e.againstFilter : undefined);
        return;
      }
      return notImplemented(e);
    }
    case "tag": {
      mark(ctx, { s: "self" }, `tag:${e.key}`, e.duration);
      const x = expiry(s, e.duration);
      if (x !== "now") s.players[ctx.player].markers.push({ key: `tag:${e.key}`, expiresAfterTurn: x });
      return;
    }
    case "copyAttack": {
      if (ctx.copying) return; // a copied attack cannot itself copy
      const [src] = selectPokemon(ctx, e.from, undefined, e.filter);
      if (!src) return;
      const atks = (topDef(src).attacks ?? []).map((a, i) => ({ a, i })).filter(({ a }) => !JSON.stringify(a.effect ?? null).includes('"copyAttack"'));
      if (!atks.length) return;
      const [pick] = ask(ctx.run, { player: ctx.player, kind: "option", options: atks.map(({ i }) => String(i)), min: 1, max: 1, prompt: `choose an attack of ${topDef(src).name} to use` });
      const a = topDef(src).attacks![Number(pick)]!;
      log(s, `copies ${topDef(src).name}'s ${a.name}`);
      ctx.copying = true;
      ctx.dmg = a.damage && a.damage > 0 ? a.damage : null;
      if (a.effect) runEffect(ctx, a.effect);
      ctx.copying = false;
      return;
    }
    case "endTurn": ctx.endTurn = true; return;
    case "evolve": case "useAgain": return notImplemented(e);
  }
}

// ------------------------------------------------------------------ triggers
/** Run every rule of `rules` whose trigger satisfies `match`, as `owner`, hosted by `host` (Pokémon or its attached Tool). */
function runRules(run: Run, owner: PlayerId, host: PokemonInPlay | undefined, rules: Entry[] | undefined, match: (t: Trigger) => boolean, binds: Record<string, string[]>): void {
  for (const en of rules ?? []) {
    if (!match(en.trigger)) continue;
    const ctx = newCtx(run, owner, "other", { self: host?.iid, attached: host?.iid });
    Object.assign(ctx.binds, binds);
    runEffect(ctx, en.effect);
  }
}
/** Every rule-holder on the board: each Pokémon's card, its Tool, and the Stadium. */
function holders(s: GameState): Array<{ owner: PlayerId; host?: PokemonInPlay; rules: Entry[] | undefined }> {
  const out: Array<{ owner: PlayerId; host?: PokemonInPlay; rules: Entry[] | undefined }> = [];
  for (const pl of [0, 1] as PlayerId[]) for (const p of inPlay(s.players[pl])) {
    out.push({ owner: pl, host: p, rules: topDef(p).rules });
    if (p.tool) out.push({ owner: pl, host: p, rules: defOf(p.tool).rules });
  }
  if (s.stadium) out.push({ owner: s.stadium.owner, rules: defOf(s.stadium.iid).rules });
  return out;
}
const whoseOk = (whose: PlayerRef, s: GameState, srcOwner: PlayerId, actor: PlayerId): boolean =>
  whose === "both" ? true : whose === "self" ? srcOwner === actor : whose === "opp" ? srcOwner !== actor : actor === s.activePlayer;

/** A Pokémon was placed on a Bench. `fromHand`: played from hand (onPlayToBench fromHand entries on that card); onPutOnBench rules of
 *  all holders fire for any placement made during the placing player's own turn. Supplies ref `benched`. */
export function fireOnBenched(run: Run, benched: PokemonInPlay, owner: PlayerId, fromHand: boolean): void {
  const s = run.s;
  const binds = { benched: [benched.iid] };
  const here = () => !!findPokemon(s, benched.iid);
  // an Ability-like own trigger: silenced by Ability locks
  if (here() && !abilityLocked(s, benched)) runRules(run, owner, benched, topDef(benched).rules, (t) => t.t === "onPlayToBench" && t.fromHand === fromHand, binds);
  if (owner !== s.activePlayer) return; // "during their turn"
  for (const h of holders(s)) {
    if (!here()) return;
    runRules(run, h.owner, h.host, h.rules,
      (t) => t.t === "onPutOnBench" && whoseOk(t.whose, s, h.owner, owner) && matchesFilter(topDef(benched), t.filter, pokemonFacts(benched)), binds);
  }
}
/** After an opponent's attack damaged `target` (dealt > 0): fire its (and its Tool's) onDamaged rules. Supplies ref `attacker`. */
export function fireOnDamaged(run: Run, attacker: PokemonInPlay | undefined, target: PokemonInPlay, dealt: number): void {
  const s = run.s;
  const loc = findPokemon(s, target.iid);
  if (dealt <= 0 || !attacker || !loc) return;
  const aloc = findPokemon(s, attacker.iid);
  if (!aloc || aloc.player === loc.player) return;
  const ko = target.damage >= maxHp(s, target);
  const rules = [topDef(target).rules, target.tool ? defOf(target.tool).rules : undefined];
  for (const r of rules)
    runRules(run, loc.player, target, r, (t) => t.t === "onDamaged" && (!t.active || loc.where === "active") && (t.evenIfKO || !ko), { attacker: [attacker.iid] });
}
export function fireOnKnockedOut(run: Run, owner: PlayerId, p: PokemonInPlay): void {
  const s = run.s;
  const byAttack = owner !== s.activePlayer && !!run.attackKOs?.includes(p.iid);
  const att = s.players[s.activePlayer].active;
  const binds: Record<string, string[]> = byAttack && att ? { attacker: [att.iid] } : {};
  for (const r of [topDef(p).rules, p.tool ? defOf(p.tool).rules : undefined])
    runRules(run, owner, p, r, (t) => t.t === "onKnockedOut" && (!t.byAttack || byAttack), binds);
}
export function fireOnEvolve(run: Run, owner: PlayerId, p: PokemonInPlay): void {
  runRules(run, owner, p, topDef(p).rules, (t) => t.t === "onEvolve", {});
}
/** End of the active player's turn: rules with `endOfTurn` (whose = relative to the rule owner). */
export function fireEndOfTurn(run: Run): void {
  const s = run.s;
  for (const h of holders(s))
    runRules(run, h.owner, h.host, h.rules, (t) => t.t === "endOfTurn" && (t.whose === "self" ? h.owner === s.activePlayer : t.whose === "opp" ? h.owner !== s.activePlayer : true), {});
}
