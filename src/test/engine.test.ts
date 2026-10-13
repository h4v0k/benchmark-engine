import { test } from "node:test";
import assert from "node:assert/strict";
import { decider, type Action } from "../actions.js";
import { deckA, deckB, sparkbit } from "../cards/test-cards.js";
import { isBasicPokemon, defOf, registerCards, type CardDef } from "../cards/model.js";
import { applyAction, createGame } from "../game.js";
import { makeRandomAgent, randomAgent } from "../agents/random.js";
import { makeRng } from "../rng.js";
import { playGame, simulate } from "../sim.js";
import { observe, type GameState } from "../state.js";
import { acts, addBench, coins, give, legalActions, mainState, setActive, startGame } from "./helpers.js";

const idOf = (s: GameState, pl: 0 | 1) => s.players[pl].active!.iid;

// ------------------------------------------------------------------ setup / mulligan
test("setup: 7-card hands, 6 prizes, active chosen, 60 cards conserved", () => {
  const s = startGame(3);
  assert.equal(s.phase, "main");
  for (const ps of s.players) {
    assert.equal(ps.prizes.length, 6);
    assert.ok(ps.active);
    const total = ps.deck.length + ps.hand.length + ps.prizes.length + ps.discard.length + 1 + ps.bench.length;
    assert.equal(total, 60);
  }
  assert.equal(s.turn, 1);
  assert.equal(s.activePlayer, s.firstPlayer);
  assert.equal(s.players[s.firstPlayer].hand.length + s.players[s.firstPlayer].bench.length + 1, 8); // 7 + first draw
});

test("mulligan: no-Basic hand reveals, reshuffles, redraws; opponent may draw the difference", () => {
  const lowBasic: CardDef[] = [...Array(4).fill(sparkbit), ...deckA.filter((c) => c.supertype === "Energy").slice(0, 56)];
  registerCards(lowBasic);
  let found = 0, extraDraw = 0;
  for (let seed = 1; seed <= 60 && !extraDraw; seed++) {
    let s = createGame(lowBasic, deckB, seed);
    const mulls = [...s.setup!.mulls];
    for (const ps of s.players) assert.ok(ps.hand.some((c) => isBasicPokemon(defOf(c))) && ps.hand.length === 7);
    if (mulls[0]! + mulls[1]! === 0) continue;
    found++;
    assert.equal(s.phase, "mulliganAck");
    const mullers = [0, 1].filter((p) => mulls[p as 0 | 1]! > 0) as (0 | 1)[];
    for (const m of mullers) { assert.equal(decider(s), m); s = applyAction(s, { type: "mulliganAck" }); }
    if (mulls[0] !== mulls[1]) {
      assert.equal(s.phase, "mulliganDraw");
      const pc = s.pendingChoice!;
      assert.equal(pc.kind, "mulliganDraw");
      assert.equal(pc.player, mulls[0]! > mulls[1]! ? 1 : 0);
      assert.equal(pc.options.length, Math.abs(mulls[0]! - mulls[1]!) + 1);
      const before = s.players[pc.player].hand.length;
      s = applyAction(s, { type: "choose", picks: ["1"] });
      assert.equal(s.players[pc.player].hand.length, before + 1);
      extraDraw++;
    }
    assert.equal(s.phase, "setupActive");
  }
  assert.ok(found > 0 && extraDraw > 0, "expected to observe mulligans with unequal counts");
});

// ------------------------------------------------------------------ draw / deck-out
test("player who cannot draw at turn start loses", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit"); setActive(s, 1, "pondling");
  s.players[1].deck = [];
  const n = applyAction(s, { type: "endTurn" });
  assert.equal(n.phase, "over");
  assert.equal(n.winner, 0);
  assert.equal(n.winReason, "deckout");
  assert.deepEqual(legalActions(n, 0), []);
});

test("turn start draws exactly one card", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit"); setActive(s, 1, "pondling");
  const n = applyAction(s, { type: "endTurn" });
  assert.equal(n.players[1].hand.length, 1);
  assert.equal(n.activePlayer, 1);
  assert.equal(n.turn, 6);
});

// ------------------------------------------------------------------ energy / evolution / supporter / stadium
test("one energy attachment per turn", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit"); setActive(s, 1, "pondling");
  give(s, 0, "energy-l"); give(s, 0, "energy-l");
  assert.ok(acts(s, 0, "attachEnergy").length > 0);
  const n = applyAction(s, acts(s, 0, "attachEnergy")[0]!);
  assert.equal(n.players[0].active!.energy.length, 1);
  assert.equal(acts(n, 0, "attachEnergy").length, 0);
  assert.throws(() => applyAction(n, { type: "attachEnergy", card: n.players[0].hand[0]!, target: idOf(n, 0) }));
});

