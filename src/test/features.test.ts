// Milestone 2 part 2a: one focused test per interpreter/engine feature (synthetic cards where possible, real card defs where the feature IS the card def).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decider, type Action } from "../actions.js";
import { randomAgent } from "../agents/random.js";
import { CARD_DEFS } from "../cards/standard/index.js";
import { defOf, registerCards, validateDeck, type CardDef } from "../cards/model.js";
import { DEF, SELF, type Effect, type Entry } from "../dsl/types.js";
import { retreatCostOf } from "../rules.js";
import { makeRng } from "../rng.js";
import { mintCard, type GameState, type PlayerId } from "../state.js";
import { acts, addBench, applyAction, give, legalActions, mainState, mk, setActive } from "./helpers.js";
import { deckA, sparkbit } from "../cards/test-cards.js";

registerCards(Object.values(CARD_DEFS));

// ------------------------------------------------------------------ synthetic card helpers
const basic = (id: string, name: string, hp: number, type: CardDef["types"], extra: Partial<CardDef> = {}): CardDef =>
  ({ id, name, supertype: "Pokemon", subtypes: ["Basic"], hp, types: type, retreatCost: 0, ...extra });
const pickBench = (filter?: object) => ({ s: "pick" as const, player: "opp" as const, where: "bench" as const, count: 1, chooser: "self" as const, filter });
const playRule = (sup: "item" | "supporter", effect: Effect, extra: object = {}): Entry => ({ trigger: { t: "play", supertype: sup, ...extra }, effect });
const item = (id: string, name: string, rules: Entry[]): CardDef => ({ id, name, supertype: "Trainer", subtypes: ["Item"], rules });

const dummy = basic("dummy", "Dummy", 300, ["C"]);
const dummyEx = basic("dummy-ex", "Dummy ex", 300, ["C"], { subtypes: ["Basic", "ex"], prizeValue: 2 });
const darkling = basic("darkling", "Darkling", 120, ["D"]);
const fragile = basic("fragile", "Fragile", 30, ["C"]);
const weakToD = basic("weak-d", "WeakD", 300, ["C"], { weakness: { type: "D", multiplier: 2 } });
registerCards([dummy, dummyEx, darkling, fragile, weakToD]);

/** Apply the given pick lists, in order, to successive pending choices. */
function answer(s: GameState, ...answers: string[][]): GameState {
  for (const picks of answers) {
    assert.ok(s.pendingChoice, `expected a pending choice before picks ${JSON.stringify(picks)}`);
    s = applyAction(s, { type: "choose", picks });
  }
  return s;
}
const findAct = (s: GameState, pl: PlayerId, type: Action["type"], pred: (a: Action) => boolean = () => true) => {
  const a = acts(s, pl, type).find(pred);
  assert.ok(a, `no legal ${type}`);
  return a!;
};

// ------------------------------------------------------------------ 1. copyAttack
const mimicTarget = basic("ns-mimic", "N's Mimic", 100, ["P"], {
  attacks: [{ name: "Big Hit", cost: ["P", "P", "P"], damage: 50, effect: { e: "status", to: DEF, status: "confused" } }],
});
const nsLoop = basic("ns-loop", "N's Loop", 100, ["P"], {
  attacks: [{ name: "Echo", cost: [], damage: null, effect: { e: "copyAttack", from: pickBench({ nameIncludes: "N's" }) } }],
});
const joker = basic("joker", "Joker", 100, ["D"], {
  attacks: [{ name: "Night Joker", cost: ["L"], damage: null, effect: { e: "copyAttack", from: { s: "pick", player: "self", where: "bench", filter: { nameIncludes: "N's" }, count: 1, chooser: "self" } } }],
});
const mimicTarget2 = basic("ns-mimic2", "N's Mimic", 100, ["P"], { attacks: [{ name: "Jab", cost: [], damage: 30 }] });
registerCards([mimicTarget, mimicTarget2, nsLoop, joker]);

test("copyAttack: uses a benched N's Pokémon's attack for free, with damage/effects, weakness of the copier's type", () => {
  const s = mainState();
  setActive(s, 0, "joker", { energy: ["energy-l"] }); // no Psychic energy: copied cost is not paid
  addBench(s, 0, "ns-mimic");
  addBench(s, 0, "sparkbit"); // not an N's Pokémon: not selectable
  setActive(s, 1, "weak-d");
  const n = answer(applyAction(s, { type: "attack", attackIndex: 0 })); // single candidate + single attack: no choices needed
  assert.equal(n.players[1].active!.damage, 100, "50 doubled by Dark weakness (copier's type)");
  assert.ok(n.players[1].active!.status.confused, "copied effect applied");
});

