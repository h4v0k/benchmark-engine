// Known-answer decision tests for the Dragapult ex setup turns (see docs/DECISIONS.md). Each position is built by hand and played for one
// whole turn by BOTH pilots (greedy, and search with the fast preset and a fixed seed); the assertions are what any Dragapult player agrees on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decider, legalActions, type Action } from "../actions.js";
import { greedyAgent } from "../agents/greedy.js";
import type { Agent } from "../agents/random.js";
import { FAST_SEARCH, searchAgent } from "../agents/search.js";
import { CARD_DEFS, DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../cards/standard/index.js";
import { defIdOf, defOf, registerCards } from "../cards/model.js";
import { applyAction, createGame } from "../game.js";
import { makeRng } from "../rng.js";
import { mintCard, newPokemon, topDef, type GameState, type PlayerId, type PokemonInPlay } from "../state.js";

registerCards(Object.values(CARD_DEFS)); // Rare Candy is not in either stock list
const DREEPY = "sv6-128", DRAKLOAK = "sv6-129", DRAGAPULT = "sv6-130", MUNKIDORI = "sv6-95", BUDEW = "me2pt5-16";
const RARE_CANDY = "me1-125", CRISPIN = "sv7-133", LILLIES = "me1-119", BOSS = "me1-114", HAMMER = "me3-71", POKE_PAD = "me3-81";
const FIRE = "basic-r", PSYCHIC = "basic-p", DARK = "basic-d", ZORUA = "sv9-97", ZOROARK = "sv9-98";

const PILOTS: Array<[string, () => Agent]> = [["greedy", () => greedyAgent], ["search:fast", () => searchAgent(FAST_SEARCH)]];

interface Spec {
  active: [string, string[]?]; bench?: Array<[string, string[]?]>; hand: string[]; deck?: string[]; deckSize?: number;
  oppActive?: [string, number?]; oppBench?: Array<[string, number?]>; attached?: boolean; secondPlayer?: boolean;
}
/** P0 (the Dragapult ex player, first player) on its own turn 2 (game turn 3). The deck holds Fire/Psychic/Darkness Energy plus filler. */
function position(sp: Spec): GameState {
  let s = createGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, 11);
  while (s.firstPlayer !== 0) s = createGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, s.seed + 1);
  for (let g = 0; s.phase !== "main"; g++) { assert.ok(g < 200); const a = legalActions(s, decider(s)!); s = applyAction(s, s.pendingChoice ? a[a.length - 1]! : a[0]!); }
  s.turn = sp.secondPlayer ? 4 : 3; s.activePlayer = 0; if (sp.secondPlayer) s.firstPlayer = 1; // own turn 2 either way
  const mon = (id: string, en: string[] = [], dmg = 0): PokemonInPlay => { const p = newPokemon(mintCard(s, id), 0); for (const e of en) p.energy.push(mintCard(s, e)); p.damage = dmg; return p; };
  const p0 = s.players[0], p1 = s.players[1];
  p0.flags = { ...p0.flags, energyAttachedThisTurn: sp.attached ?? false, supporterPlayedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false };
  p0.active = mon(...sp.active); p0.bench = (sp.bench ?? []).map((b) => mon(...b));
  p0.hand = sp.hand.map((c) => mintCard(s, c));
  // the top 6 cards are Items, so Recon Directive / Lillie's-free positions do not hand out Energy by luck
  const filler = [HAMMER, HAMMER, HAMMER, HAMMER, POKE_PAD, POKE_PAD, FIRE, FIRE, FIRE, PSYCHIC, PSYCHIC, PSYCHIC, DARK, DARK, HAMMER, HAMMER, POKE_PAD, POKE_PAD, HAMMER, HAMMER];
  p0.deck = (sp.deck ?? filler).slice(0, sp.deckSize ?? 99).map((c) => mintCard(s, c));
  const [oa, od] = sp.oppActive ?? [ZOROARK, 0];
  p1.active = mon(oa, [], od ?? 0); p1.bench = (sp.oppBench ?? [[ZORUA, 0]]).map(([id, d]) => mon(id, [], d ?? 0)); p1.hand = []; p1.flags = { ...p1.flags };
  p1.deck = p1.deck.slice(0, 20);
  return s;
}
interface Turn { log: string[]; s: GameState; supporters: string[] }
/** Let `agent` play P0's whole turn; the log names every action (supporters/items by card name). */
function playTurn(agent: Agent, s0: GameState): Turn {
  let s = s0; const rng = makeRng(5), log: string[] = [], supporters: string[] = [];
  for (let g = 0; s.phase !== "over" && s.turn === s0.turn; g++) {
    assert.ok(g < 60, "turn did not end");
    const pl = decider(s)!; assert.equal(pl, 0);
    const a: Action = agent(s, rng);
    if (a.type === "playSupporter") supporters.push(defOf(a.card).name);
    log.push(a.type === "playSupporter" || a.type === "playItem" || a.type === "evolve" || a.type === "attachEnergy" ? `${a.type}:${defOf(a.card).name}` : a.type);
    s = applyAction(s, a);
  }
  return { log, s, supporters };
}
const lineOf = (s: GameState): PokemonInPlay[] => [s.players[0].active!, ...s.players[0].bench].filter((p) => /^(Dreepy|Drakloak|Dragapult ex)$/.test(topDef(p).name));
const energyTypes = (p: PokemonInPlay): string => p.energy.map((e) => defIdOf(e)).sort().join(",");
const byName = (s: GameState, n: string): PokemonInPlay[] => [s.players[0].active!, ...s.players[0].bench].filter((p) => topDef(p).name === n);
const fmt = (who: string, t: Turn): string => `${who}: ${t.log.join(" > ")}`;
/** Every position is played with the hand in three orders (as listed, reversed, rotated): the right play must not depend on card order. */
const handOrders = (hand: string[]): string[][] => [hand, [...hand].reverse(), [...hand.slice(2), ...hand.slice(0, 2)]];
function each(who: string, mk: () => Agent, sp: Spec, check: (t: Turn, why: string) => void): void {
  for (const hand of handOrders(sp.hand)) { const t = playTurn(mk(), position({ ...sp, hand })); check(t, `${fmt(who, t)} [hand ${hand.join(",")}]`); }
}