test("evolution timing: not the turn played, not twice, not on either first turn", () => {
  const s = mainState();
  const sp = setActive(s, 0, "sparkbit", { turnPlayed: s.turn }); setActive(s, 1, "pondling");
  give(s, 0, "voltorch");
  assert.equal(acts(s, 0, "evolve").length, 0, "played this turn");
  sp.turnPlayed = s.turn - 2;
  assert.equal(acts(s, 0, "evolve").length, 1);
  const n = applyAction(s, acts(s, 0, "evolve")[0]!);
  assert.equal(defOf(n.players[0].active!.iid).name, "Voltorch");
  assert.equal(n.players[0].active!.evolvedThisTurn, true);
  give(n, 0, "voltorch");
  assert.equal(acts(n, 0, "evolve").length, 0);
  const early = mainState(1, 2);
  early.activePlayer = 1;
  setActive(early, 1, "sparkbit"); setActive(early, 0, "pondling"); give(early, 1, "voltorch");
  assert.equal(acts(early, 1, "evolve").length, 0, "no evolving on the first turns");
});

test("Supporter: one per turn; first player's first turn restricted by flag", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit"); setActive(s, 1, "pondling");
  give(s, 0, "prof-notes"); give(s, 0, "prof-notes");
  assert.equal(acts(s, 0, "playSupporter").length, 1);
  const n = applyAction(s, acts(s, 0, "playSupporter")[0]!);
  assert.equal(n.players[0].hand.length, 6, "draw until 6 (1 left in hand + 5 drawn)");
  assert.equal(acts(n, 0, "playSupporter").length, 0);
  const f = mainState(1, 1);
  setActive(f, 0, "sparkbit", { energy: ["energy-l"] }); setActive(f, 1, "pondling"); give(f, 0, "prof-notes");
  assert.equal(acts(f, 0, "playSupporter").length, 0, "first player, first turn");
  assert.equal(acts(f, 0, "attack").length, 0, "first player cannot attack on turn 1");
  f.rules.noSupporterOnFirstTurnOfGame = false;
  assert.equal(acts(f, 0, "playSupporter").length, 1);
  f.rules.noAttackOnFirstTurnOfGame = false;
  assert.ok(acts(f, 0, "attack").length > 0);
});

test("Stadium: replacement goes to owner's discard; same name and second per turn illegal", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit"); setActive(s, 1, "pondling");
  const tc1 = give(s, 0, "training-court"), tc2 = give(s, 0, "training-court"); const of = give(s, 0, "open-field");
  assert.equal(acts(s, 0, "playStadium").length, 2); // deduped TC + Open Field
  let n = applyAction(s, { type: "playStadium", card: tc1 });
  assert.equal(n.stadium!.iid, tc1);
  assert.equal(acts(n, 0, "playStadium").length, 0, "once per turn");
  n.players[0].flags.stadiumPlayedThisTurn = false;
  assert.deepEqual(acts(n, 0, "playStadium").map((a) => (a as { card: string }).card), [of], "same-name stadium illegal");
  assert.throws(() => applyAction(n, { type: "playStadium", card: tc2 }));
  n = applyAction(n, { type: "playStadium", card: of });
  assert.equal(n.stadium!.iid, of);
  assert.ok(n.players[0].discard.includes(tc1));
});

// ------------------------------------------------------------------ damage
test("attack: weakness x2, resistance -30 (floor 0), tools add before weakness", () => {
  let s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] }); setActive(s, 1, "pondling"); addBench(s, 1, "tidepup");
  let n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].active!.damage, 40, "Zap 20 x2 weakness");
  s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] }); setActive(s, 1, "rockpup"); addBench(s, 1, "tidepup");
  n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].active!.damage, 0, "20 - 30 resistance floors at 0");
  s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"], tool: "muscle-band" }); setActive(s, 1, "pondling"); addBench(s, 1, "tidepup");
  n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].active!.damage, 60, "(20+10) x2");
});

test("damage modifier attack (+20 per Defending energy) and ex prize value", () => {
  const s = mainState();
  setActive(s, 0, "boltking-ex", { energy: ["energy-l", "energy-l", "energy-l"] });
  setActive(s, 1, "rockpup", { energy: ["energy-f", "energy-f"], tool: "hp-band" }); addBench(s, 1, "tidepup");
  const n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.players[1].active!.damage, 90, "80 + 2*20 = 120, Rockpup resists L (-30)");
});