test("copyAttack: player picks among several copyable N's Pokémon; Pokémon whose only attack is a copy attack are not offered", () => {
  const s = mainState();
  setActive(s, 0, "joker", { energy: ["energy-l"] });
  const a = addBench(s, 0, "ns-mimic"), b = addBench(s, 0, "ns-loop"), c = addBench(s, 0, "ns-mimic2");
  setActive(s, 1, "dummy");
  const p = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(p.pendingChoice!.kind, "pokemon");
  assert.deepEqual([...p.pendingChoice!.options].sort(), [a.iid, c.iid].sort(), "N's Loop (copy-only) is excluded from the sources");
  assert.ok(!p.pendingChoice!.options.includes(b.iid));
  const n = answer(p, [c.iid]);
  assert.equal(n.players[1].active!.damage, 30);
  assert.equal(n.activePlayer, 1);
});

test("copyAttack: if the only N's Pokémon on the Bench has nothing copyable, there is no choice and the attack does nothing", () => {
  const s = mainState();
  setActive(s, 0, "joker", { energy: ["energy-l"] });
  addBench(s, 0, "ns-loop");
  setActive(s, 1, "dummy");
  const n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.pendingChoice, undefined);
  assert.equal(n.players[1].active!.damage, 0);
  assert.equal(n.activePlayer, 1);
});

// ------------------------------------------------------------------ 2. triggers
const onBenchMon = basic("bench-draw", "BenchDraw", 60, ["C"], {
  rules: [{ trigger: { t: "onPlayToBench", fromHand: true }, effect: { e: "draw", player: "self", n: 2 } }],
});
const poffin = item("poffin2", "Mini Poffin", [playRule("item", { e: "putOnBench", sel: { player: "self", zone: "deck", filter: { name: "BenchDraw" }, count: 1 } })]);
registerCards([onBenchMon, poffin]);

test("onPlayToBench fires when played from hand, not when put onto the Bench by an effect", () => {
  const s = mainState();
  setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const c = give(s, 0, "bench-draw");
  const n = applyAction(s, { type: "playBasicToBench", card: c });
  assert.equal(n.players[0].hand.length, 2, "drew 2");
  const s2 = mainState();
  setActive(s2, 0, "dummy"); setActive(s2, 1, "dummy");
  s2.players[0].deck.unshift(mintCard(s2, "bench-draw"));
  const pc = give(s2, 0, "poffin2");
  const n2 = answer(applyAction(s2, { type: "playItem", card: pc }), [s2.players[0].deck[0]!]);
  assert.equal(n2.players[0].bench.length, 1);
  assert.equal(n2.players[0].hand.length, 0, "fromHand:true entry did not fire");
});

const darkBasic = basic("dark-basic", "DarkBasic", 100, ["D"]);
registerCards([darkBasic]);
test("onPutOnBench (Risky Ruins): fires for hand plays and effect placements, supplies `benched`, respects filter", () => {
  const s = mainState();
  setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  s.stadium = { iid: mintCard(s, "me1-127"), owner: 1 };
  const c = give(s, 0, "sparkbit"), d = give(s, 0, "dark-basic");
  let n = applyAction(s, { type: "playBasicToBench", card: c });
  assert.equal(n.players[0].bench[0]!.damage, 20, "non-Darkness Basic gets 2 counters");
  n = applyAction(n, { type: "playBasicToBench", card: d });
  assert.equal(n.players[0].bench[1]!.damage, 0, "Darkness Basic excluded by filter");
  // effect placement
  const s2 = mainState();
  setActive(s2, 0, "dummy"); setActive(s2, 1, "dummy");
  s2.stadium = { iid: mintCard(s2, "me1-127"), owner: 1 };
  s2.players[0].deck.unshift(mintCard(s2, "bench-draw"));
  const n2 = answer(applyAction(s2, { type: "playItem", card: give(s2, 0, "poffin2") }), [s2.players[0].deck[0]!]);
  assert.equal(n2.players[0].bench[0]!.damage, 20);
});