for (const [who, mk] of PILOTS) {
  test(`decision a [${who}]: own turn 2, no KO anywhere: evolve, Crispin (not Boss, not Lillie's), all Energy onto the Dragapult line`, () => {
    each(who, mk, { active: [DREEPY, [PSYCHIC]], bench: [[BUDEW], [MUNKIDORI]], hand: [DRAKLOAK, CRISPIN, BOSS, LILLIES] }, (t, why) => {
      assert.deepEqual(t.supporters, ["Crispin"], why);
      assert.ok(t.log.includes("evolve:Drakloak"), why);
      const [drak] = byName(t.s, "Drakloak");
      assert.ok(drak, why);
      assert.ok(drak.energy.length >= 2, `${why}; Drakloak holds ${energyTypes(drak)}`);
      assert.ok(drak.energy.some((e) => defIdOf(e) === FIRE) && drak.energy.some((e) => defIdOf(e) === PSYCHIC), why);
      // Crispin's attach and the Energy it fetched went to the line first (a spare Energy after R+P may go to the next attacker)
      assert.ok(!t.log.slice(0, t.log.indexOf("playSupporter:Crispin")).includes("attachEnergy:Darkness Energy"), why);
    });
  });

  test(`decision b [${who}]: a Boss's Orders that KOs a benched Pokémon this turn is played (the rule is "no Boss without a KO")`, () => {
    each(who, mk, { active: [DRAKLOAK, [FIRE, PSYCHIC]], bench: [[BUDEW]], hand: [LILLIES, CRISPIN, BOSS], oppActive: [ZOROARK, 0], oppBench: [[ZORUA, 0]] }, (t, why) => {
      assert.deepEqual(t.supporters, ["Boss's Orders"], why);
      assert.equal(t.s.players[0].prizes.length, 5, `${why}; the gusted Zorua should be knocked out`);
    });
  });

  test(`decision c [${who}]: the turn's Energy goes to the benched Dreepy, not to the free-attacking Budew in the Active spot`, () => {
    each(who, mk, { active: [BUDEW], bench: [[DREEPY]], hand: [PSYCHIC] }, (t, why) => {
      assert.equal(byName(t.s, "Dreepy")[0]!.energy.length, 1, why);
      assert.equal(byName(t.s, "Budew")[0]!.energy.length, 0, why);
    });
  });

  test(`decision d [${who}]: Crispin's attach goes to the Drakloak that needs Fire for Phantom Dive, not to Munkidori`, () => {
    each(who, mk, { active: [BUDEW], bench: [[MUNKIDORI], [DRAKLOAK, [PSYCHIC]]], hand: [CRISPIN], attached: true }, (t, why) => {
      assert.deepEqual(t.supporters, ["Crispin"], why);
      const [drak] = byName(t.s, "Drakloak");
      assert.ok(drak!.energy.some((e) => defIdOf(e) === FIRE) && drak!.energy.some((e) => defIdOf(e) === PSYCHIC), `${why}; Drakloak holds ${energyTypes(drak!)}`);
      assert.equal(byName(t.s, "Munkidori")[0]!.energy.length, 0, why);
    });
  });

  test(`decision e1 [${who}]: line short of Energy, hand of 3: Crispin, not Lillie's Determination`, () => {
    each(who, mk, { active: [DREEPY, [PSYCHIC]], bench: [[BUDEW]], hand: [LILLIES, BOSS, CRISPIN] }, (t, why) => assert.deepEqual(t.supporters, ["Crispin"], why));
  });

  test(`decision e2 [${who}]: line already holds R+P and the hand is small: Lillie's Determination, not Crispin or Boss without a KO`, () => {
    each(who, mk, { active: [DRAKLOAK, [FIRE, PSYCHIC]], bench: [[BUDEW]], hand: [CRISPIN, LILLIES], oppActive: [ZOROARK, 0], oppBench: [[ZOROARK, 0]] }, (t, why) => assert.deepEqual(t.supporters, ["Lillie's Determination"], why));
  });

  test(`decision f [${who}]: deck-out guard: with 8 cards left and a small hand, Lillie's Determination is not played`, () => {
    each(who, mk, { active: [DRAKLOAK, [FIRE, PSYCHIC]], bench: [[BUDEW]], hand: [LILLIES, DREEPY, BOSS], deckSize: 8, oppActive: [ZOROARK, 0], oppBench: [[ZOROARK, 0]] }, (t, why) => assert.deepEqual(t.supporters, [], why));
  });
}