test("bench damage ignores weakness/resistance", () => {
  registerCards([{
    id: "sniper", name: "Sniper", supertype: "Pokemon", subtypes: ["Basic"], hp: 60, types: ["L"],
    attacks: [{ name: "Snipe", cost: ["L"], damage: null, effect: { e: "damage", amount: 20, weakRes: false, to: { s: "pick", player: "opp", where: "bench", count: 1, chooser: "self" } } }],
  }]);
  const s = mainState();
  setActive(s, 0, "sniper", { energy: ["energy-l"] }); setActive(s, 1, "rockpup"); const b = addBench(s, 1, "pondling");
  addBench(s, 1, "tidepup");
  const p = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(p.pendingChoice!.kind, "pokemon");
  const n = applyAction(p, { type: "choose", picks: [b.iid] });
  assert.equal(n.players[1].bench.find((x) => x.iid === b.iid)!.damage, 20, "Pondling is weak to L but bench damage ignores it");
  assert.equal(n.players[1].active!.damage, 0);
});

// ------------------------------------------------------------------ KO / prizes / promote / wins
test("KO -> prizes -> defender promotes via choice -> turn passes", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] });
  setActive(s, 1, "pondling", { damage: 60 });
  const b1 = addBench(s, 1, "tidepup"), b2 = addBench(s, 1, "rockpup");
  const p = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(p.pendingChoice!.player, 1);
  assert.deepEqual([...p.pendingChoice!.options].sort(), [b1.iid, b2.iid].sort());
  assert.equal(p.players[0].prizes.length, 5, "partial state already shows prizes taken at KO");
  assert.equal(legalActions(p, 0).length, 0);
  assert.equal(legalActions(p, 1).length, 2);
  assert.equal(p.activePlayer, 0, "turn has not passed while a choice is pending");
  const n = applyAction(p, { type: "choose", picks: [b2.iid] });
  assert.equal(n.players[1].active!.iid, b2.iid);
  assert.equal(n.activePlayer, 1);
  assert.equal(n.turn, 6);
  assert.equal(n.players[1].discard.filter((c) => defOf(c).name === "Pondling").length, 1);
  assert.equal(n.players[0].hand.length, 1, "the taken prize is in hand");
});

test("ex Knock Out gives 2 prizes", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] });
  setActive(s, 1, "aquaking-ex", { damage: 200 }); addBench(s, 1, "tidepup"); addBench(s, 1, "rockpup");
  const p = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(p.players[0].prizes.length, 4);
});

test("win by taking the last prize / by opponent having no Pokémon", () => {
  let s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] }); setActive(s, 1, "pondling", { damage: 60 }); addBench(s, 1, "tidepup");
  s.players[0].prizes = s.players[0].prizes.slice(0, 1);
  let n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.phase, "over"); assert.equal(n.winner, 0); assert.equal(n.winReason, "prizes");
  s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] }); setActive(s, 1, "pondling", { damage: 60 });
  n = applyAction(s, { type: "attack", attackIndex: 0 });
  assert.equal(n.phase, "over"); assert.equal(n.winner, 0); assert.equal(n.winReason, "no-pokemon");
  assert.throws(() => applyAction(n, { type: "endTurn" }));
});

// ------------------------------------------------------------------ status conditions
test("Paralysis blocks attack & retreat and clears at end of the paralyzed player's next turn", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-l"] });
  const t = setActive(s, 1, "rockpup", { energy: ["energy-f", "energy-f"] }); addBench(s, 1, "tidepup");
  t.status.paralyzed = true;
  let n = applyAction(s, { type: "endTurn" }); // P0 ends: checkup must NOT clear P1's paralysis
  assert.equal(n.players[1].active!.status.paralyzed, true);
  assert.equal(acts(n, 1, "attack").length, 0);
  assert.equal(acts(n, 1, "retreat").length, 0);
  n = applyAction(n, { type: "endTurn" }); // P1 ends its turn: cleared
  assert.equal(n.players[1].active!.status.paralyzed, false);
});

test("Bubble: coin-flip paralyze follows the flip, both outcomes occur", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) {
    const s = mainState(seed);
    setActive(s, 0, "pondling", { energy: ["energy-w"] }); setActive(s, 1, "rockpup"); addBench(s, 1, "tidepup");
    const n = applyAction(s, { type: "attack", attackIndex: 0 });
    const c = coins(n).slice(-1)[0]!;
    assert.equal(n.players[1].active!.status.paralyzed, c === "H");
    seen.add(c);
  }
  assert.equal(seen.size, 2);
});

