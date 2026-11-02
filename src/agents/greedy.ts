// Simple deterministic heuristic agent (no search, no randomness): develop the board, attach, draw when low, gust to KO, attack.
import { decider, legalActions, type Action } from "../actions.js";
import { defOf, hasSub, isEnergy, isPokemon } from "../cards/model.js";
import { canPay, maxHp, providedEnergy } from "../rules.js";
import { findPokemon, inPlay, other, topDef, type GameState, type PendingChoice, type PlayerId, type PokemonInPlay } from "../state.js";
import type { Agent } from "./random.js";

const DRAW_ABILITIES = new Set(["Trade", "Recon Directive", "Flip the Script", "Run Away Draw"]);
const LINE = /^(Dreepy|Drakloak|Dragapult ex|N's Zorua|N's Zoroark ex)$/;

const hpLeft = (s: GameState, p: PokemonInPlay): number => maxHp(s, p) - p.damage;
/** Estimated damage of `p`'s attack `atkIdx` against `t` (weakness x2 applied; effects other than the few damage-defining ones ignored). */
function dmgVs(s: GameState, p: PokemonInPlay, atkIdx: number, t: PokemonInPlay | null): number {
  const a = topDef(p).attacks?.[atkIdx];
  const owner = findPokemon(s, p.iid)?.player ?? 0;
  const self = (name: string | undefined): number => name === "Powerful Rage" ? (p.damage / 10) * 20 : name === "Irritated Outburst" ? (6 - s.players[other(owner)].prizes.length) * 60 : name === "Cruel Arrow" ? 100 : 0;
  let d = a?.damage ?? self(a?.name);
  if (a?.name === "Night Joker") d = Math.max(0, ...s.players[owner].bench.filter((b) => topDef(b).name.includes("N's")).flatMap((b) => (topDef(b).attacks ?? []).map((x) => x.damage ?? self(x.name))));
  const td = t ? topDef(t) : undefined;
  if (td?.weakness && topDef(p).types?.includes(td.weakness.type)) d *= td.weakness.multiplier;
  return d;
}
const affordable = (p: PokemonInPlay): number[] => (topDef(p).attacks ?? []).flatMap((a, i) => (canPay(a.cost, providedEnergy(p)) ? [i] : []));
const bestDmg = (s: GameState, p: PokemonInPlay, t: PokemonInPlay | null): number => Math.max(0, ...affordable(p).map((i) => dmgVs(s, p, i, t)));
/** Energy still missing for the cheapest attack if `extra` more Energy were attached (0 = can attack). */
function shortfall(p: PokemonInPlay, extra: string[] = []): number {
  const have = [...providedEnergy(p), ...extra.flatMap((e) => defOf(e).types ?? ["C"])];
  let best = 9;
  for (const a of topDef(p).attacks ?? []) {
    const pool = [...have]; let miss = 0;
    for (const c of a.cost) { const i = c === "C" ? -1 : pool.indexOf(c); if (i >= 0) pool.splice(i, 1); else if (c !== "C") miss++; }
    const colorless = a.cost.filter((c) => c === "C").length;
    miss += Math.max(0, colorless - pool.length);
    best = Math.min(best, miss);
  }
  return best;
}
const cardValue = (c: string): number => {
  const d = defOf(c);
  if (isPokemon(d)) return 50 + (hasSub(d, "stage2") ? 20 : hasSub(d, "stage1") ? 10 : 0) + (hasSub(d, "ex") ? 5 : 0) + (LINE.test(d.name) ? 5 : 0);
  if (isEnergy(d)) return 30;
  return hasSub(d, "supporter") ? 20 : hasSub(d, "item") ? 10 : 5;
};
const byValue = (ids: string[], desc: boolean): string[] => [...ids].sort((a, b) => (desc ? cardValue(b) - cardValue(a) : cardValue(a) - cardValue(b)) || (a < b ? -1 : 1));

