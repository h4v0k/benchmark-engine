// Structured event stream: shape of individual events, whole-game invariants, stats derivation, redaction, JSONL export, clone safety.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { greedyAgent } from "../agents/greedy.js";
import { randomAgent } from "../agents/random.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../cards/standard/index.js";
import { formatEvent, type EventOf, type GameEvent } from "../events.js";
import { createGame } from "../game.js";
import { cloneState, deepClone, logText, observe } from "../state.js";
import { exportGamesJsonl, gameToJsonl, playGame, statsFromEvents } from "../sim.js";
import { legalActions, sameAction, wasIssued, type Action } from "../actions.js";
import { acts, addBench, applyAction, give, mainState, setActive } from "./helpers.js";

const ev = <T extends GameEvent["type"]>(s: { events: GameEvent[] }, type: T): Array<EventOf<T>> =>
  s.events.filter((e): e is EventOf<T> => e.type === type);

test("events: attack carries attacker/target ids+names, damage after weakness, ko flag; ko + prize follow", () => {
  const s = mainState();
  const a = setActive(s, 0, "sparkbit", { energy: ["energy-l"] });
  const d = setActive(s, 1, "tidepup", { damage: 40 }); // 80 HP, Lightning weakness: Zap does 40 and finishes it
  const before = s.events.length;
  const n = applyAction(s, { type: "attack", attackIndex: 0 });
  const fresh = n.events.slice(before);
  const atk = fresh.find((e): e is EventOf<"attack"> => e.type === "attack")!;
  assert.deepEqual({ ...atk }, {
    type: "attack", turn: 5, player: 0, attackerId: a.iid, attackerName: "Sparkbit", attackName: "Zap",
    targetId: d.iid, targetName: "Tidepup", damage: 40, ko: true,
  });
  const ko = fresh.find((e): e is EventOf<"ko"> => e.type === "ko")!;
  assert.deepEqual({ owner: ko.owner, pokemonId: ko.pokemonId, pokemonName: ko.pokemonName, byAttack: ko.byAttack, takenBy: ko.takenBy, prizesTaken: ko.prizesTaken },
    { owner: 1, pokemonId: d.iid, pokemonName: "Tidepup", byAttack: true, takenBy: 0, prizesTaken: 1 });
  const prize = fresh.find((e): e is EventOf<"prize"> => e.type === "prize")!;
  assert.deepEqual([prize.player, prize.count, prize.remaining], [0, 1, 5]);
  assert.ok(fresh.indexOf(atk) < fresh.indexOf(ko) && fresh.indexOf(ko) < fresh.indexOf(prize), "attack, then ko, then prize");
  assert.ok(fresh.every((e) => e.turn >= 5), "every event carries its turn");
});

test("events: zero-damage and non-lethal attacks; play / evolve / attach / ability / retreat / status / checkup / coin / draw events", () => {
  const s = mainState();
  setActive(s, 0, "voltorch", { energy: ["energy-l", "energy-l"], turnPlayed: 1 }); addBench(s, 0, "sparkbit"); setActive(s, 1, "rockpup");
  s.players[1].active!.status.poisoned = true; s.players[1].active!.status.burned = true;
  const ability = acts(s, 0, "useAbility")[0]!;
  let n = applyAction(s, ability);
  const ab = ev(n, "ability").at(-1)!;
  assert.deepEqual([ab.player, ab.pokemonName, ab.name], [0, "Voltorch", "Static Draw"]);
  const dr = ev(n, "draw").at(-1)!;
  assert.deepEqual([dr.player, dr.count, dr.cardIds.length, dr.reason], [0, 1, 1, "effect"]);
  assert.equal(n.players[0].hand.at(-1), dr.cardIds[0], "draw event names the drawn card");

  const en = give(n, 0, "energy-l");
  n = applyAction(n, { type: "attachEnergy", card: en, target: n.players[0].active!.iid });
  const att = ev(n, "attachEnergy").at(-1)!;
  assert.deepEqual([att.cardId, att.targetName, att.source], [en, "Voltorch", "hand"]);

  const sp = give(n, 0, "sparkbit");
  n = applyAction(n, { type: "playBasicToBench", card: sp });
  assert.deepEqual({ ...ev(n, "play").at(-1)! }, { type: "play", turn: 5, player: 0, cardId: sp, cardName: "Sparkbit", kind: "basic" });

  n = applyAction(n, acts(n, 0, "retreat")[0]!);
  const sw = ev(n, "switch").at(-1)!;
  assert.deepEqual([sw.player, sw.reason, sw.pokemonName], [0, "retreat", "Sparkbit"]);
  assert.ok(ev(n, "discard").at(-1)!.zone === "attached", "retreat energy is a discard event");

  n = applyAction(n, { type: "endTurn" });
  const cu = ev(n, "checkup").at(-1)!;
  assert.deepEqual(cu.results.filter((r) => r.kind === "poison" || r.kind === "burn").map((r) => [r.kind, r.damage]), [["poison", 10], ["burn", 20]]);
  assert.ok(ev(n, "coin").length >= 1, "burn cure coin is an event");
  assert.deepEqual([ev(n, "turnStart").at(-1)!.player, ev(n, "turnStart").at(-1)!.turn], [1, 6]);
});