for (const [who, mk] of PILOTS) {
  test(`decision g [${who}]: own turn 2 going second, Dreepy (1 Energy) waited a turn, Dragapult ex + Rare Candy + Crispin: Candy, Crispin for the 2nd Energy, Phantom Dive`, () => {
    each(who, mk, { active: [DREEPY, [FIRE]], bench: [[BUDEW]], hand: [DRAGAPULT, RARE_CANDY, CRISPIN], secondPlayer: true, oppActive: [ZOROARK, 0], oppBench: [[ZORUA, 0]] }, (t, why) => {
      assert.ok(t.log.includes("playItem:Rare Candy"), why);
      assert.ok(t.log.indexOf("playItem:Rare Candy") < t.log.indexOf("playSupporter:Crispin"), `${why}; Candy first so Crispin's Energy lands on the Dragapult`);
      const [dp] = byName(t.s, "Dragapult ex");
      assert.ok(dp, why);
      assert.ok(dp.energy.some((e) => defIdOf(e) === FIRE) && dp.energy.some((e) => defIdOf(e) === PSYCHIC), `${why}; Dragapult holds ${energyTypes(dp)}`);
      assert.equal(t.log[t.log.length - 1], "attack", why);
      assert.ok(t.s.players[1].active!.damage >= 200 || t.s.players[1].prizes.length < 6 || t.s.players[0].prizes.length < 6, `${why}; Phantom Dive landed`);
    });
  });
}