test("Asleep / Burned / Poisoned checkups", () => {
  const sleep = new Set<string>(), burn = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) {
    let s = mainState(seed);
    setActive(s, 0, "sparkbit"); setActive(s, 1, "rockpup", { energy: ["energy-f", "energy-f"] }).status.asleep = true;
    let n = applyAction(s, { type: "endTurn" });
    let c = coins(n).slice(-1)[0]!;
    assert.equal(n.players[1].active!.status.asleep, c === "T"); sleep.add(c);
    assert.equal(acts(n, 1, "attack").length === 0, c === "T");
    s = mainState(seed);
    setActive(s, 0, "sparkbit"); const t = setActive(s, 1, "rockpup"); t.status.burned = true; t.status.poisoned = true;
    n = applyAction(s, { type: "endTurn" });
    c = coins(n).slice(-1)[0]!;
    assert.equal(n.players[1].active!.damage, 30, "poison 10 + burn 20");
    assert.equal(n.players[1].active!.status.burned, c === "T"); burn.add(c);
    assert.equal(n.players[1].active!.status.poisoned, true);
  }
  assert.equal(sleep.size, 2); assert.equal(burn.size, 2);
});

test("Confused attack: tails = 30 to self and attack fails", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) {
    const s = mainState(seed);
    const a = setActive(s, 0, "sparkbit", { energy: ["energy-l"] }); a.status.confused = true;
    setActive(s, 1, "rockpup"); addBench(s, 1, "tidepup"); setActive(s, 1, "tidepup");
    const n = applyAction(s, { type: "attack", attackIndex: 0 });
    const c = coins(n)[0]!; seen.add(c);
    if (c === "T") { assert.equal(n.players[0].active!.damage, 30); assert.equal(n.players[1].active!.damage, 0); }
    else assert.equal(n.players[1].active!.damage, 40);
  }
  assert.equal(seen.size, 2);
});

// ------------------------------------------------------------------ choice model / items / abilities / retreat
test("gust via the choice model; original state untouched; pre-supplied choices work", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit"); const pond = setActive(s, 1, "pondling");
  const t = addBench(s, 1, "tidepup"), r = addBench(s, 1, "rockpup");
  const boss = give(s, 0, "boss-orders");
  const p = applyAction(s, { type: "playSupporter", card: boss });
  assert.equal(p.pendingChoice!.player, 0);
  assert.equal(p.pendingChoice!.kind, "pokemon");
  assert.equal(legalActions(p, 0).length, 2);
  assert.ok(p.pendingChoice!.origin!.base.players[0].hand.includes(boss), "replay snapshot keeps the pre-action position");
  assert.ok(s.players[0].hand.includes(boss) && !s.pendingChoice, "input state not mutated");
  const n = applyAction(p, { type: "choose", picks: [r.iid] });
  assert.equal(n.players[1].active!.iid, r.iid);
  assert.ok(n.players[1].bench.some((b) => b.iid === pond.iid) && n.players[1].bench.some((b) => b.iid === t.iid));
  assert.ok(n.players[0].discard.includes(boss));
  const m = applyAction(s, { type: "playSupporter", card: boss, choices: [[t.iid]] });
  assert.equal(m.players[1].active!.iid, t.iid);
  assert.throws(() => applyAction(p, { type: "choose", picks: ["bogus"] }));
});

test("search with a choice: Ball Throw fetches a chosen Basic and shuffles", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit"); setActive(s, 1, "pondling");
  const ball = give(s, 0, "ball-throw");
  const p = applyAction(s, { type: "playItem", card: ball });
  assert.equal(p.pendingChoice!.kind, "cards");
  const pick = legalActions(p, 0).find((a) => a.type === "choose" && a.picks.length === 1)!;
  const n = applyAction(p, pick);
  assert.equal(n.players[0].hand.length, 1);
  assert.equal(defOf(n.players[0].hand[0]!).supertype, "Pokemon");
  assert.equal(n.players[0].deck.length, s.players[0].deck.length - 1);
});