test("onDamaged (Punk Helmet): Active Darkness Pokémon damaged by an attack puts 4 counters on the attacker, even if KO'd", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] });
  setActive(s, 1, "darkling", { tool: "me2-92" });
  addBench(s, 1, "dummy");
  let n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[0].active!.damage, 40);
  assert.equal(n.players[1].active!.damage, 20);
  // evenIfKO
  const s2 = mainState();
  setActive(s2, 0, "sparkbit", { energy: ["energy-l"] });
  setActive(s2, 1, "darkling", { tool: "me2-92", damage: 110 });
  addBench(s2, 1, "dummy");
  n = applyAction(s2, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[0].active!.damage, 40, "counters placed although the holder was Knocked Out");
  assert.equal(n.players[1].discard.some((c) => defOf(c).name === "Darkling"), true);
});

const spiteMon = basic("spite", "Spite", 60, ["C"], {
  rules: [{ trigger: { t: "onKnockedOut", byAttack: true }, effect: { e: "counters", to: { s: "ref", id: "attacker" }, n: 3 } }],
});
registerCards([spiteMon]);
test("onKnockedOut (byAttack): fires when KO'd by an opponent's attack, not by Poison", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] });
  setActive(s, 1, "spite", { damage: 50 }); addBench(s, 1, "dummy");
  let n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[0].active!.damage, 30);
  const s2 = mainState();
  setActive(s2, 0, "sparkbit"); setActive(s2, 1, "spite", { damage: 50 }); addBench(s2, 1, "dummy");
  s2.players[1].active!.status.poisoned = true;
  n = applyAction(s2, { type: "endTurn" });
  assert.equal(n.players[1].discard.some((c) => defOf(c).name === "Spite"), true, "KO'd by poison checkup");
  assert.equal(n.players[0].active!.damage, 0, "no trigger");
});

const evoBase = basic("evo-base", "EvoBase", 60, ["C"]);
const evoUp = basic("evo-up", "EvoUp", 90, ["C"], { subtypes: ["Stage1"], evolvesFrom: "EvoBase", rules: [{ trigger: { t: "onEvolve" }, effect: { e: "draw", player: "self", n: 3 } }] });
registerCards([evoBase, evoUp]);
test("onEvolve fires when the Pokémon evolves from hand", () => {
  const s = mainState();
  const b = setActive(s, 0, "evo-base"); setActive(s, 1, "dummy");
  const c = give(s, 0, "evo-up");
  const n = applyAction(s, { type: "evolve", target: b.iid, card: c });
  assert.equal(n.players[0].hand.length, 3);
});

const tickSelf = basic("tick-self", "TickSelf", 100, ["C"], { rules: [{ trigger: { t: "endOfTurn", whose: "self" }, effect: { e: "counters", to: SELF, n: 1 } }] });
const tickOpp = basic("tick-opp", "TickOpp", 100, ["C"], { rules: [{ trigger: { t: "endOfTurn", whose: "opp" }, effect: { e: "counters", to: SELF, n: 1 } }] });
registerCards([tickSelf, tickOpp]);
test("endOfTurn: `self` fires at the owner's turn end, `opp` at the opponent's", () => {
  const s = mainState();
  setActive(s, 0, "tick-self"); setActive(s, 1, "tick-opp");
  let n = applyAction(s, { type: "endTurn" }); // P0's turn ends
  assert.equal(n.players[0].active!.damage, 10);
  assert.equal(n.players[1].active!.damage, 10, "tick-opp (P1) fires at the end of P0's turn");
  n = applyAction(n, { type: "endTurn" }); // P1's turn ends
  assert.equal(n.players[0].active!.damage, 10, "tick-self (P0) not triggered by P1's end of turn");
  assert.equal(n.players[1].active!.damage, 10);
});

// ------------------------------------------------------------------ 3. static effects
const sniper = basic("sniper2", "Sniper2", 100, ["L"], {
  attacks: [{ name: "Snipe", cost: [], damage: null, effect: { e: "damage", amount: 50, weakRes: false, to: pickBench() } }],
});
registerCards([sniper]);
test("static prevent (Dragapult ex Tera): no attack damage while Benched, but counters still land; damage applies when Active", () => {
  const s = mainState();
  setActive(s, 0, "sniper2"); setActive(s, 1, "dummy");
  const d = addBench(s, 1, "sv6-130");
  let n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].bench[0]!.damage, 0, "prevented");
  // active: the same Pokémon takes damage
  const s2 = mainState();
  setActive(s2, 0, "sparkbit", { energy: ["energy-l"] });
  setActive(s2, 1, "sv6-130");
  n = applyAction(s2, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].active!.damage, 20);
  assert.ok(d);
});