test("events: evolve, status and zero-damage attack", () => {
  const s = mainState();
  const sparkbit = setActive(s, 0, "sparkbit", { turnPlayed: 1 });
  const v = give(s, 0, "voltorch");
  let n = applyAction(s, { type: "evolve", target: sparkbit.iid, card: v });
  const evo = ev(n, "evolve").at(-1)!;
  assert.deepEqual([evo.from, evo.to, evo.fromName, evo.toName], [sparkbit.iid, v, "Sparkbit", "Voltorch"]);

  let found = false;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    const t = mainState(seed);
    setActive(t, 0, "pondling", { energy: ["energy-w"] }); setActive(t, 1, "rockpup"); addBench(t, 1, "tidepup");
    n = applyAction(t, { type: "attack", attackIndex: 0 });
    if (ev(n, "status").length) {
      found = true;
      const st = ev(n, "status")[0]!;
      assert.deepEqual([st.player, st.pokemonName, st.condition], [1, "Rockpup", "paralyzed"]);
      assert.equal(ev(n, "coin")[0]!.heads, true);
    }
  }
  assert.ok(found, "a heads flip applied Paralysis");
  // a 0-damage attack (confused tails): recorded as failed with damage 0
  for (let seed = 1; seed <= 40; seed++) {
    const t = mainState(seed);
    setActive(t, 0, "sparkbit", { energy: ["energy-l"] }).status.confused = true; setActive(t, 1, "rockpup");
    const r = applyAction(t, { type: "attack", attackIndex: 0 });
    const a = ev(r, "attack").at(-1)!;
    if (a.failed) {
      assert.deepEqual([a.failed, a.damage, a.ko], ["confused", 0, false]);
      assert.equal(ev(r, "damageCounters").at(-1)!.source, "confusion");
      assert.equal(ev(r, "damageCounters").at(-1)!.amount, 3);
      return;
    }
  }
  assert.ok(false, "expected a tails flip");
});

test("whole real games: stream is well-formed, ko/prize/gameEnd are consistent, stats come only from events", () => {
  for (const [agent, label] of [[greedyAgent, "greedy"], [randomAgent, "random"]] as const) {
    for (let seed = 1; seed <= 12; seed++) {
      const r = playGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, seed, agent, agent);
      const E = r.events;
      assert.equal(E[0]!.type, "gameStart", label);
      const last = E.at(-1)! as EventOf<"gameEnd">;
      assert.equal(last.type, "gameEnd");
      assert.deepEqual([last.winner, last.reason, last.turns], [r.winner, r.reason, r.turns]);
      assert.equal(E.filter((e) => e.type === "gameEnd").length, 1);
      for (let i = 1; i < E.length; i++) assert.ok(E[i]!.turn >= E[i - 1]!.turn, `${label} seed ${seed}: turn never decreases`);
      for (let i = 0; i < E.length; i++) {
        const e = E[i]!;
        if (e.type === "ko") { const nx = E[i + 1]! as EventOf<"prize">; assert.ok(nx.type === "prize" && nx.count === e.prizesTaken && nx.player === e.takenBy); }
        if (e.type === "draw") assert.equal(e.cardIds.length, e.count);
        assert.ok(formatEvent(e).startsWith(`T${e.turn} `), "formatEvent renders every event");
      }
      const st = statsFromEvents(E);
      assert.deepEqual(st, r.stats);
      assert.equal(st.kos[0] + st.kos[1], E.filter((e) => e.type === "ko").length);
      for (const p of [0, 1] as const) {
        const pe = E.filter((e): e is EventOf<"prize"> => e.type === "prize" && e.player === p);
        assert.equal(st.prizesTaken[p], pe.length ? 6 - pe.at(-1)!.remaining : 0, "prizes taken = 6 - remaining after the last prize event");
      }
      if (r.reason === "prizes") assert.equal(st.prizesTaken[r.winner!], 6, "a prize win means six Prizes were taken");
      assert.ok(st.zeroDamageAttacks[0] + st.zeroDamageAttacks[1] <= st.attacks[0] + st.attacks[1]);
      assert.deepEqual(r.decks[0], [...r.decks[0]].sort(), "gameStart decklist");
      assert.equal(r.decks[0].length, 60);
    }
  }
});

