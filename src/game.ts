import type { Action } from "./actions.js";
import { abilityIsNameLimited, decider, enumerate, sameAction } from "./actions.js";
import { defIdOf, defOf, hasSub, isBasicPokemon, prizeValueOf, registerCards, type CardDef } from "./cards/model.js";
import { NeedChoice, Run, applyDamage, ask, coin, fireEndOfTurn, fireOnBenched, fireOnDamaged, fireOnEvolve, fireOnKnockedOut, newCtx, runEffect, validPicks } from "./interpreter.js";
import type { CheckupResult, EventOf } from "./events.js";
import { flip, makeRng, shuffle } from "./rng.js";
import { attackerBonus, maxHp } from "./rules.js";
import { withStaticSnapshot } from "./statics.js";
import {
  DEFAULT_RULES, type GameState, type PlayerId, type PokemonInPlay, type RulesConfig,
  cloneState, discardPokemon, drawEmit, emit, emptyFlags, expireMarkers, findPokemon, inPlay, mintCard,
  newPlayer, newPokemon, other, removeItem, setWinner, swapActive, topDef,
} from "./state.js";

// =============================================================== setup
export function createGame(deckA: CardDef[], deckB: CardDef[], seed: number, rules: Partial<RulesConfig> = {}): GameState {
  registerCards([...deckA, ...deckB]);
  const s: GameState = {
    seed, rng: makeRng(seed), nextId: 1, turn: 0, activePlayer: 0, firstPlayer: 0, phase: "mulliganAck",
    players: [newPlayer(), newPlayer()], events: [], rules: { ...DEFAULT_RULES, ...rules },
    setup: { mulls: [0, 0], acked: [false, false], benchDone: [false, false] },
  };
  ([deckA, deckB] as CardDef[][]).forEach((deck, pl) => {
    s.players[pl]!.deck = shuffle(deck.map((d) => mintCard(s, d.id)), s.rng);
  });
  s.firstPlayer = s.activePlayer = flip(s.rng) ? 0 : 1;
  emit(s, { type: "gameStart", seed, decks: [deckA.map((d) => d.id).sort(), deckB.map((d) => d.id).sort()], firstPlayer: s.firstPlayer });
  for (const pl of [0, 1] as PlayerId[]) drawEmit(s, pl, s.rules.handSize, "setup");
  // mulligan loop: reveal, reshuffle, redraw until a Basic is in hand
  for (const pl of [0, 1] as PlayerId[]) {
    const ps = s.players[pl];
    let guard = 0;
    while (!ps.hand.some((c) => isBasicPokemon(defOf(c)))) {
      if (++guard > 200) throw new Error("deck cannot produce a Basic Pokémon hand");
      s.setup!.mulls[pl]++;
      emit(s, { type: "mulligan", player: pl });
      ps.deck.push(...ps.hand); ps.hand = [];
      shuffle(ps.deck, s.rng);
      drawEmit(s, pl, s.rules.handSize, "setup");
    }
  }
  s.phase = "mulliganAck";
  advanceSetup(s);
  return s;
}

/** Move the setup state machine forward when its current step has nothing left to do. */
function advanceSetup(s: GameState): void {
  const su = s.setup!;
  if (s.phase === "mulliganAck") {
    if (([0, 1] as PlayerId[]).some((p) => su.mulls[p] > 0 && !su.acked[p])) return;
    const diff = su.mulls[0] - su.mulls[1];
    if (diff !== 0) {
      // net mulligans: the player who mulliganed less MAY draw that many extra cards
      const drawer: PlayerId = diff > 0 ? 1 : 0;
      const n = Math.abs(diff);
      s.phase = "mulliganDraw";
      s.pendingChoice = { player: drawer, kind: "mulliganDraw", options: Array.from({ length: n + 1 }, (_, i) => String(i)), min: 1, max: 1, prompt: "extra cards from opponent's mulligans" };
      return;
    }
    s.phase = "setupActive";
  }
  if (s.phase === "setupActive" && s.players[0].active && s.players[1].active) s.phase = "setupBench";
  if (s.phase === "setupBench" && su.benchDone[0] && su.benchDone[1]) finishSetup(s);
}
function finishSetup(s: GameState): void {
  for (const pl of [0, 1] as PlayerId[]) {
    const ps = s.players[pl];
    for (let i = 0; i < s.rules.prizeCount; i++) if (ps.deck.length) ps.prizes.push(ps.deck.shift()!);
  }
  s.setup = undefined;
  s.phase = "main";
  s.turn = 1;
  s.activePlayer = s.firstPlayer;
  emit(s, { type: "setupComplete" });
  beginTurn(s);
}