const nsWalker = basic("ns-walker", "N's Walker", 100, ["C"], { retreatCost: 3 });
const walker = basic("plain-walker", "Plain Walker", 100, ["C"], { retreatCost: 3 });
registerCards([nsWalker, walker]);
test("static retreatCost (N's Castle) is re-evaluated from state and stops when the Stadium leaves", () => {
  const s = mainState();
  const a = setActive(s, 0, "ns-walker"); addBench(s, 0, "dummy"); setActive(s, 1, "dummy");
  assert.equal(retreatCostOf(s, a), 3);
  s.stadium = { iid: mintCard(s, "sv9-152"), owner: 1 }; // opponent's Stadium also affects "both" players
  assert.equal(retreatCostOf(s, a), 0);
  assert.equal(acts(s, 0, "retreat").length, 1, "free retreat is legal without Energy");
  const w = setActive(s, 0, "plain-walker");
  assert.equal(retreatCostOf(s, w), 3, "non-N's Pokémon unaffected");
  s.stadium = undefined;
  assert.equal(retreatCostOf(s, a), 3, "no cached copy once the source is gone");
});

const colorlessAbility = basic("c-ability", "CAbility", 80, ["C"], { abilities: [{ name: "Draw One", trigger: { t: "ability", name: "Draw One" }, effect: { e: "draw", player: "self", n: 1 } }] });
const darkAbility = basic("d-ability", "DAbility", 80, ["D"], { abilities: [{ name: "Draw Two", trigger: { t: "ability", name: "Draw Two" }, effect: { e: "draw", player: "self", n: 1 } }] });
registerCards([colorlessAbility, darkAbility]);
test("static lock ability (Team Rocket's Watchtower): Colorless Pokémon lose Abilities only while the Stadium is in play", () => {
  const s = mainState();
  setActive(s, 0, "c-ability"); addBench(s, 0, "d-ability"); setActive(s, 1, "dummy");
  assert.equal(acts(s, 0, "useAbility").length, 2);
  s.stadium = { iid: mintCard(s, "sv10-180"), owner: 1 };
  const a = acts(s, 0, "useAbility");
  assert.equal(a.length, 1);
  assert.equal((a[0] as { pokemon: string }).pokemon, s.players[0].bench[0]!.iid);
  s.stadium = undefined;
  assert.equal(acts(s, 0, "useAbility").length, 2);
});

// ------------------------------------------------------------------ 4. Trainer requires / cost
test("Ultra Ball: needs 2 other cards; cost (discard 2) is paid via choice before the search", () => {
  const s = mainState();
  setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const ub = give(s, 0, "me1-131"), x = give(s, 0, "basic-r");
  assert.equal(acts(s, 0, "playItem").length, 0, "1 other card is not enough");
  const y = give(s, 0, "basic-p"), z = give(s, 0, "basic-d");
  s.players[0].deck.unshift(mintCard(s, "me2pt5-155"));
  assert.equal(acts(s, 0, "playItem").length, 1);
  let n = applyAction(s, { type: "playItem", card: ub });
  assert.equal(n.pendingChoice!.kind, "cards");
  assert.equal(n.pendingChoice!.min, 2);
  assert.equal(n.pendingChoice!.options.includes(ub), false, "cannot discard itself");
  n = answer(n, [x, y]);
  assert.equal(n.pendingChoice!.prompt.includes("deck"), true, "then the search");
  const target = n.pendingChoice!.options.find((c) => defOf(c).name === "N's Zekrom")!;
  n = answer(n, [target]);
  assert.deepEqual([...n.players[0].hand].sort(), [z, target].sort());
  assert.equal(n.players[0].discard.filter((c) => [x, y, ub].includes(c)).length, 3);
});

const payDraw = item("pay-draw", "Pay Draw", [playRule("item", { e: "draw", player: "self", n: 3 }, { cost: { e: "discard", sel: { player: "self", zone: "hand", count: 1, chooser: "self" } } })]);
registerCards([payDraw]);
test("play.cost (entry-level): illegal if it cannot be paid; paid via choice before the effect", () => {
  const s = mainState();
  setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const c = give(s, 0, "pay-draw");
  assert.equal(acts(s, 0, "playItem").length, 0, "no card to pay with");
  const a = give(s, 0, "basic-r"), b = give(s, 0, "basic-p");
  let n = applyAction(s, { type: "playItem", card: c });
  assert.equal(n.pendingChoice!.kind, "cards");
  assert.equal(n.players[0].hand.length, 2, "nothing drawn before the cost is paid");
  n = answer(n, [a]);
  assert.equal(n.players[0].hand.length, 1 + 3);
  assert.ok(n.players[0].discard.includes(a) && n.players[0].hand.includes(b));
});