test("log text helper renders the stream; observe() redacts the opponent's decklist, draws and searches", () => {
  const g = createGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, 3);
  const lines = logText(g);
  assert.equal(lines.length, g.events.length);
  assert.ok(lines[0]!.includes("goes first"));
  const o = observe(g, 0);
  const start = o.events[0] as EventOf<"gameStart">;
  assert.equal(start.decks[0].length, 60);
  assert.equal(start.decks[1].length, 0, "the opponent's decklist is hidden");
  const opp = o.events.filter((e): e is EventOf<"draw"> => e.type === "draw" && e.player === 1);
  assert.ok(opp.length > 0 && opp.every((e) => e.cardIds.length === 0 && e.count > 0), "opponent draws: counts only");
  assert.ok(o.events.some((e) => e.type === "draw" && e.player === 0 && e.cardIds.length > 0));
});

test("JSONL export: one parseable line per game with seed, decks, winner, reason, turns, events", () => {
  const rs = [1, 2, 3].map((seed) => playGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, seed, greedyAgent, greedyAgent));
  const path = "dist/test/_games-export.jsonl";
  exportGamesJsonl(rs, path);
  const lines = readFileSync(path, "utf8").split("\n");
  unlinkSync(path);
  assert.equal(lines.pop(), "", "trailing newline");
  assert.equal(lines.length, 3);
  lines.forEach((l, i) => {
    const o = JSON.parse(l);
    assert.deepEqual(Object.keys(o), ["seed", "decks", "winner", "reason", "turns", "events"]);
    assert.equal(o.seed, rs[i]!.seed);
    assert.equal(o.winner, rs[i]!.winner);
    assert.equal(o.turns, rs[i]!.turns);
    assert.equal(o.events.length, rs[i]!.events.length);
    assert.equal(l, gameToJsonl(rs[i]!));
  });
});

test("cloneState: equals a deep clone, shares no mutable structure, and applyAction never touches its input", () => {
  const r = playGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, 9, greedyAgent, greedyAgent, 6); // stops mid-game by turn limit
  const g = createGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, 11);
  assert.ok(r.events.length > 0);
  for (const s of [g, mainState(), (() => { const m = mainState(); setActive(m, 0, "sparkbit", { energy: ["energy-l"] }).markers.push({ key: "x", expiresAfterTurn: 9 }); setActive(m, 1, "rockpup"); m.stadium = { iid: give(m, 0, "training-court"), owner: 0 }; return m; })()]) {
    const json = JSON.stringify(s);
    const c = cloneState(s);
    assert.deepEqual(JSON.parse(JSON.stringify(c)), JSON.parse(JSON.stringify(deepClone(s))));
    // mutate every mutable thing in the clone; the original must be untouched
    for (const ps of c.players) {
      ps.deck.reverse(); ps.hand.push("zzz#1"); ps.discard.push("zzz#2"); ps.prizes.pop(); ps.lostZone.push("zzz#3"); ps.markers.push({ key: "k" });
      ps.flags.abilityNamesUsed.push("a"); ps.flags.energyAttachedThisTurn = !ps.flags.energyAttachedThisTurn; ps.usedGameAbilities.push("u");
      for (const p of [ps.active, ...ps.bench]) if (p) { p.energy.push("e#1"); p.below.push("b#1"); p.markers.push({ key: "m" }); p.usedAbilities.push("u"); p.status.asleep = true; p.damage += 10; }
    }
    c.rng.s++; c.events.push({ type: "setupComplete", turn: 0 }); c.turn++;
    if (c.setup) { c.setup.mulls[0]++; c.setup.acked[0] = true; c.setup.benchDone[1] = true; }
    assert.equal(JSON.stringify(s), json, "mutating a clone leaked into the original");
  }
  const m = mainState(); setActive(m, 0, "sparkbit", { energy: ["energy-l"] }); setActive(m, 1, "rockpup");
  const json = JSON.stringify(m);
  applyAction(m, { type: "attack", attackIndex: 0 });
  applyAction(m, { type: "endTurn" });
  assert.equal(JSON.stringify(m), json);
});

test("sameAction ignores `choices`, compares arrays, and applyAction still rejects illegal actions unless explicitly trusted from legalActions", () => {
  const s = mainState();
  setActive(s, 0, "voltorch", { energy: ["energy-l", "energy-l"] }); addBench(s, 0, "sparkbit"); setActive(s, 1, "rockpup");
  const [r] = acts(s, 0, "retreat");
  assert.ok(sameAction(r!, { ...r!, choices: [["x"]] } as Action));
  assert.ok(!sameAction(r!, { type: "retreat", newActive: (r as { newActive: string }).newActive, energyToDiscard: [] }));
  assert.ok(!sameAction({ type: "attack", attackIndex: 0 }, { type: "attack", attackIndex: 1 }));
  assert.throws(() => applyAction(s, { type: "attack", attackIndex: 5 }));
  const legal = legalActions(s, 0);
  assert.ok(wasIssued(s, legal[0]!) && !wasIssued(s, { ...legal[0]! }) && !wasIssued(mainState(), legal[0]!));
  assert.ok(applyAction(s, legal.find((a) => a.type === "endTurn")!, { trusted: true }).turn === s.turn + 1);
});