// =============================================================== turn loop
function beginTurn(s: GameState): void {
  const pl = s.activePlayer;
  const ps = s.players[pl];
  ps.flags = { ...emptyFlags(), gxUsed: ps.flags.gxUsed, vstarUsed: ps.flags.vstarUsed };
  for (const p of inPlay(ps)) { p.evolvedThisTurn = false; p.usedAbilities = []; }
  emit(s, { type: "turnStart", player: pl });
  if (drawEmit(s, pl, 1, "turn") === 0) setWinner(s, other(pl), "deckout");
}

function checkup(run: Run): void {
  const s = run.s;
  const ender = s.activePlayer;
  const actives = ([0, 1] as PlayerId[]).map((pl) => s.players[pl].active);
  const results: CheckupResult[] = [];
  const note = (pl: number, a: PokemonInPlay, kind: CheckupResult["kind"], damage?: number) =>
    results.push({ player: pl as PlayerId, pokemonId: a.iid, pokemonName: topDef(a).name, kind, ...(damage ? { damage } : {}) });
  actives.forEach((a, pl) => { if (a?.status.poisoned) { const d = applyDamage(s, a, 10, { wr: false }); note(pl, a, "poison", d); } });
  actives.forEach((a, pl) => {
    if (!a?.status.burned) return;
    const d = applyDamage(s, a, 20, { wr: false });
    note(pl, a, "burn", d);
    if (coin(s)) { a.status.burned = false; note(pl, a, "burnCured"); }
  });
  actives.forEach((a, pl) => { if (a?.status.asleep && coin(s)) { a.status.asleep = false; note(pl, a, "wokeUp"); } });
  // Paralysis ends at the end of the paralyzed Pokémon's controller's own turn.
  actives.forEach((a, pl) => { if (a?.status.paralyzed && pl === ender) { a.status.paralyzed = false; note(pl, a, "paralysisEnded"); } });
  if (results.length) emit(s, { type: "checkup", results });
}

/** Resolve all Knock Outs simultaneously: discard, prizes, win checks, then promotions (may ask). */
function resolveKOs(run: Run): void {
  const s = run.s;
  if (s.phase === "over") return;
  const collect = (): Array<[PlayerId, PokemonInPlay]> => {
    const out: Array<[PlayerId, PokemonInPlay]> = [];
    withStaticSnapshot(s, () => { for (const pl of [0, 1] as PlayerId[]) for (const p of inPlay(s.players[pl])) if (p.damage >= maxHp(s, p)) out.push([pl, p]); });
    return out;
  };
  let kos = collect();
  for (const [pl, p] of kos) fireOnKnockedOut(run, pl, p); // before removal; may add more damage
  kos = collect();
  for (const [pl, p] of kos) {
    const byAttack = pl !== s.activePlayer && !!run.attackKOs?.includes(p.iid);
    const prizes = prizeValueOf(topDef(p));
    const iid = p.iid, name = topDef(p).name;
    discardPokemon(s, pl, p);
    s.players[pl].lastKOTurn = s.turn;
    const opp = s.players[other(pl)];
    const take = Math.min(prizes, opp.prizes.length);
    opp.hand.push(...opp.prizes.splice(0, take));
    emit(s, { type: "ko", owner: pl, pokemonId: iid, pokemonName: name, byAttack, prizesTaken: take, takenBy: other(pl) });
    emit(s, { type: "prize", player: other(pl), count: take, remaining: opp.prizes.length });
  }
  const wins: Array<[PlayerId, string]> = [];
  for (const pl of [0, 1] as PlayerId[]) {
    if (kos.length && s.players[pl].prizes.length === 0) wins.push([pl, "prizes"]);
    const op = s.players[other(pl)];
    if (!op.active && !op.bench.length) wins.push([pl, "no-pokemon"]);
  }
  if (wins.length) {
    // both players satisfying a win condition at once = sudden death in the real rules; we award it to the player whose turn it is.
    const w = wins.find(([p]) => p === s.activePlayer) ?? wins[0]!;
    setWinner(s, w[0], w[1]);
    return;
  }
  for (const pl of [0, 1] as PlayerId[]) {
    const ps = s.players[pl];
    if (!ps.active && ps.bench.length) {
      const [pick] = ask(run, { player: pl, kind: "pokemon", options: ps.bench.map((b) => b.iid), min: 1, max: 1, prompt: "promote a new Active Pokémon" });
      swapActive(s, pl, pick!);
      emit(s, { type: "switch", player: pl, pokemonId: ps.active!.iid, pokemonName: topDef(ps.active!).name, reason: "promote" });
    }
  }
}