test("Trainer `requires`: Rosa's Encouragement (more Prizes than opp), Special Red Card (opp <= 3 Prizes), Unfair Stamp (KO'd last turn)", () => {
  const s = mainState();
  setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  give(s, 0, "me3-84"); give(s, 0, "me4-82"); give(s, 0, "sv6-165");
  const fill = (pl: PlayerId, n: number) => { s.players[pl].prizes = Array.from({ length: n }, () => mintCard(s, "basic-r")); };
  fill(0, 4); fill(1, 4);
  assert.equal(acts(s, 0, "playSupporter").length, 0, "equal prizes");
  assert.equal(acts(s, 0, "playItem").length, 0);
  fill(0, 5); fill(1, 3);
  assert.equal(acts(s, 0, "playSupporter").length, 1, "Rosa's: more prizes remaining than opp");
  assert.equal(acts(s, 0, "playItem").length, 1, "Special Red Card: opp has <= 3");
  s.players[0].lastKOTurn = s.turn - 1;
  assert.equal(acts(s, 0, "playItem").length, 2, "Unfair Stamp now legal");
});

test("Unfair Stamp: KO tracked during opponent's last turn; both hands shuffle into decks; draws 5 / 2", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] }); setActive(s, 1, "dummy", { damage: 0 });
  s.players[0].active!.damage = 60; // P1's pokemon will KO it next turn
  addBench(s, 0, "dummy");
  setActive(s, 1, "sparkbit", { energy: ["energy-l"] });
  s.players[0].hand = []; s.players[1].hand = [];
  s.turn = 5; s.activePlayer = 0;
  let n = applyAction(s, { type: "endTurn" }); // -> P1's turn 6
  n.players[0].active!.damage = 60; // 70 hp mon at 60: Zap 20 KOs
  n = applyAction(n, { type: "attack", attackIndex: 0 });
  assert.equal(defOf(n.players[0].active!.iid).name, "Dummy", "lone Bench Pokémon promoted automatically");
  assert.equal(n.players[0].lastKOTurn, 6);
  assert.equal(n.activePlayer, 0);
  const stamp = give(n, 0, "sv6-165");
  give(n, 0, "basic-r"); give(n, 1, "basic-p"); give(n, 1, "basic-p"); give(n, 1, "basic-d");
  const total = (st: GameState) => [0, 1].map((p) => st.players[p]!.deck.length + st.players[p]!.hand.length);
  const before = total(n);
  const after = applyAction(n, { type: "playItem", card: stamp });
  assert.equal(after.players[0].hand.length, 5);
  assert.equal(after.players[1].hand.length, 2);
  assert.equal(total(after)[0]! + 1, before[0]!, "only the stamp left deck+hand");
  assert.equal(total(after)[1], before[1]);
});

test("Special Red Card: opponent's hand is shuffled to the bottom of the deck, then they draw 3", () => {
  const s = mainState();
  setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  s.players[1].prizes = Array.from({ length: 2 }, () => mintCard(s, "basic-r"));
  const hand = [give(s, 1, "basic-r"), give(s, 1, "basic-p"), give(s, 1, "basic-d")];
  const c = give(s, 0, "me4-82");
  const deckLen = s.players[1].deck.length;
  const n = applyAction(s, { type: "playItem", card: c });
  assert.equal(n.players[1].hand.length, 3);
  assert.equal(n.players[1].deck.length, deckLen);
  assert.deepEqual(n.players[1].deck.slice(-3).sort(), hand.sort());
});

// ------------------------------------------------------------------ 5. ability costToUse / oncePerNamePerTurn
test("Ability costToUse (N's Zoroark ex Trade): needs a card to discard; discard is chosen first, then draw 2", () => {
  const s = mainState();
  const z = setActive(s, 0, "sv9-98"); setActive(s, 1, "dummy");
  assert.equal(acts(s, 0, "useAbility").length, 0, "empty hand: cost cannot be paid");
  const a = give(s, 0, "basic-r"), b = give(s, 0, "basic-p");
  assert.equal(acts(s, 0, "useAbility").length, 1);
  let n = applyAction(s, { type: "useAbility", pokemon: z.iid, abilityIndex: 0 });
  assert.equal(n.pendingChoice!.kind, "cards");
  assert.equal(n.players[0].hand.length, 2, "not drawn yet");
  n = answer(n, [a]);
  assert.equal(n.players[0].hand.length, 1 + 2);
  assert.ok(n.players[0].discard.includes(a) && n.players[0].hand.includes(b));
  assert.equal(acts(n, 0, "useAbility").length, 0, "once per turn");
});

