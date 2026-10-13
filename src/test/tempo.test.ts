// Canonical Dragapult curve: Dreepy -> Drakloak -> Dragapult ex on own turns 1/2/3 with an Energy attached each turn; Phantom Dive is legal on own turn 3.
// Guards the evolution timing rules (turnPlayed / first-turn rule counted in GAME turns, but applied per owner) against over-strict regressions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decider, legalActions, type Action } from "../actions.js";
import { applyAction, createGame } from "../game.js";
import { DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK } from "../cards/standard/index.js";
import { defIdOf, defOf } from "../cards/model.js";
import { mintCard, newPokemon, type GameState, type PlayerId } from "../state.js";

const DREEPY = "sv6-128", DRAKLOAK = "sv6-129", DRAGAPULT = "sv6-130", BUDEW = "me2pt5-16", FIRE = "basic-r", PSYCHIC = "basic-p";

/** A main-phase game start where P0 goes first (the first seed whose coin flip says so). */
function started(seed: number): GameState {
  let s = createGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, seed);
  while (s.firstPlayer !== 0) s = createGame(DRAGAPULT_EX_DECK, NS_ZOROARK_EX_DECK, ++seed);
  for (let g = 0; s.phase !== "main"; g++) {
    assert.ok(g < 200, "setup did not finish");
    const acts = legalActions(s, decider(s)!);
    s = applyAction(s, s.pendingChoice ? acts[acts.length - 1]! : acts[0]!);
  }
  assert.equal(s.turn, 1);
  assert.equal(s.activePlayer, 0);
  return s;
}
const find = (s: GameState, pl: PlayerId, type: Action["type"], pred: (a: Action) => boolean = () => true): Action | undefined => legalActions(s, pl).find((a) => a.type === type && pred(a));
const must = (a: Action | undefined, what: string): Action => { assert.ok(a, `expected a legal action: ${what}`); return a; };

for (const me of [0, 1] as PlayerId[]) {
  test(`canonical curve (Dragapult player is P${me}${me === 0 ? ", first" : ", second"}): bench Dreepy T1, Drakloak T2, Dragapult ex T3, Phantom Dive legal on own turn 3`, () => {
    let s = started(11);
    // reset both boards: the Dragapult player gets an empty-handed Budew Active (retreat cost 0), the opponent a lone Active
    for (const pl of [0, 1] as PlayerId[]) { const ps = s.players[pl]; ps.hand = []; ps.bench = []; ps.active = newPokemon(mintCard(s, BUDEW), 0); }
    const opp: PlayerId = me === 0 ? 1 : 0;
    s.players[opp].active = newPokemon(mintCard(s, BUDEW), 0);
    const step = (a: Action) => { s = applyAction(s, a); };
    const give = (id: string) => { const c = mintCard(s, id); s.players[me].hand.push(c); return c; };
    const endTurn = () => { step({ type: "endTurn" }); };
    const idleOppTurn = () => { assert.equal(decider(s), opp); s.players[opp].hand = s.players[opp].hand.slice(0, 0); endTurn(); };
    if (me === 1) { assert.equal(s.activePlayer, 0); endTurn(); } // the opponent's first turn
    // ---- own turn 1 (game turn 1 or 2): bench Dreepy, attach Fire to it
    assert.equal(s.turn, me === 0 ? 1 : 2);
    give(DREEPY); give(FIRE);
    step(must(find(s, me, "playBasicToBench", (a) => a.type === "playBasicToBench" && defIdOf(a.card) === DREEPY), "bench Dreepy"));
    const slot = () => s.players[me].bench[0]!; // an evolved Pokémon's iid becomes the new top card's, so look it up by slot
    assert.equal(defOf(slot().iid).name, "Dreepy");
    step(must(find(s, me, "attachEnergy", (a) => a.type === "attachEnergy" && defIdOf(a.card) === FIRE && a.target === slot().iid), "attach Fire to Dreepy"));
    assert.equal(find(s, me, "evolve"), undefined, "no evolution on the same turn it was benched");
    endTurn(); idleOppTurn();
    // ---- own turn 2: Drakloak (the turn AFTER benching is legal), attach Psychic
    assert.equal(s.turn, me === 0 ? 3 : 4);
    give(DRAKLOAK); give(PSYCHIC);
    step(must(find(s, me, "evolve", (a) => a.type === "evolve" && defIdOf(a.card) === DRAKLOAK && a.target === slot().iid), "evolve Dreepy -> Drakloak on own turn 2"));
    step(must(find(s, me, "attachEnergy", (a) => a.type === "attachEnergy" && defIdOf(a.card) === PSYCHIC && a.target === slot().iid), "attach Psychic to Drakloak"));
    assert.equal(find(s, me, "evolve"), undefined);
    endTurn(); idleOppTurn();
    // ---- own turn 3: Dragapult ex, retreat the free-retreating Budew, Phantom Dive (R+P attached) is legal
    assert.equal(s.turn, me === 0 ? 5 : 6);
    give(DRAGAPULT);
    step(must(find(s, me, "evolve", (a) => a.type === "evolve" && defIdOf(a.card) === DRAGAPULT && a.target === slot().iid), "evolve Drakloak -> Dragapult ex on own turn 3"));
    assert.equal(defOf(slot().iid).name, "Dragapult ex");
    step(must(find(s, me, "retreat", (a) => a.type === "retreat" && a.newActive === slot().iid), "retreat Budew into Dragapult ex"));
    const dive = must(find(s, me, "attack", (a) => a.type === "attack" && defOf(s.players[me].active!.iid).attacks![a.attackIndex]!.name === "Phantom Dive"), "Phantom Dive on own turn 3");
    step(dive);
  });
}

test("second player: no evolution on game turn 2 (own turn 1) but evolution on own turn 2 (game turn 4) of a Pokémon benched on game turn 2", () => {
  let s = started(12);
  s.players[0].hand = []; s.players[1].hand = [];
  s.players[1].bench = []; s.players[1].active = newPokemon(mintCard(s, DREEPY), 0); // Dreepy placed during setup (turn 0)
  s.players[0].active = newPokemon(mintCard(s, BUDEW), 0);
  s = applyAction(s, { type: "endTurn" });
  const d2 = mintCard(s, DRAKLOAK); s.players[1].hand.push(d2);
  assert.equal(s.turn, 2);
  assert.equal(legalActions(s, 1).some((a) => a.type === "evolve"), false, "no evolving on a player's first turn");
  s = applyAction(s, { type: "endTurn" }); s = applyAction(s, { type: "endTurn" });
  assert.equal(s.turn, 4);
  assert.ok(legalActions(s, 1).some((a) => a.type === "evolve"), "evolving on own turn 2 is legal");
});