function endTurnSequence(run: Run): void {
  const s = run.s;
  if (s.phase === "over") return;
  fireEndOfTurn(run);
  expireMarkers(s);
  checkup(run);
  resolveKOs(run);
  if ((s.phase as string) === "over") return;
  s.turn++;
  s.activePlayer = other(s.activePlayer);
  beginTurn(s);
}

// =============================================================== action execution
function playTrainer(run: Run, pl: PlayerId, card: string, kind: "item" | "supporter"): void {
  const s = run.s, ps = s.players[pl];
  removeItem(ps.hand, card);
  emit(s, { type: "play", player: pl, cardId: card, cardName: defOf(card).name, kind });
  const entry = defOf(card).rules?.find((r) => r.trigger.t === "play");
  if (entry) {
    const ctx = newCtx(run, pl, kind);
    if (entry.trigger.t === "play" && entry.trigger.cost) runEffect(ctx, entry.trigger.cost); // cost is paid (via choices) before the effect
    runEffect(ctx, entry.effect);
  }
  ps.discard.push(card);
  resolveKOs(run);
}

function executeAttack(run: Run, pl: PlayerId, idx: number): void {
  const s = run.s;
  const atk = s.players[pl].active!;
  const a = topDef(atk).attacks![idx]!;
  const def = s.players[other(pl)].active;
  // pushed now (so effect/coin events follow it) and finished below once the damage is known
  const ev = { type: "attack", turn: s.turn, player: pl, attackerId: atk.iid, attackerName: topDef(atk).name, attackName: a.name,
    targetId: def?.iid ?? null, targetName: def ? topDef(def).name : null, damage: 0, ko: false } as EventOf<"attack">;
  s.events.push(ev);
  run.attackEvent = ev;
  if (atk.status.confused && !coin(s)) {
    const d = applyDamage(s, atk, 30, { wr: false });
    ev.failed = "confused";
    emit(s, { type: "damageCounters", player: pl, owner: pl, targetId: atk.iid, targetName: topDef(atk).name, amount: d / 10, source: "confusion" });
    return;
  }
  if (atk.markers.some((m) => m.key === "attackTry") && !coin(s)) { ev.failed = "attackTry"; return; }
  const ctx = newCtx(run, pl, "attack", { self: atk.iid });
  ctx.dmg = a.damage && a.damage > 0 ? a.damage : null;
  if (a.effect) runEffect(ctx, a.effect);
  const target = s.players[other(pl)].active;
  if (!ctx.cancelled && ctx.dmg !== null && target) {
    let raw = ctx.dmg + ctx.mods;
    if (raw > 0) raw += attackerBonus(s, atk, target);
    const dealt = applyDamage(s, target, raw, { attacker: atk, wr: true, byAttack: true, ignoreEffects: ctx.ignoreDefEffects });
    ev.damage = dealt;
    fireOnDamaged(run, atk, target, dealt);
  }
}