const namedAb = (id: string, abName: string, limit: "oncePerTurn" | "oncePerNamePerTurn") => basic(id, id, 80, ["P"], {
  abilities: [{ name: abName, limit: "oncePerTurn", trigger: { t: "ability", name: abName, limit }, effect: { e: "draw", player: "self", n: 1 } }],
});
registerCards([namedAb("na-1", "Shared Trick", "oncePerNamePerTurn"), namedAb("na-2", "Shared Trick", "oncePerNamePerTurn"), namedAb("na-3", "Other Trick", "oncePerNamePerTurn"),
  namedAb("pi-1", "Inst Trick", "oncePerTurn"), namedAb("pi-2", "Inst Trick", "oncePerTurn")]);
test("oncePerNamePerTurn: one use per ability NAME across Pokémon; oncePerTurn is per Pokémon; resets next turn", () => {
  const s = mainState();
  const a = setActive(s, 0, "na-1"); addBench(s, 0, "na-2"); addBench(s, 0, "na-3"); setActive(s, 1, "dummy");
  assert.equal(acts(s, 0, "useAbility").length, 3);
  let n = applyAction(s, { type: "useAbility", pokemon: a.iid, abilityIndex: 0 });
  const left = acts(n, 0, "useAbility") as Array<{ pokemon: string }>;
  assert.equal(left.length, 1, "same-named ability on the other Pokémon is blocked");
  assert.equal(left[0]!.pokemon, n.players[0].bench[1]!.iid, "differently named ability still usable");
  n = applyAction(applyAction(n, { type: "endTurn" }), { type: "endTurn" });
  assert.equal(acts(n, 0, "useAbility").length, 3, "reset on the next turn");
  const t = mainState();
  const p1 = setActive(t, 0, "pi-1"); addBench(t, 0, "pi-2"); setActive(t, 1, "dummy");
  const m = applyAction(t, { type: "useAbility", pokemon: p1.iid, abilityIndex: 0 });
  assert.equal(acts(m, 0, "useAbility").length, 1, "per-instance limit leaves the other copy usable");
});

test("Meowth ex Last-Ditch Catch: onPlayToBench ability, only 1 'Last-Ditch' ability per turn", () => {
  const s = mainState();
  setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const m1 = give(s, 0, "me3-62"), m2 = give(s, 0, "me3-62");
  s.players[0].deck.unshift(mintCard(s, "sv9-143"), mintCard(s, "sv8-170"));
  let n = applyAction(s, { type: "playBasicToBench", card: m1 });
  assert.equal(n.pendingChoice!.kind, "yesno");
  n = answer(n, ["yes"]);
  assert.equal(n.pendingChoice!.kind, "cards");
  n = answer(n, [n.pendingChoice!.options[0]!]);
  assert.equal(n.players[0].hand.filter((c) => defOf(c).supertype === "Trainer").length, 1);
  n = applyAction(n, { type: "playBasicToBench", card: m2 });
  assert.equal(n.pendingChoice, undefined, "second Last-Ditch use is blocked this turn");
});

// ------------------------------------------------------------------ 6. validateDeck
test("validateDeck: at most 1 ACE SPEC card; 4-copy rule and basic Energy exemption retained", () => {
  const stamp = CARD_DEFS["sv6-165"]!;
  const energies = Array.from({ length: 57 }, () => CARD_DEFS["basic-d"]!);
  assert.deepEqual(validateDeck([sparkbit, stamp, ...energies, sparkbit]), []);
  assert.ok(validateDeck([sparkbit, stamp, stamp, ...energies]).some((e) => /ACE SPEC/.test(e)));
  assert.ok(validateDeck([sparkbit, sparkbit, sparkbit, sparkbit, sparkbit, ...energies.slice(0, 55)]).some((e) => /5 copies of Sparkbit/.test(e)));
  assert.equal(validateDeck([...deckA]).length, 0);
});