function answerChoice(s: GameState, pc: PendingChoice): Action {
  const pl = pc.player, opts = pc.options;
  const pick = (ids: string[]): Action => ({ type: "choose", picks: ids });
  switch (pc.kind) {
    case "yesno": return pick(["yes"]);
    case "mulliganDraw": return pick([opts[opts.length - 1]!]);
    case "distribute": {
      const ts = opts.map((id) => findPokemon(s, id)!.p).sort((a, b) => hpLeft(s, a) - hpLeft(s, b));
      let left = pc.max; const out: string[] = [];
      for (const t of ts) { const k = Math.min(left, Math.max(1, Math.ceil(hpLeft(s, t) / 10))); if (k > 0 && left > 0) { out.push(`${t.iid}=${k}`); left -= k; } }
      if (left > 0) { out[0] = `${ts[0]!.iid}=${Number(out[0]!.split("=")[1]) + left}`; }
      return pick(out);
    }
    case "option": { // copied attack (Night Joker): the strongest of the named Pokémon's attacks; otherwise the highest option (most counters)
      const nm = pc.prompt.match(/^choose an attack of (.+) to use$/)?.[1];
      const src = nm ? s.players[pl].bench.find((b) => topDef(b).name === nm) : undefined;
      if (src) { const best = opts.map((o) => ({ o, d: dmgVs(s, src, Number(o), s.players[other(pl)].active) })).sort((x, y) => y.d - x.d)[0]!; return pick([best.o]); }
      return pick([opts[opts.length - 1]!]);
    }
    case "pokemon": {
      const ps = opts.map((id) => findPokemon(s, id)!);
      if (/promote/.test(pc.prompt)) return pick([ps.sort((a, b) => bestDmg(s, b.p, null) - bestDmg(s, a.p, null) || hpLeft(s, b.p) - hpLeft(s, a.p))[0]!.p.iid]);
      if (ps[0]!.player !== pl) { // an opposing target: KO-able first, then lowest HP left
        const me = s.players[pl].active; const dmg = me ? bestDmg(s, me, null) : 0;
        const key = (x: { p: PokemonInPlay }) => (hpLeft(s, x.p) <= dmg ? 0 : 1000) + hpLeft(s, x.p);
        return pick([ps.sort((a, b) => key(a) - key(b))[0]!.p.iid]);
      }
      const real = (q: PokemonInPlay) => Math.max(0, ...(topDef(q).attacks ?? []).filter((x) => x.name !== "Night Joker").map((x) => x.damage ?? 70)); // Night Joker can't copy itself
      return pick([ps.sort((a, b) => b.p.damage - a.p.damage || real(b.p) - real(a.p) || shortfall(a.p) - shortfall(b.p))[0]!.p.iid]); // own: most damaged / best copy source / closest to attacking
    }
    case "cards": {
      const discarding = /from hand/.test(pc.prompt) && !/take/.test(pc.prompt);
      const n = discarding ? pc.min : pc.max;
      return pick((discarding ? byValue(opts, false) : byValue(opts, true)).slice(0, n));
    }
  }
}

/** Does the Boss's-Orders-style gust pay off: some benched opposing Pokémon can be KO'd by our Active, and the current Defender can't. */
function gustWorthIt(s: GameState, pl: PlayerId): boolean {
  const me = s.players[pl].active, opp = s.players[other(pl)];
  if (!me || !opp.active || !opp.bench.length) return false;
  const best = (t: PokemonInPlay) => bestDmg(s, me, t);
  return best(opp.active) < hpLeft(s, opp.active) && opp.bench.some((b) => best(b) >= hpLeft(s, b) && best(b) > 0);
}