function execute(run: Run, a: Action): void {
  const s = run.s;
  const pl: PlayerId = s.activePlayer;
  const ps = s.players[pl];
  switch (a.type) {
    case "playBasicToBench":
      removeItem(ps.hand, a.card);
      const np = newPokemon(a.card, s.turn);
      ps.bench.push(np);
      emit(s, { type: "play", player: pl, cardId: a.card, cardName: defOf(a.card).name, kind: "basic" });
      fireOnBenched(run, np, pl, true);
      resolveKOs(run);
      return;
    case "evolve": {
      const t = findPokemon(s, a.target)!.p;
      removeItem(ps.hand, a.card);
      const fromId = t.iid, fromName = topDef(t).name;
      t.below.push(t.iid);
      t.iid = a.card;
      t.evolvedThisTurn = true;
      t.status = { asleep: false, paralyzed: false, confused: false, poisoned: false, burned: false };
      t.markers = []; t.usedAbilities = [];
      emit(s, { type: "evolve", player: pl, from: fromId, to: a.card, fromName, toName: defOf(a.card).name });
      fireOnEvolve(run, pl, t);
      resolveKOs(run);
      return;
    }
    case "attachEnergy": {
      removeItem(ps.hand, a.card);
      const host = findPokemon(s, a.target)!.p;
      host.energy.push(a.card);
      ps.flags.energyAttachedThisTurn = true;
      emit(s, { type: "attachEnergy", player: pl, cardId: a.card, cardName: defOf(a.card).name, targetId: host.iid, targetName: topDef(host).name, source: "hand" });
      return;
    }
    case "attachTool":
      removeItem(ps.hand, a.card);
      findPokemon(s, a.target)!.p.tool = a.card;
      emit(s, { type: "play", player: pl, cardId: a.card, cardName: defOf(a.card).name, kind: "tool", targetId: a.target });
      return;
    case "playItem": return playTrainer(run, pl, a.card, "item");
    case "playSupporter": ps.flags.supporterPlayedThisTurn = true; return playTrainer(run, pl, a.card, "supporter");
    case "playStadium":
      removeItem(ps.hand, a.card);
      if (s.stadium) s.players[s.stadium.owner].discard.push(s.stadium.iid);
      s.stadium = { iid: a.card, owner: pl };
      ps.flags.stadiumPlayedThisTurn = true;
      emit(s, { type: "play", player: pl, cardId: a.card, cardName: defOf(a.card).name, kind: "stadium" });
      return;
    case "useAbility": {
      const p = findPokemon(s, a.pokemon)!.p;
      const ab = topDef(p).abilities![a.abilityIndex]!;
      if (ab.limit === "oncePerGame") ps.usedGameAbilities.push(ab.name); else p.usedAbilities.push(ab.name);
      if (abilityIsNameLimited(ab)) ps.flags.abilityNamesUsed.push(ab.name);
      emit(s, { type: "ability", player: pl, pokemonId: p.iid, pokemonName: topDef(p).name, name: ab.name });
      const ctx = newCtx(run, pl, "ability", { self: p.iid });
      if (ab.trigger?.t === "ability" && ab.trigger.costToUse) runEffect(ctx, ab.trigger.costToUse); // cost first, via choices
      runEffect(ctx, ab.effect);
      resolveKOs(run);
      if (ctx.endTurn) endTurnSequence(run);
      return;
    }
    case "retreat": {
      ps.discard.push(...a.energyToDiscard);
      const old = ps.active!;
      old.energy = old.energy.filter((e) => !a.energyToDiscard.includes(e));
      if (a.energyToDiscard.length) emit(s, { type: "discard", player: pl, zone: "attached", cardIds: a.energyToDiscard.slice() });
      swapActive(s, pl, a.newActive);
      ps.flags.retreatedThisTurn = true;
      emit(s, { type: "switch", player: pl, pokemonId: ps.active!.iid, pokemonName: topDef(ps.active!).name, replacedId: old.iid, reason: "retreat" });
      return;
    }
    case "attack":
      executeAttack(run, pl, a.attackIndex);
      run.attackKOs = [];
      const kos = run.attackKOs;
      withStaticSnapshot(s, () => { for (const q of [0, 1] as PlayerId[]) for (const p of inPlay(s.players[q])) if (p.damage >= maxHp(s, p)) kos.push(p.iid); });
      if (run.attackEvent?.targetId) run.attackEvent.ko = run.attackKOs.includes(run.attackEvent.targetId);
      resolveKOsThenEnd(run);
      return;
    case "endTurn": endTurnSequence(run); return;
    default: throw new Error(`cannot execute ${a.type} in main phase`);
  }
}
function resolveKOsThenEnd(run: Run): void { endTurnSequence(run); }

