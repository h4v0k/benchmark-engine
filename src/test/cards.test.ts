// Milestone 2 part 2b: one behaviour test per non-trivial real card in the two Standard decks. The printed `text` is the spec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Action } from "../actions.js";
import { CARD_DEFS, DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../cards/standard/index.js";
import { defOf, registerCards, type CardDef } from "../cards/model.js";
import { flip } from "../rng.js";
import { retreatCostOf } from "../rules.js";
import { abilityLocked } from "../statics.js";
import { mintCard, type GameState, type PlayerId } from "../state.js";
import { acts, addBench, applyAction, give, legalActions, mainState, mk, setActive } from "./helpers.js";

registerCards(Object.values(CARD_DEFS));

// ------------------------------------------------------------------ helpers
const id = (name: string): string => {
  const d = Object.values(CARD_DEFS).find((x) => x.name === name);
  if (!d) throw new Error(`no card ${name}`);
  return d.id;
};
const basic = (cid: string, name: string, hp: number, extra: Partial<CardDef> = {}): CardDef =>
  ({ id: cid, name, supertype: "Pokemon", subtypes: ["Basic"], hp, types: ["C"], retreatCost: 0, ...extra });
const dummy = basic("dummy", "Dummy", 300);
const dummyEx = basic("dummy-ex", "Dummy ex", 300, { subtypes: ["Basic", "ex"], prizeValue: 2 });
const fragile = basic("fragile", "Fragile", 30);
const weakD = basic("weak-d", "WeakD", 300, { weakness: { type: "D", multiplier: 2 } });
const weakDex = basic("weak-d-ex", "WeakD ex", 400, { subtypes: ["Basic", "ex"], prizeValue: 2, weakness: { type: "D", multiplier: 2 } });
registerCards([dummy, dummyEx, fragile, weakD, weakDex]);

function answer(s: GameState, ...answers: string[][]): GameState {
  for (const picks of answers) {
    assert.ok(s.pendingChoice, `expected a pending choice before picks ${JSON.stringify(picks)}`);
    s = applyAction(s, { type: "choose", picks });
  }
  return s;
}
const asP1 = (s: GameState): GameState => { s.turn = 6; s.activePlayer = 1; return s; };
const rigCoin = (s: GameState, heads: boolean): GameState => {
  for (let k = 1; ; k++) if (flip({ s: k }) === heads) { s.rng = { s: k }; return s; }
};
const deckOf = (s: GameState, pl: PlayerId, ...defs: string[]): string[] => (s.players[pl].deck = defs.map((d) => mintCard(s, d)));
const nameOf = (c: string): string => defOf(c).name;
const optNames = (s: GameState): string[] => s.pendingChoice!.options.map(nameOf).sort();
const energyOf = (...ids: string[]) => ids;
const play = (s: GameState, type: "playItem" | "playSupporter", card: string): GameState => applyAction(s, { type, card } as Action);
const attack = (s: GameState, idx: number): GameState => applyAction(s, { type: "attack", attackIndex: idx });
const ability = (s: GameState, pokemon: string, idx = 0): GameState => applyAction(s, { type: "useAbility", pokemon, abilityIndex: idx });
const R = "basic-r", P = "basic-p", D = "basic-d", L = "energy-l";

// ================================================================== Dragapult line
test("Dragapult ex Phantom Dive: 200 to the Active + 6 counters distributed across the opponent's Bench; KOs by counters give prizes", () => {
  const s = mainState();
  setActive(s, 0, id("Dragapult ex"), { energy: [R, P] });
  setActive(s, 1, "dummy");
  const [b1, b2, b3] = [addBench(s, 1, "dummy"), addBench(s, 1, "dummy"), addBench(s, 1, "fragile")];
  let n = attack(s, 1);
  assert.equal(n.pendingChoice!.kind, "distribute");
  assert.equal(n.pendingChoice!.max, 6);
  assert.deepEqual([...n.pendingChoice!.options].sort(), [b1.iid, b2.iid, b3.iid].sort(), "only Benched Pokémon are targets");
  n = answer(n, [`${b1.iid}=2`, `${b2.iid}=1`, `${b3.iid}=3`]);
  assert.equal(n.players[1].active!.damage, 200);
  assert.equal(n.players[1].bench.find((p) => p.iid === b1.iid)!.damage, 20);
  assert.equal(n.players[1].bench.find((p) => p.iid === b2.iid)!.damage, 10);
  assert.equal(n.players[1].bench.length, 2, "30-HP Pokémon Knocked Out by 3 counters");
  assert.equal(n.players[0].prizes.length, 5);
  // no Bench: just the 200
  const t = mainState();
  setActive(t, 0, id("Dragapult ex"), { energy: [R, P] });
  setActive(t, 1, "dummy");
  const q = attack(t, 1);
  assert.equal(q.pendingChoice, undefined);
  assert.equal(q.players[1].active!.damage, 200);
});

test("Dragapult ex Tera: no attack damage while Benched (any source), damage as Active, but damage counters still land", () => {
  const mkS = () => {
    const s = mainState();
    setActive(s, 0, "dummy");
    const dr = addBench(s, 0, id("Dragapult ex"));
    const fez = setActive(s, 1, id("Fezandipiti ex"), { energy: [R, R, R] });
    return { s: asP1(s), dr, fez };
  };
  let { s, dr } = mkS();
  let n = answer(attack(s, 0), [dr.iid]); // Cruel Arrow at the benched Dragapult
  assert.equal(n.players[0].bench[0]!.damage, 0, "Tera: prevented while Benched");
  ({ s, dr } = mkS());
  n = answer(attack(s, 0), [s.players[0].active!.iid]);
  assert.equal(n.players[0].active!.damage, 100, "control: other Pokémon take it");
  // Active Dragapult takes damage
  const a = mainState();
  setActive(a, 0, id("Dragapult ex")); addBench(a, 0, "dummy");
  setActive(a, 1, id("Fezandipiti ex"), { energy: [R, R, R] });
  asP1(a);
  assert.equal(answer(attack(a, 0), [a.players[0].active!.iid]).players[0].active!.damage, 100);
  // damage counters (Phantom Dive) are not damage from an attack's damage step: they still land on a Benched Tera Pokémon
  const c = mainState();
  setActive(c, 0, "dummy"); const bd = addBench(c, 0, id("Dragapult ex"));
  setActive(c, 1, id("Dragapult ex"), { energy: [R, P] });
  asP1(c);
  const q = attack(c, 1);
  assert.equal(q.players[0].bench[0]!.damage, 60, "all 6 counters on the only Bench target (auto-assigned)");
  assert.ok(bd);
});

test("Dragapult line: Dreepy → Drakloak → Dragapult ex evolution rules (not same turn, not first turns, no skipping), keeps damage and Energy", () => {
  const s = mainState();
  setActive(s, 0, "dummy");
  const dreepy = addBench(s, 0, id("Dreepy"), { turnPlayed: 5, energy: [R, P], damage: 30 }); // benched this turn
  setActive(s, 1, "dummy");
  give(s, 0, id("Drakloak")); const dr2 = give(s, 0, id("Dragapult ex"));
  assert.equal(acts(s, 0, "evolve").length, 0, "can't evolve a Pokémon the turn it was played");
  dreepy.turnPlayed = 3;
  assert.deepEqual(acts(s, 0, "evolve").map((a) => (a as { card: string }).card.split("#")[0]), [id("Drakloak")], "Dragapult ex can't skip Drakloak (no Rare Candy in either deck)");
  const drak = s.players[0].hand.find((c) => nameOf(c) === "Drakloak")!;
  let n = applyAction(s, { type: "evolve", target: dreepy.iid, card: drak });
  const evolved = n.players[0].bench[0]!;
  assert.equal(nameOf(evolved.iid), "Drakloak");
  assert.deepEqual(evolved.below.map(nameOf), ["Dreepy"]);
  assert.equal(evolved.damage, 30); assert.equal(evolved.energy.length, 2);
  assert.equal(acts(n, 0, "evolve").length, 0, "can't evolve again the same turn");
  n = applyAction(applyAction(n, { type: "endTurn" }), { type: "endTurn" });
  n = applyAction(n, { type: "evolve", target: evolved.iid, card: dr2 });
  const top = n.players[0].bench[0]!;
  assert.equal(nameOf(top.iid), "Dragapult ex");
  assert.deepEqual(top.below.map(nameOf), ["Dreepy", "Drakloak"]);
  // first turn of the game: no evolving
  const f = mainState(1, 2);
  setActive(f, 0, "dummy"); addBench(f, 0, id("Dreepy")); give(f, 0, id("Drakloak"));
  assert.equal(acts(f, 0, "evolve").length, 0);
  // whole stack goes to the discard pile when Knocked Out
  const k = mainState();
  const st = setActive(k, 0, id("Dragapult ex"), { energy: [R] }); st.below = [mintCard(k, id("Dreepy")), mintCard(k, id("Drakloak"))]; st.damage = 310;
  addBench(k, 0, "dummy");
  setActive(k, 1, id("N's Zekrom"), { energy: [R, R, R] });
  asP1(k);
  const out = attack(k, 0); // the lone Benched Pokémon is promoted automatically
  assert.equal(out.players[0].discard.length, 4, "Dragapult ex + Dreepy + Drakloak + Energy");
  assert.equal(out.players[1].prizes.length, 4, "ex gives 2 Prize cards");
  assert.ok(!Object.values(CARD_DEFS).some((d) => d.name === "Rare Candy"), "Rare Candy is not in the card pool");
});

test("Drakloak Recon Directive: look at top 2, exactly 1 to hand, the other to the bottom; once per turn", () => {
  const s = mainState();
  const dk = setActive(s, 0, id("Drakloak")); setActive(s, 1, "dummy");
  const [a, b, c, d] = deckOf(s, 0, R, P, D, R) as [string, string, string, string];
  let n = ability(s, dk.iid);
  assert.equal(n.pendingChoice!.min, 1, "must take 1 card");
  assert.deepEqual(n.pendingChoice!.options, [a, b]);
  n = answer(n, [b]);
  assert.deepEqual(n.players[0].hand, [b]);
  assert.deepEqual(n.players[0].deck, [c, d, a]);
  assert.equal(acts(n, 0, "useAbility").length, 0, "once during your turn");
  // 1-card deck: take it; empty deck: nothing happens
  const one = mainState(); const dk1 = setActive(one, 0, id("Drakloak")); setActive(one, 1, "dummy");
  const [only] = deckOf(one, 0, R) as [string];
  assert.deepEqual(ability(one, dk1.iid).players[0].hand, [only]);
});

test("Dunsparce Dig: heads prevents damage and effects of attacks next turn; tails does not", () => {
  const run = (heads: boolean) => {
    const s = mainState();
    setActive(s, 0, id("Dunsparce"), { energy: [R, R] }); addBench(s, 0, "dummy");
    setActive(s, 1, id("Yveltal"), { energy: [D] });
    let n = attack(rigCoin(s, heads), 1); // Dig
    assert.equal(n.players[1].active!.damage, 30, "Dig's own 30 damage");
    n = attack(n, 0); // opponent's Yveltal uses Clutch (20 + can't retreat)
    return n;
  };
  const h = run(true);
  assert.equal(h.players[0].active!.damage, 0, "damage prevented");
  assert.ok(acts(h, 0, "retreat").length > 0, "Clutch's effect prevented too");
  const t = run(false);
  assert.equal(t.players[0].active!.damage, 20);
  assert.equal(acts(t, 0, "retreat").length, 0, "Clutch locked the retreat");
});

test("Dudunsparce Run Away Draw: draw 3, then shuffle itself and everything attached into the deck; Active spot is re-promoted", () => {
  const s = mainState();
  const dd = setActive(s, 0, id("Dudunsparce"), { energy: [R] });
  dd.below = [mintCard(s, id("Dunsparce"))];
  const b = addBench(s, 0, "dummy"); setActive(s, 1, "dummy");
  const deck0 = s.players[0].deck.length;
  let n = answer(ability(s, dd.iid), ["yes"]);
  assert.equal(n.players[0].hand.length, 3);
  assert.equal(n.players[0].deck.length, deck0 - 3 + 3, "Dudunsparce + Dunsparce + Energy shuffled in");
  assert.ok(["Dudunsparce", "Dunsparce"].every((nm) => n.players[0].deck.some((c) => nameOf(c) === nm)));
  assert.equal(n.players[0].active!.iid, b.iid, "the Bench Pokémon was promoted");
  // declining does nothing; empty deck: nothing drawn so it stays in play
  const d = answer(ability(s, dd.iid), ["no"]);
  assert.equal(d.players[0].hand.length, 0); assert.equal(d.players[0].active!.iid, dd.iid);
  const e = mainState();
  const dd2 = setActive(e, 0, id("Dudunsparce")); addBench(e, 0, "dummy"); setActive(e, 1, "dummy");
  e.players[0].deck = [];
  const x = answer(ability(e, dd2.iid), ["yes"]);
  assert.equal(x.players[0].active!.iid, dd2.iid, "drew no cards: stays in play");
});

test("Moltres Fighting Wings: 20, +90 against an Active Pokémon ex", () => {
  const run = (def: string) => {
    const s = mainState(); setActive(s, 0, id("Moltres"), { energy: [R] }); setActive(s, 1, def);
    return attack(s, 0).players[1].active!.damage;
  };
  assert.equal(run("dummy-ex"), 110);
  assert.equal(run("dummy"), 20);
});

test("Fezandipiti ex Flip the Script: only after a KO last opponent turn, draw 3, 1 per turn by name", () => {
  const s = mainState();
  const f1 = setActive(s, 0, id("Fezandipiti ex")), f2 = addBench(s, 0, id("Fezandipiti ex")); setActive(s, 1, "dummy");
  assert.equal(acts(s, 0, "useAbility").length, 0, "no KO last turn");
  s.players[0].lastKOTurn = s.turn - 1;
  assert.equal(acts(s, 0, "useAbility").length, 2);
  let n = answer(ability(s, f1.iid), ["yes"]);
  assert.equal(n.players[0].hand.length, 3);
  assert.equal(acts(n, 0, "useAbility").length, 0, "the other Fezandipiti ex can't use a second Flip the Script");
  assert.ok(f2);
  const m = answer(ability(s, f1.iid), ["no"]);
  assert.equal(m.players[0].hand.length, 0);
  s.players[0].lastKOTurn = s.turn - 2; // an older KO doesn't count
  assert.equal(acts(s, 0, "useAbility").length, 0);
});

test("Fezandipiti ex Cruel Arrow: 100 to any Pokémon; no Weakness on a Benched target, Weakness applies to the Active (text)", () => {
  const mkS = () => {
    const s = mainState();
    setActive(s, 0, id("Fezandipiti ex"), { energy: [R, R, R] });
    const act = setActive(s, 1, "weak-d"), ben = addBench(s, 1, "weak-d");
    return { s, act, ben };
  };
  let { s, act, ben } = mkS();
  assert.equal(answer(attack(s, 0), [ben.iid]).players[1].bench[0]!.damage, 100);
  ({ s, act, ben } = mkS());
  assert.equal(answer(attack(s, 0), [act.iid]).players[1].active!.damage, 200, "Weakness applies to the Active Pokémon");
});

test("Pokémon ex rule: Knocked-Out ex gives 2 Prize cards (Fezandipiti ex)", () => {
  const s = mainState();
  setActive(s, 0, id("Fezandipiti ex"), { damage: 200 }); addBench(s, 0, "dummy");
  setActive(s, 1, id("N's Zekrom"), { energy: [R, R, R] });
  const n = attack(asP1(s), 0);
  assert.equal(n.players[1].prizes.length, 4);
});

// ================================================================== Dragapult Trainers
test("Crispin: up to 2 Basic Energy of different types — one to hand, the other attached", () => {
  const s = mainState();
  const act = setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const [r1, r2, p1] = deckOf(s, 0, R, R, P, "dummy") as [string, string, string, string];
  const c = give(s, 0, id("Crispin"));
  let n = play(s, "playSupporter", c);
  n = answer(n, [r1]);
  assert.deepEqual(n.pendingChoice!.options, [p1], "second pick must be a different type");
  n = answer(n, [p1]);
  n = answer(n, [r1]); // r1 goes to hand
  assert.deepEqual(n.players[0].hand, [r1]);
  assert.deepEqual(n.players[0].active!.energy, [p1]);
  assert.ok(n.players[0].deck.includes(r2) && n.players[0].discard.includes(c));
  assert.ok(act);
});

test("Rosa's Encouragement: only with more Prize cards remaining than the opponent; up to 2 Basic Energy from discard to a Stage 2", () => {
  const s = mainState();
  setActive(s, 0, id("Dreepy")); const dr = addBench(s, 0, id("Dragapult ex")); setActive(s, 1, "dummy");
  const c = give(s, 0, id("Rosa's Encouragement"));
  assert.equal(acts(s, 0, "playSupporter").length, 0, "equal Prizes: unplayable");
  s.players[1].prizes.pop();
  assert.equal(acts(s, 0, "playSupporter").length, 1);
  const e1 = mintCard(s, R), e2 = mintCard(s, P), e3 = mintCard(s, D), pk = mintCard(s, id("Dreepy"));
  s.players[0].discard = [e1, e2, e3, pk];
  let n = play(s, "playSupporter", c);
  assert.deepEqual(n.pendingChoice!.options.sort(), [e1, e2, e3].sort(), "Basic Energy only");
  n = answer(n, [e1, e3]);
  assert.deepEqual(n.players[0].bench[0]!.energy.sort(), [e1, e3].sort());
  assert.equal(n.players[0].active!.energy.length, 0, "not onto the non-Stage-2");
  assert.ok(dr);
});

test("Crushing Hammer: heads discards an Energy from a chosen opposing Pokémon with Energy; tails does nothing", () => {
  const mkS = (heads: boolean) => {
    const s = mainState(); setActive(s, 0, "dummy");
    const a = setActive(s, 1, "dummy"), b = addBench(s, 1, "dummy", { energy: [D, R] }); addBench(s, 1, "dummy");
    const h = give(s, 0, id("Crushing Hammer"));
    return { s: rigCoin(s, heads), a, b, h };
  };
  let { s, b, h } = mkS(true);
  let n = play(s, "playItem", h);
  assert.equal(n.pendingChoice!.options.length, 2, "only the Pokémon with Energy is a candidate (its 2 Energy cards are offered)");
  assert.ok(n.pendingChoice!.options.every((o) => b.energy.includes(o)));
  n = answer(n, [n.pendingChoice!.options[0]!]);
  assert.equal(n.players[1].bench[0]!.energy.length, 1);
  assert.equal(n.players[1].discard.length, 1);
  ({ s, h } = mkS(false));
  n = play(s, "playItem", h);
  assert.equal(n.pendingChoice, undefined);
  assert.equal(n.players[1].bench[0]!.energy.length, 2);
});

test("Risky Ruins: Basic non-Darkness Pokémon put on the Bench during their owner's turn get 2 counters (either player; hand or Poffin)", () => {
  const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  s.stadium = { iid: mintCard(s, id("Risky Ruins")), owner: 0 };
  const bu = give(s, 0, id("Budew")), fe = give(s, 0, id("Fezandipiti ex"));
  let n = applyAction(s, { type: "playBasicToBench", card: bu });
  assert.equal(n.players[0].bench[0]!.damage, 20);
  n = applyAction(n, { type: "playBasicToBench", card: fe });
  assert.equal(n.players[0].bench[1]!.damage, 0, "Darkness Pokémon exempt");
  // opponent's own turn
  const t = asP1(s);
  const dreepy = give(t, 1, id("Dreepy"));
  assert.equal(applyAction(t, { type: "playBasicToBench", card: dreepy }).players[1].bench[0]!.damage, 20);
  // via Buddy-Buddy Poffin
  const u = mainState(); setActive(u, 0, "dummy"); setActive(u, 1, "dummy");
  u.stadium = { iid: mintCard(u, id("Risky Ruins")), owner: 1 };
  const [d1, b1] = deckOf(u, 0, id("Dreepy"), id("Budew")) as [string, string];
  const pf = give(u, 0, id("Buddy-Buddy Poffin"));
  const q = answer(play(u, "playItem", pf), [d1, b1]);
  assert.deepEqual(q.players[0].bench.map((p) => p.damage), [20, 20]);
  // played the Stadium itself
  const v = mainState(); setActive(v, 0, "dummy"); setActive(v, 1, "dummy");
  const rr = give(v, 0, id("Risky Ruins"));
  assert.equal(applyAction(v, { type: "playStadium", card: rr }).stadium!.iid, rr);
});

// ================================================================== shared Pokémon
test("Munkidori Adrena-Brain: needs Darkness Energy on Munkidori itself; moves up to 3 counters to an opposing Pokémon (can KO)", () => {
  const s = mainState();
  const m = setActive(s, 0, id("Munkidori"), { energy: [P] });
  addBench(s, 0, "dummy", { damage: 40, energy: [D] }); setActive(s, 1, "dummy");
  assert.equal(acts(s, 0, "useAbility").length, 0, "Darkness Energy elsewhere doesn't count");
  m.energy.push(mintCard(s, D));
  assert.equal(acts(s, 0, "useAbility").length, 1);
  let n = answer(ability(s, m.iid), ["yes"]);
  n = answer(n, ["3"]);
  assert.equal(n.players[0].bench[0]!.damage, 10); assert.equal(n.players[1].active!.damage, 30);
  assert.equal(acts(n, 0, "useAbility").length, 0, "once per turn");
  // KO with moved counters
  const k = mainState();
  const m2 = setActive(k, 0, id("Munkidori"), { energy: [D], damage: 30 }); const fr = setActive(k, 1, "fragile"); addBench(k, 1, "dummy");
  const out = answer(ability(k, m2.iid), ["yes"], [fr.iid], ["3"]);
  assert.equal(nameOf(out.players[1].active!.iid), "Dummy", "Fragile was Knocked Out by the moved counters; the Bench Pokémon was promoted");
  assert.equal(out.players[0].prizes.length, 5);
});

test("Munkidori Mind Bend: 60 damage and Confused", () => {
  const s = mainState(); setActive(s, 0, id("Munkidori"), { energy: [P, R] }); setActive(s, 1, "dummy");
  const n = attack(s, 0);
  assert.equal(n.players[1].active!.damage, 60); assert.ok(n.players[1].active!.status.confused);
});

test("Budew Itchy Pollen: 10 damage; opponent can't play Items during their next turn only", () => {
  const s = mainState(); setActive(s, 0, id("Budew")); setActive(s, 1, "dummy");
  let n = attack(s, 0);
  assert.equal(n.players[1].active!.damage, 10);
  give(n, 1, id("Night Stretcher")); give(n, 1, id("Lillie's Determination")); n.players[1].discard.push(mintCard(n, R));
  assert.equal(acts(n, 1, "playItem").length, 0, "Items locked");
  assert.equal(acts(n, 1, "playSupporter").length, 1, "Supporters still fine");
  n = applyAction(applyAction(n, { type: "endTurn" }), { type: "endTurn" });
  n = applyAction(applyAction(n, { type: "endTurn" }), { type: "endTurn" });
  assert.equal(acts(n, 1, "playItem").length, 1, "lock expired");
});

test("Meowth ex Last-Ditch Catch: Supporter search when played to the Bench from hand (once per turn); Tuck Tail returns it with attachments", () => {
  const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const m1 = give(s, 0, id("Meowth ex")), m2 = give(s, 0, id("Meowth ex"));
  const sup = deckOf(s, 0, id("Dreepy"), id("Boss's Orders"), id("Ultra Ball"), id("Judge"))[1]!;
  let n = applyAction(s, { type: "playBasicToBench", card: m1 });
  n = answer(n, ["yes"]);
  assert.deepEqual(optNames(n), ["Boss's Orders", "Judge"], "Supporters only");
  n = answer(n, [sup]);
  assert.ok(n.players[0].hand.includes(sup));
  n = applyAction(n, { type: "playBasicToBench", card: m2 });
  assert.equal(n.pendingChoice, undefined, "second 'Last-Ditch' this turn is blocked");
  // Tuck Tail
  const t = mainState();
  setActive(t, 0, id("Meowth ex"), { energy: [R, R, R] }); addBench(t, 0, "dummy"); setActive(t, 1, "dummy");
  const q = attack(t, 0);
  assert.equal(q.players[1].active!.damage, 60);
  assert.equal(q.players[0].hand.filter((c) => nameOf(c) === "Meowth ex" || c.startsWith("basic-r")).length, 4, "Meowth + 3 Energy back in hand");
});

// ================================================================== shared Trainers
test("Lillie's Determination: shuffle hand into deck, draw 6 (8 with exactly 6 Prizes left)", () => {
  const run = (prizes: number) => {
    const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
    s.players[0].prizes = s.players[0].prizes.slice(0, prizes);
    const c = give(s, 0, id("Lillie's Determination")); give(s, 0, R); give(s, 0, P);
    const total = s.players[0].deck.length + 2;
    const n = play(s, "playSupporter", c);
    return { hand: n.players[0].hand.length, deck: n.players[0].deck.length, total };
  };
  const six = run(6), five = run(5);
  assert.equal(six.hand, 8); assert.equal(six.deck, six.total - 8);
  assert.equal(five.hand, 6); assert.equal(five.deck, five.total - 6);
});

test("Boss's Orders: switches in a chosen Benched opposing Pokémon; unplayable without a Bench target", () => {
  const s = mainState(); setActive(s, 0, "dummy"); const a = setActive(s, 1, "dummy");
  const c = give(s, 0, id("Boss's Orders"));
  assert.equal(acts(s, 0, "playSupporter").length, 0);
  const b1 = addBench(s, 1, "dummy"), b2 = addBench(s, 1, "fragile");
  const n = answer(play(s, "playSupporter", c), [b2.iid]);
  assert.equal(n.players[1].active!.iid, b2.iid);
  assert.deepEqual(n.players[1].bench.map((p) => p.iid).sort(), [a.iid, b1.iid].sort());
});

test("Judge: each player shuffles their hand into their deck and draws 4", () => {
  const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const c = give(s, 0, id("Judge")); give(s, 0, R); give(s, 1, R); give(s, 1, P); give(s, 1, D); give(s, 1, R); give(s, 1, R); give(s, 1, R);
  const total = [0, 1].map((p) => s.players[p]!.deck.length + s.players[p]!.hand.length);
  const n = play(s, "playSupporter", c);
  assert.deepEqual([n.players[0].hand.length, n.players[1].hand.length], [4, 4]);
  assert.deepEqual([0, 1].map((p) => n.players[p]!.deck.length + n.players[p]!.hand.length), [total[0]! - 1, total[1]]);
});

test("Buddy-Buddy Poffin: up to 2 Basic Pokémon with 70 HP or less onto the Bench; respects Bench space", () => {
  const mkS = (full: number) => {
    const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
    for (let i = 0; i < full; i++) addBench(s, 0, "dummy");
    const d = deckOf(s, 0, id("Munkidori"), id("Dreepy"), id("Fezandipiti ex"), id("Budew"), id("Drakloak"), id("Dreepy"));
    return { s, d, c: give(s, 0, id("Buddy-Buddy Poffin")) };
  };
  let { s, d, c } = mkS(0);
  let n = play(s, "playItem", c);
  assert.deepEqual(optNames(n), ["Budew", "Dreepy", "Dreepy"], "no Munkidori (110 HP), ex, or Stage 1");
  n = answer(n, [d[1]!, d[3]!]);
  assert.deepEqual(n.players[0].bench.map((p) => nameOf(p.iid)), ["Dreepy", "Budew"]);
  assert.ok(!n.players[0].deck.includes(d[1]!));
  ({ s, c } = mkS(4));
  n = play(s, "playItem", c);
  assert.equal(n.pendingChoice!.max, 1, "only 1 Bench space left");
});

test("Ultra Ball: discard 2 other cards as the cost, search any Pokémon; unplayable with fewer than 2 other cards", () => {
  const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const [dp, , ] = deckOf(s, 0, id("Dragapult ex"), R, P) as [string, string, string];
  const ub = give(s, 0, id("Ultra Ball")); const x = give(s, 0, R);
  assert.equal(acts(s, 0, "playItem").length, 0, "only 1 other card");
  const y = give(s, 0, P);
  let n = play(s, "playItem", ub);
  assert.deepEqual(n.players[0].discard.sort(), [x, y].sort(), "cost paid: the 2 other cards");
  assert.deepEqual(optNames(n), ["Dragapult ex"], "any Pokémon in the deck");
  n = answer(n, [dp]);
  assert.deepEqual(n.players[0].hand, [dp]);
  assert.ok(n.players[0].discard.includes(ub));
});

test("Night Stretcher: returns a Pokémon or a Basic Energy (not Trainers) from the discard pile", () => {
  const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const [a, b] = [mintCard(s, id("Dreepy")), mintCard(s, D)];
  s.players[0].discard = [a, b, mintCard(s, id("Boss's Orders")), mintCard(s, id("Ultra Ball"))];
  const ns = give(s, 0, id("Night Stretcher"));
  const n = answer(play(s, "playItem", ns), [b]);
  assert.deepEqual(n.players[0].hand, [b]);
  assert.deepEqual(optNames(play(s, "playItem", s.players[0].hand.find((c) => nameOf(c) === "Night Stretcher")!)), ["Darkness Energy", "Dreepy"]);
  assert.ok(a);
});

test("Poké Pad: only Pokémon without a Rule Box", () => {
  const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  deckOf(s, 0, id("Dragapult ex"), id("Fezandipiti ex"), id("Meowth ex"), id("Dreepy"), id("Munkidori"), R);
  const n = play(s, "playItem", give(s, 0, id("Poké Pad")));
  assert.deepEqual(optNames(n), ["Dreepy", "Munkidori"]);
});

test("Unfair Stamp: only if one of your Pokémon was Knocked Out during the opponent's last turn; shuffle hands, you draw 5, they draw 2", () => {
  const s = mainState();
  setActive(s, 0, "fragile"); addBench(s, 0, "dummy");
  setActive(s, 1, id("N's Zekrom"), { energy: [R, R, R] });
  const st = give(s, 0, id("Unfair Stamp")); give(s, 0, R);
  assert.equal(acts(s, 0, "playItem").length, 0);
  give(s, 1, P); give(s, 1, D);
  let n = attack(asP1(s), 0); // Shred KOs Fragile
  assert.equal(n.activePlayer, 0); // the lone Benched Pokémon was promoted automatically
  assert.equal(acts(n, 0, "playItem").length, 1, "KO'd last turn: playable");
  const p1deck = n.players[1].deck.length + n.players[1].hand.length;
  n = play(n, "playItem", st);
  assert.equal(n.players[0].hand.length, 5);
  assert.equal(n.players[1].hand.length, 2);
  assert.equal(n.players[1].deck.length + n.players[1].hand.length, p1deck);
  // two turns later the KO is stale
  let m = applyAction(applyAction(s, { type: "endTurn" }), { type: "endTurn" });
  give(m, 0, id("Unfair Stamp"));
  assert.equal(acts(m, 0, "playItem").length, 0);
  assert.ok(CARD_DEFS[id("Unfair Stamp")]!.subtypes.includes("AceSpec"));
});

// ================================================================== N's Zoroark deck
test("N's Zoroark ex Trade: discard 1 to draw 2, once per Zoroark (not name-limited), needs a card in hand", () => {
  const s = mainState();
  const z1 = setActive(s, 0, id("N's Zoroark ex")), z2 = addBench(s, 0, id("N's Zoroark ex")); setActive(s, 1, "dummy");
  assert.equal(acts(s, 0, "useAbility").length, 0, "empty hand: can't pay");
  const a = give(s, 0, R), b = give(s, 0, P);
  let n = answer(ability(s, z1.iid), [a]);
  assert.equal(n.players[0].hand.length, 1 + 2); assert.ok(n.players[0].discard.includes(a));
  const left = acts(n, 0, "useAbility") as Array<{ pokemon: string }>;
  assert.deepEqual(left.map((x) => x.pokemon), [z2.iid], "the other Zoroark ex can still Trade (card text has no name limit)");
  assert.ok(b);
});

test("N's Zorua evolves into N's Zoroark ex (not into a non-N's Pokémon)", () => {
  const s = mainState(); const z = addBench(s, 0, id("N's Zorua"), { turnPlayed: 1 }); setActive(s, 1, "dummy");
  const zk = give(s, 0, id("N's Zoroark ex"));
  assert.deepEqual(acts(s, 0, "evolve"), [{ type: "evolve", target: z.iid, card: zk }]);
});

test("N's Zoroark ex Night Joker: uses a Benched N's Pokémon's attack without its Energy; 'this Pokémon' is the Zoroark", () => {
  const s = mainState();
  setActive(s, 0, id("N's Zoroark ex"), { energy: [D, D], damage: 30 });
  addBench(s, 0, id("N's Reshiram")); addBench(s, 0, id("Yveltal")); setActive(s, 1, "dummy");
  let n = attack(s, 0);
  assert.deepEqual(n.pendingChoice!.options, ["0", "1"], "only N's Reshiram's attacks (Yveltal isn't an N's Pokémon)");
  n = answer(n, ["0"]); // Powerful Rage: 20 x counters on THIS Pokémon
  assert.equal(n.players[1].active!.damage, 60);
  // copying Rampaging Thunder
  const t = mainState();
  setActive(t, 0, id("N's Zoroark ex"), { energy: [D, D] }); addBench(t, 0, id("N's Zekrom")); setActive(t, 1, "dummy");
  const q = answer(attack(t, 0), ["1"]);
  assert.equal(q.players[1].active!.damage, 250);
  // no N's Pokémon on the Bench: nothing happens, no crash
  const u = mainState();
  setActive(u, 0, id("N's Zoroark ex"), { energy: [D, D] }); addBench(u, 0, id("N's Zoroark ex")); addBench(u, 0, id("Munkidori")); setActive(u, 1, "dummy");
  const w = attack(u, 0);
  assert.equal(w.players[1].active!.damage, 0);
});

test("N's Zekrom: Shred ignores effects on the Defending Pokémon; Rampaging Thunder 250 then can't attack next turn", () => {
  const mkS = () => {
    const s = mainState(); setActive(s, 0, id("N's Zekrom"), { energy: [R, L, L, D] });
    setActive(s, 1, "dummy").markers.push({ key: "preventDamage" });
    return s;
  };
  assert.equal(attack(mkS(), 0).players[1].active!.damage, 70, "Shred ignores damage prevention");
  assert.equal(attack(mkS(), 1).players[1].active!.damage, 0, "Rampaging Thunder does not");
  const s = mainState(); setActive(s, 0, id("N's Zekrom"), { energy: [R, L, L, D] }); setActive(s, 1, "dummy");
  let n = attack(s, 1);
  assert.equal(n.players[1].active!.damage, 250);
  n = applyAction(n, { type: "endTurn" });
  assert.equal(acts(n, 0, "attack").length, 0, "can't attack during your next turn");
  n = applyAction(applyAction(n, { type: "endTurn" }), { type: "endTurn" });
  assert.ok(acts(n, 0, "attack").length > 0, "free again the turn after");
});

test("N's Reshiram Powerful Rage: 20 damage per damage counter on itself", () => {
  const run = (dmg: number) => {
    const s = mainState(); setActive(s, 0, id("N's Reshiram"), { energy: [R, L], damage: dmg }); setActive(s, 1, "dummy");
    return attack(s, 0).players[1].active!.damage;
  };
  assert.equal(run(40), 80); assert.equal(run(0), 0);
});

test("Pecharunt ex Subjugating Chains: switch in a Benched non-Pecharunt Darkness Pokémon, which becomes Poisoned; 1 per turn", () => {
  const s = mainState();
  const pe = setActive(s, 0, id("Pecharunt ex")), pe2 = addBench(s, 0, id("Pecharunt ex"));
  const z = addBench(s, 0, id("N's Zorua")); addBench(s, 0, "dummy"); setActive(s, 1, "dummy");
  let n = answer(ability(s, pe.iid), ["yes"]);
  assert.equal(n.players[0].active!.iid, z.iid, "the only valid target (not Pecharunt, not non-Darkness) is auto-chosen");
  assert.ok(n.players[0].active!.status.poisoned);
  assert.ok(n.players[0].bench.some((p) => p.iid === pe.iid));
  assert.equal(acts(n, 0, "useAbility").length, 0, "the second Pecharunt ex can't use it again this turn");
  assert.ok(pe2);
});

test("Pecharunt ex Irritated Outburst: 60 damage per Prize card the opponent has taken", () => {
  const s = mainState(); setActive(s, 0, id("Pecharunt ex"), { energy: [D, D] }); setActive(s, 1, "dummy");
  s.players[1].prizes = s.players[1].prizes.slice(0, 4);
  assert.equal(attack(s, 0).players[1].active!.damage, 120);
});

test("Yveltal Clutch: 20 and the Defending Pokémon can't retreat during the opponent's next turn", () => {
  const s = mainState(); setActive(s, 0, id("Yveltal"), { energy: [D] }); setActive(s, 1, "dummy"); addBench(s, 1, "dummy");
  const n = attack(s, 0);
  assert.equal(n.players[1].active!.damage, 20);
  assert.equal(acts(n, 1, "retreat").length, 0);
});

test("Black Belt's Training: +40 to the Active ex before Weakness, only this turn", () => {
  const mkS = (def: string) => {
    const s = mainState(); setActive(s, 0, id("Yveltal"), { energy: [D, D, D] }); setActive(s, 1, def);
    return { s, c: give(s, 0, id("Black Belt's Training")) };
  };
  let { s, c } = mkS("weak-d-ex");
  assert.equal(attack(play(s, "playSupporter", c), 1).players[1].active!.damage, (110 + 40) * 2);
  ({ s, c } = mkS("weak-d"));
  assert.equal(attack(play(s, "playSupporter", c), 1).players[1].active!.damage, 110 * 2, "not an ex: no bonus");
  ({ s, c } = mkS("dummy-ex"));
  const n = applyAction(applyAction(play(s, "playSupporter", c), { type: "endTurn" }), { type: "endTurn" });
  assert.equal(attack(n, 1).players[1].active!.damage, 110, "bonus gone next turn");
});

test("Cyrano: up to 3 Pokémon ex from the deck to hand", () => {
  const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  deckOf(s, 0, id("N's Zoroark ex"), id("Dreepy"), id("Fezandipiti ex"), id("Meowth ex"), id("Pecharunt ex"), R);
  let n = play(s, "playSupporter", give(s, 0, id("Cyrano")));
  assert.equal(n.pendingChoice!.max, 3);
  assert.deepEqual(optNames(n), ["Fezandipiti ex", "Meowth ex", "N's Zoroark ex", "Pecharunt ex"]);
  n = answer(n, n.pendingChoice!.options.slice(0, 3));
  assert.equal(n.players[0].hand.length, 3);
});

test("N's PP Up: Basic Energy from the discard pile to a Benched N's Pokémon only", () => {
  const s = mainState(); setActive(s, 0, id("N's Zorua")); const b = addBench(s, 0, id("N's Zorua")); addBench(s, 0, id("Munkidori")); setActive(s, 1, "dummy");
  const e = mintCard(s, D); s.players[0].discard = [e, mintCard(s, id("Dreepy"))];
  const n = play(s, "playItem", give(s, 0, id("N's PP Up")));
  assert.deepEqual(n.players[0].bench[0]!.energy, [e]); assert.equal(n.players[0].active!.energy.length, 0);
  assert.ok(b);
});

test("Special Red Card: only if the opponent has 3 or fewer Prizes left; their hand goes to the bottom of their deck, then they draw 3", () => {
  const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  const c = give(s, 0, id("Special Red Card"));
  for (let i = 0; i < 6; i++) give(s, 1, R);
  assert.equal(acts(s, 0, "playItem").length, 0);
  s.players[1].prizes = s.players[1].prizes.slice(0, 3);
  const before = s.players[1].deck.length;
  const n = play(s, "playItem", c);
  assert.equal(n.players[1].hand.length, 3);
  assert.equal(n.players[1].deck.length, before + 6 - 3);
  // empty hand: puts nothing on the bottom, so no draw
  const e = mainState(); setActive(e, 0, "dummy"); setActive(e, 1, "dummy"); e.players[1].prizes = e.players[1].prizes.slice(0, 2);
  assert.equal(play(e, "playItem", give(e, 0, id("Special Red Card"))).players[1].hand.length, 0);
});

test("Punk Helmet: attacker gets 4 counters when the Darkness Pokémon is hit in the Active Spot (even if Knocked Out); not for non-Darkness", () => {
  const mkS = (def: string, damage = 0) => {
    const s = mainState();
    setActive(s, 0, def, { tool: id("Punk Helmet"), damage }); addBench(s, 0, "dummy");
    setActive(s, 1, id("N's Zekrom"), { energy: [R, R, R] });
    return asP1(s);
  };
  assert.equal(attack(mkS(id("Yveltal")), 0).players[1].active!.damage, 40, "survives Shred (70 of 110 HP)");
  const ko = mkS(id("N's Zorua"));
  const out = attack(ko, 0);
  assert.equal(out.players[0].discard.some((c) => nameOf(c) === "N's Zorua"), true, "Knocked Out");
  assert.equal(out.players[1].active!.damage, 40, "…and the attacker still got the counters");
  assert.equal(attack(mkS(id("Munkidori")), 0).players[1].active!.damage, 0, "Psychic Pokémon: no effect");
  // benched holder isn't "in the Active Spot"
  const b = mainState(); setActive(b, 0, "dummy"); addBench(b, 0, id("Yveltal"), { tool: id("Punk Helmet") });
  setActive(b, 1, id("Fezandipiti ex"), { energy: [R, R, R] });
  const bn = answer(attack(asP1(b), 0), [b.players[0].bench[0]!.iid]);
  assert.equal(bn.players[0].bench[0]!.damage, 100); assert.equal(bn.players[1].active!.damage, 0);
});

test("N's Castle: N's Pokémon of both players have no Retreat Cost; others unaffected; ends when the Stadium leaves", () => {
  const s = mainState();
  const z = setActive(s, 0, id("N's Zoroark ex")); addBench(s, 0, "dummy");
  const oz = setActive(s, 1, id("N's Zorua")), m = addBench(s, 1, id("Munkidori"));
  assert.equal(retreatCostOf(s, z), 2); assert.equal(acts(s, 0, "retreat").length, 0);
  s.stadium = { iid: mintCard(s, id("N's Castle")), owner: 1 };
  assert.deepEqual([retreatCostOf(s, z), retreatCostOf(s, oz), retreatCostOf(s, m)], [0, 0, 1]);
  assert.equal(acts(s, 0, "retreat").length, 1, "free retreat");
  const n = applyAction(s, acts(s, 0, "retreat")[0]!);
  assert.equal(nameOf(n.players[0].active!.iid), "Dummy");
  const gone = give(s, 0, id("Risky Ruins"));
  assert.equal(retreatCostOf(applyAction(s, { type: "playStadium", card: gone }), z), 2);
});

test("Team Rocket's Watchtower: Colorless Pokémon (both players') have no Abilities; others do; Meowth ex's Last-Ditch is silenced", () => {
  const s = mainState();
  const dd = setActive(s, 0, id("Dudunsparce")); const mk2 = addBench(s, 0, id("Munkidori"), { energy: [D], damage: 10 });
  const odd = setActive(s, 1, id("Dudunsparce"));
  assert.equal((acts(s, 0, "useAbility") as Array<{ pokemon: string }>).filter((a) => a.pokemon === dd.iid).length, 1);
  s.stadium = { iid: mintCard(s, id("Team Rocket's Watchtower")), owner: 1 };
  assert.deepEqual(acts(s, 0, "useAbility").map((a) => (a as { pokemon: string }).pokemon), [mk2.iid]);
  assert.ok(abilityLocked(s, dd) && abilityLocked(s, odd) && !abilityLocked(s, mk2));
  deckOf(s, 0, id("Boss's Orders"));
  const n = applyAction(s, { type: "playBasicToBench", card: give(s, 0, id("Meowth ex")) });
  assert.equal(n.pendingChoice, undefined, "no Last-Ditch Catch under the Watchtower");
});

test("Real decks: legal 60-card lists with the stated ACE SPEC / copy limits, and every card has printed text", () => {
  for (const deck of [DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK]) {
    assert.equal(deck.length, 60);
    for (const d of new Set(deck)) assert.ok(d.text && d.text.length > 0, `${d.name} has text`);
  }
  assert.ok(mk);
});

// ------------------------------------------------------------------ regressions found while writing the above / by the sims
test("regression: 'choose 1 of your ...' abilities with no candidate are not offered (Pecharunt ex, Munkidori)", () => {
  const s = mainState();
  const pe = setActive(s, 0, id("Pecharunt ex")); addBench(s, 0, id("Pecharunt ex")); addBench(s, 0, "dummy"); setActive(s, 1, "dummy");
  assert.equal(acts(s, 0, "useAbility").length, 0, "no Benched non-Pecharunt Darkness Pokémon: nothing to switch");
  addBench(s, 0, id("N's Zorua"));
  assert.equal(acts(s, 0, "useAbility").length, 2);
  const t = mainState();
  setActive(t, 0, id("Munkidori"), { energy: [D] }); setActive(t, 1, "dummy");
  assert.equal(acts(t, 0, "useAbility").length, 0, "no damaged Pokémon to take counters from");
  assert.ok(pe);
});

test("regression: legalActions throws a diagnostic if the decider of a live game has no actions (engine bug guard)", () => {
  const s = mainState(); setActive(s, 0, "dummy"); setActive(s, 1, "dummy");
  s.pendingChoice = { player: 0, kind: "cards", options: ["x"], min: 2, max: 2, prompt: "impossible" };
  assert.throws(() => legalActions(s, 0), /engine bug: no legal actions/);
  assert.deepEqual(legalActions(s, 1), [], "the non-decider simply has none");
});