// ------------------------------------------------------------------ 7. new DSL nodes
test("moveCounters (Munkidori Adrena-Brain): moves up to 3 counters; amount placed equals amount removed", () => {
  const s = mainState();
  const m = setActive(s, 0, "sv6-95", { energy: ["basic-d"] });
  addBench(s, 0, "dummy", { damage: 20 });
  setActive(s, 1, "dummy");
  let n = applyAction(s, { type: "useAbility", pokemon: m.iid, abilityIndex: 0 });
  n = answer(n, ["yes"]);
  assert.equal(n.pendingChoice!.kind, "option");
  assert.deepEqual(n.pendingChoice!.options, ["0", "1", "2"], "capped by counters available");
  n = answer(n, ["2"]);
  assert.equal(n.players[0].bench[0]!.damage, 0);
  assert.equal(n.players[1].active!.damage, 20);
  // 5 counters available: up to 3
  const t = mainState();
  const m2 = setActive(t, 0, "sv6-95", { energy: ["basic-d"], damage: 50 });
  setActive(t, 1, "dummy");
  let q = answer(applyAction(t, { type: "useAbility", pokemon: m2.iid, abilityIndex: 0 }), ["yes"]);
  assert.deepEqual(q.pendingChoice!.options, ["0", "1", "2", "3"]);
  q = answer(q, ["3"]);
  assert.equal(q.players[0].active!.damage, 20);
  assert.equal(q.players[1].active!.damage, 30);
});

test("searchSplit (Crispin): 2 Basic Energy of different types; one to hand, the other attached", () => {
  const s = mainState();
  const act = setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  s.players[0].deck = ["basic-r", "basic-r", "basic-p", "basic-d"].map((d) => mintCard(s, d));
  const [r1, r2, p1] = s.players[0].deck as [string, string, string];
  const c = give(s, 0, "sv7-133");
  let n = applyAction(s, { type: "playSupporter", card: c });
  assert.equal(n.pendingChoice!.options.length, 4);
  n = answer(n, [r1]);
  assert.equal(n.pendingChoice!.options.includes(r2), false, "same type excluded");
  assert.equal(n.pendingChoice!.options.length, 2);
  n = answer(n, [p1]);
  n = answer(n, [p1]); // p1 -> hand, r1 -> attached (only one Pokémon: target auto-chosen)
  assert.deepEqual(n.players[0].hand, [p1]);
  assert.deepEqual(n.players[0].active!.energy, [r1]);
  assert.equal(n.players[0].deck.length, 2);
  assert.ok(act);
});

test("modify.againstFilter (Black Belt's Training): +40 only against an ex, evaluated at damage time", () => {
  const mkState = (def: string) => {
    const s = mainState();
    setActive(s, 0, "sparkbit", { energy: ["energy-l"] });
    setActive(s, 1, def);
    const bb = give(s, 0, "sv9-143");
    return { s, bb };
  };
  let { s, bb } = mkState("dummy-ex");
  let n = applyAction(s, { type: "playSupporter", card: bb });
  n = applyAction(n, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].active!.damage, 60);
  ({ s, bb } = mkState("dummy"));
  n = applyAction(s, { type: "playSupporter", card: bb });
  n = applyAction(n, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].active!.damage, 20, "non-ex: no bonus");
  // Defender changes after the Supporter: the check follows the Pokémon actually damaged
  ({ s, bb } = mkState("dummy"));
  n = applyAction(s, { type: "playSupporter", card: bb });
  n.players[1].active = mk(n, "dummy-ex");
  n = applyAction(n, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].active!.damage, 60);
});

// ------------------------------------------------------------------ 8. verified behaviours
const shredder = basic("shredder", "Shredder", 100, ["D"], {
  attacks: [
    { name: "Shred", cost: [], damage: null, effect: { e: "damage", to: DEF, amount: 70, effects: false } },
    { name: "Plain", cost: [], damage: 70 },
  ],
});
registerCards([shredder]);
test("damage{effects:false} (N's Zekrom Shred): ignores defender prevention/reduction markers; weakness still applies", () => {
  const mkS = () => {
    const s = mainState();
    setActive(s, 0, "shredder");
    const d = setActive(s, 1, "weak-d");
    d.markers.push({ key: "preventDamage" });
    return s;
  };
  let n = applyAction(mkS(), { type: "attack", attackIndex: 1 });
  assert.equal(n.players[1].active!.damage, 0, "ordinary attack is prevented");
  n = applyAction(mkS(), { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].active!.damage, 140, "70 x2 weakness; prevention ignored");
});