test("ability once per turn; Item draw 2; energy from discard (Dynamo Girl)", () => {
  const s = mainState();
  setActive(s, 0, "voltorch", { turnPlayed: 1 }); setActive(s, 1, "pondling");
  assert.equal(acts(s, 0, "useAbility").length, 1);
  const n = applyAction(s, acts(s, 0, "useAbility")[0]!);
  assert.equal(n.players[0].hand.length, 1);
  assert.equal(acts(n, 0, "useAbility").length, 0);
  const qd = give(n, 0, "quick-draw");
  const m = applyAction(n, { type: "playItem", card: qd });
  assert.equal(m.players[0].hand.length, 3);
  const dg = give(m, 0, "dynamo-girl");
  m.players[0].discard.push(...[give(m, 0, "energy-l"), give(m, 0, "energy-l")].map((c) => { m.players[0].hand.pop(); return c; }));
  const q = applyAction(m, { type: "playSupporter", card: dg });
  const pick = legalActions(q, 0).find((a) => a.type === "choose" && a.picks.length === 2)!;
  const r = applyAction(q, pick);
  assert.equal(r.players[0].active!.energy.length, 2);
});

test("retreat: cost paid by discarding energy, once per turn, Stadium reduces cost, status blocks", () => {
  const s = mainState();
  setActive(s, 0, "voltorch", { energy: ["energy-l"] }); addBench(s, 0, "sparkbit"); setActive(s, 1, "pondling");
  assert.equal(acts(s, 0, "retreat").length, 0, "cost 2, 1 energy");
  s.stadium = { iid: give(s, 0, "training-court"), owner: 0 };
  assert.equal(acts(s, 0, "retreat").length, 1, "Training Court: cost 1");
  s.stadium = undefined;
  s.players[0].active!.energy.push(...[give(s, 0, "energy-l"), give(s, 0, "energy-f")]);
  const r = acts(s, 0, "retreat");
  assert.ok(r.length >= 2, "different energy pairs are distinct");
  const n = applyAction(s, r[0]!);
  assert.equal(defOf(n.players[0].active!.iid).name, "Sparkbit");
  assert.equal(n.players[0].discard.length, 2);
  assert.equal(n.players[0].bench[0]!.energy.length, 1);
  assert.equal(acts(n, 0, "retreat").length, 0, "once per turn");
  const z = mainState();
  setActive(z, 0, "sparkbit"); addBench(z, 0, "sparkbit"); setActive(z, 1, "pondling");
  z.players[0].active!.status.asleep = true;
  assert.equal(acts(z, 0, "retreat").length, 0);
});

test("attack energy cost: type and Colorless payment", () => {
  const s = mainState();
  setActive(s, 0, "sparkbit", { energy: ["energy-f"] }); setActive(s, 1, "pondling");
  assert.equal(acts(s, 0, "attack").length, 0, "Fighting can't pay [L]");
  s.players[0].active!.energy = [give(s, 0, "energy-l"), give(s, 0, "energy-f")];
  assert.equal(acts(s, 0, "attack").length, 2, "L + F pays [L] and [L,C]");
});

// ------------------------------------------------------------------ observation / determinism / smoke
test("observe redacts hidden information", () => {
  const s = startGame(7);
  const o = observe(s, 0);
  assert.ok(Array.isArray(o.players[0].hand));
  assert.equal(o.players[1].hand, undefined);
  assert.equal(o.players[1].handCount, s.players[1].hand.length);
  assert.equal(o.players[0].prizeCount, 6);
  assert.ok(!("deck" in o.players[0]) && !("prizes" in o.players[1]));
  assert.ok(!JSON.stringify(o).includes(s.players[1].deck[0]!));
});

test("determinism: same seed -> identical event stream; different seed differs", () => {
  const a = playGame(deckA, deckB, 42, randomAgent, randomAgent);
  const b = playGame(deckA, deckB, 42, randomAgent, randomAgent);
  const c = playGame(deckA, deckB, 43, randomAgent, randomAgent);
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  assert.equal(a.winner, b.winner);
  assert.notEqual(JSON.stringify(a.events), JSON.stringify(c.events));
});

test("smoke: 200 random-agent games finish with no exceptions and none hit maxTurns", () => {
  const st = simulate(200, deckA, deckB, randomAgent, randomAgent, 1000, 200);
  console.log(`smoke: ${JSON.stringify(st)}`);
  assert.equal(st.draws, 0);
  assert.equal(st.wins[0] + st.wins[1], 200);
  assert.ok(st.maxTurnsSeen < 200);
  const bias = simulate(30, deckA, deckB, makeRandomAgent({ attackBias: 0 }), makeRandomAgent({ attackBias: 0 }), 5000, 200);
  assert.equal(bias.draws, 0);
  void makeRng; void ({} as Action);
});