export const greedyAgent: Agent = (s) => {
  const pl = decider(s);
  if (pl === null) throw new Error("game over");
  if (s.pendingChoice) return answerChoice(s, s.pendingChoice);
  const acts = legalActions(s, pl);
  const first = <T extends Action["type"]>(t: T) => acts.filter((a) => a.type === t) as Array<Extract<Action, { type: T }>>;
  switch (s.phase) {
    case "mulliganAck": return { type: "mulliganAck" };
    case "setupActive": {
      const c = first("chooseActive").sort((a, b) => Number(LINE.test(defOf(b.card).name)) - Number(LINE.test(defOf(a.card).name)) || (defOf(b.card).hp ?? 0) - (defOf(a.card).hp ?? 0))[0]!;
      return c;
    }
    case "setupBench": {
      const ps = s.players[pl];
      const c = ps.bench.length < 3 ? first("chooseBench").find((a) => a.card && LINE.test(defOf(a.card).name)) ?? first("chooseBench").find((a) => a.card) : undefined;
      return c ?? { type: "chooseBench" };
    }
  }
  const ps = s.players[pl], opp = s.players[other(pl)], me = ps.active;
  const deck = ps.deck.length, hand = ps.hand.length;
  // 1. bench Basics (up to 3)
  if (ps.bench.length < 3) { const b = first("playBasicToBench"); const pref = b.find((a) => LINE.test(defOf(a.card).name)) ?? b[0]; if (pref) return pref; }
  // 2. evolve whenever legal (prefer the main lines)
  const ev = first("evolve").sort((a, b) => Number(LINE.test(defOf(b.card).name)) - Number(LINE.test(defOf(a.card).name)));
  if (ev[0]) return ev[0];
  // 3. attach Energy to whoever can attack soonest (active wins ties)
  const att = first("attachEnergy").map((a) => { const t = findPokemon(s, a.target)!.p; return { a, sf: shortfall(t, [a.card]), cur: shortfall(t), act: t === me }; })
    .filter((x) => x.sf < x.cur || x.cur > 0).sort((x, y) => x.sf - y.sf || Number(y.act) - Number(x.act));
  if (att[0]) return att[0].a;
  const tool = first("attachTool").find((a) => a.target === me?.iid && topDef(me!).types?.includes("D"));
  if (tool) return tool;
  // 4. abilities: draw ones only while hand < 5 and deck > 12; Adrena-Brain always
  for (const a of first("useAbility")) {
    const p = findPokemon(s, a.pokemon)!.p; const ab = topDef(p).abilities![a.abilityIndex]!;
    if (DRAW_ABILITIES.has(ab.name) ? hand < 5 && deck > 12 : ab.name === "Adrena-Brain") return a;
  }
  // 5. Supporters
  for (const a of first("playSupporter")) {
    const n = defOf(a.card).name;
    if (n === "Boss's Orders") { if (gustWorthIt(s, pl)) return a; }
    else if (n === "Lillie's Determination" || n === "Judge") { if (hand <= 3 && deck > 12) return a; }
    else if (n === "Black Belt's Training") { if (me && affordable(me).length) return a; }
    else return a;
  }
  // 6. Items / Stadium
  for (const a of first("playItem")) {
    const n = defOf(a.card).name;
    if (n === "Unfair Stamp" && !(hand <= 3 && deck > 12)) continue;
    if (n === "Special Red Card" || n === "Night Stretcher" && !ps.discard.some((c) => isPokemon(defOf(c)))) continue;
    return a;
  }
  const st = first("playStadium")[0];
  if (st && !s.stadium) return st;
  // 7. retreat if the Active can't attack but a benched Pokémon can
  if (me && !affordable(me).length) {
    const r = first("retreat").find((a) => { const b = findPokemon(s, a.newActive)!.p; return affordable(b).length > 0; });
    if (r) return r;
  }
  // 8. attack: a KO if possible, else the most damage
  const atks = first("attack");
  if (atks.length && me) {
    const d = opp.active;
    const score = (a: { attackIndex: number }) => { const dm = dmgVs(s, me, a.attackIndex, d); return (d && dm >= hpLeft(s, d) ? 1000 : 0) + dm; };
    return atks.sort((a, b) => score(b) - score(a))[0]!;
  }
  return { type: "endTurn" };
};