test("move of an in-play Pokémon (Dudunsparce Run Away Draw): whole stack goes to the deck, bench slot cleaned up", () => {
  const s = mainState();
  setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const d = addBench(s, 0, "sv5-129", { energy: ["basic-r", "basic-p"], tool: "me2-92" });
  d.below.push(mintCard(s, "sv5-128"));
  const stack = [d.iid, ...d.below, ...d.energy, d.tool!];
  const deckLen = s.players[0].deck.length;
  let n = applyAction(s, { type: "useAbility", pokemon: d.iid, abilityIndex: 0 });
  n = answer(n, ["yes"]);
  assert.equal(n.players[0].bench.length, 0);
  assert.equal(n.players[0].deck.length, deckLen - 3 + stack.length);
  for (const c of stack) assert.ok(n.players[0].deck.includes(c), `${c} in deck`);
  assert.equal(n.players[0].hand.length, 3);
});

test("returnToHand withAttached returns the evolution stack too (Meowth ex Tuck Tail shape)", () => {
  registerCards([basic("tucker", "Tucker", 100, ["C"], { attacks: [{ name: "Tuck", cost: [], damage: null, effect: { e: "returnToHand", who: SELF, withAttached: true } }] })]);
  const s = mainState();
  const t = setActive(s, 0, "tucker", { energy: ["basic-r"] });
  t.below.push(mintCard(s, "dummy"));
  setActive(s, 1, "dummy"); addBench(s, 0, "dummy");
  let n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[0].hand.length, 3);
  n = n.pendingChoice ? answer(n, [n.pendingChoice.options[0]!]) : n;
  assert.ok(n.players[0].hand.length >= 3);
});

test("distribute choice (Phantom Dive): 6 counters split among Benched targets; Tera does not stop counters; KO from counters resolves", () => {
  const mkS = () => {
    const s = mainState();
    setActive(s, 0, "sv6-130", { energy: ["basic-r", "basic-p"] });
    setActive(s, 1, "dummy");
    const f = addBench(s, 1, "fragile"), t = addBench(s, 1, "sv6-130"), d = addBench(s, 1, "dummy");
    return { s, f, t, d };
  };
  const { s, f, t, d } = mkS();
  const p = applyAction(s, { type: "attack", attackIndex: 1 });
  const pc = p.pendingChoice!;
  assert.equal(pc.kind, "distribute");
  assert.equal(pc.max, 6);
  assert.deepEqual([...pc.options].sort(), [f.iid, t.iid, d.iid].sort());
  assert.equal(legalActions(p, 0).length, 28, "all compositions of 6 into 3 targets");
  assert.throws(() => applyAction(p, { type: "choose", picks: [`${f.iid}=5`] }), /invalid picks/);
  assert.throws(() => applyAction(p, { type: "choose", picks: [`${f.iid}=3`, `${f.iid}=3`] }), /invalid picks/);
  const n = answer(p, [`${f.iid}=3`, `${t.iid}=2`, `${d.iid}=1`]);
  assert.equal(n.players[1].bench.some((b) => b.iid === f.iid), false, "30 HP Pokémon Knocked Out by 3 counters");
  assert.equal(n.players[1].bench.find((b) => b.iid === t.iid)!.damage, 20, "Tera does not prevent counters");
  assert.equal(n.players[1].bench.find((b) => b.iid === d.iid)!.damage, 10);
  assert.equal(n.players[0].prizes.length, 5);
  assert.equal(n.players[1].active!.damage, 200);
  assert.equal(n.activePlayer, 1);
});

test("random agent assigns distribute choices randomly but validly", () => {
  const s = mainState();
  setActive(s, 0, "sv6-130", { energy: ["basic-r", "basic-p"] }); setActive(s, 1, "dummy");
  addBench(s, 1, "dummy"); addBench(s, 1, "dummy"); addBench(s, 1, "dummy");
  const p = applyAction(s, { type: "attack", attackIndex: 1 });
  const rng = makeRng(7);
  const shapes = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const a = randomAgent(p, rng);
    assert.equal(decider(p), 0);
    const n = applyAction(p, a);
    assert.equal(n.players[1].bench.reduce((t, b) => t + b.damage, 0), 60);
    shapes.add(JSON.stringify((a as { picks: string[] }).picks));
  }
  assert.ok(shapes.size > 3);
});