// =============================================================== public step function
export interface ApplyOptions {
  /** Skip the legality check. Only for drivers that took `action` straight from `legalActions(state, ...)` on this unmodified state (see `wasIssued`). */
  trusted?: boolean;
}
export function applyAction(state: GameState, action: Action, opts: ApplyOptions = {}): GameState {
  if (state.phase === "over") throw new Error("game is over");
  const who = decider(state);
  if (who === null) throw new Error("no decider");
  if (!opts.trusted) validate(state, action, who);
  if (action.type === "choose") return applyChoose(state, action);
  switch (action.type) {
    case "mulliganAck": case "chooseActive": case "chooseBench": return applySetup(state, action, who);
    default: return runOrPend(state, action, ("choices" in action ? action.choices : undefined) ?? []);
  }
}

function validate(s: GameState, a: Action, who: PlayerId): void {
  if (a.type === "choose") {
    const pc = s.pendingChoice;
    if (!pc) throw new Error("no pending choice");
    if (!validPicks(pc, a.picks)) throw new Error(`invalid picks ${JSON.stringify(a.picks)}`);
    return;
  }
  if (!enumerate(s, who, false).some((x) => sameAction(x, a))) throw new Error(`illegal action: ${JSON.stringify(a)}`);
}

function runOrPend(base: GameState, action: Action, answers: string[][]): GameState {
  const s = cloneState(base);
  s.pendingChoice = undefined;
  const run: Run = { s, answers, idx: 0 };
  try {
    execute(run, action);
    return s;
  } catch (e) {
    if (!(e instanceof NeedChoice)) throw e;
    s.pendingChoice = { ...e.req, origin: { action, answers: answers.slice(0, run.idx), base } };
    return s;
  }
}

function applyChoose(state: GameState, a: Extract<Action, { type: "choose" }>): GameState {
  const pc = state.pendingChoice!;
  if (!pc.origin) {
    // setup-phase choice (mulligan extra draw): not replayed
    const s = cloneState(state);
    s.pendingChoice = undefined;
    const n = Number(a.picks[0]);
    drawEmit(s, pc.player, n, "mulligan");
    s.phase = "setupActive";
    advanceSetup(s);
    return s;
  }
  return runOrPend(pc.origin.base, pc.origin.action, [...pc.origin.answers, a.picks]);
}

function applySetup(state: GameState, a: Action, who: PlayerId): GameState {
  const s = cloneState(state);
  const su = s.setup!;
  const ps = s.players[who];
  if (a.type === "mulliganAck") su.acked[who] = true;
  else if (a.type === "chooseActive") { removeItem(ps.hand, a.card); ps.active = newPokemon(a.card, 0); }
  else if (a.type === "chooseBench") {
    if (a.card) { removeItem(ps.hand, a.card); ps.bench.push(newPokemon(a.card, 0)); }
    else su.benchDone[who] = true;
    if (ps.bench.length >= s.rules.benchSize) su.benchDone[who] = true;
  }
  advanceSetup(s);
  return s;
}

export { defIdOf, hasSub };
