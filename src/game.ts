import type { Action } from "./actions.js";
import { abilityIsNameLimited, actionKey, decider, enumerate } from "./actions.js";
import { defIdOf, defOf, hasSub, isBasicPokemon, prizeValueOf, registerCards, type CardDef } from "./cards/model.js";
import { NeedChoice, Run, applyDamage, ask, coin, fireEndOfTurn, fireOnBenched, fireOnDamaged, fireOnEvolve, fireOnKnockedOut, newCtx, runEffect, validPicks } from "./interpreter.js";
import { flip, makeRng, shuffle } from "./rng.js";
import { attackerBonus, maxHp } from "./rules.js";
import {
  DEFAULT_RULES, type GameState, type PlayerId, type PokemonInPlay, type RulesConfig,
  cloneState, discardPokemon, drawCards, emptyFlags, expireMarkers, findPokemon, inPlay, log, mintCard,
  newPlayer, newPokemon, other, removeItem, setWinner, swapActive, topDef,
} from "./state.js";

// =============================================================== setup
export function createGame(deckA: CardDef[], deckB: CardDef[], seed: number, rules: Partial<RulesConfig> = {}): GameState {
  registerCards([...deckA, ...deckB]);
  const s: GameState = {
    seed, rng: makeRng(seed), nextId: 1, turn: 0, activePlayer: 0, firstPlayer: 0, phase: "mulliganAck",
    players: [newPlayer(), newPlayer()], log: [], rules: { ...DEFAULT_RULES, ...rules },
    setup: { mulls: [0, 0], acked: [false, false], benchDone: [false, false] },
  };
  ([deckA, deckB] as CardDef[][]).forEach((deck, pl) => {
    s.players[pl]!.deck = shuffle(deck.map((d) => mintCard(s, d.id)), s.rng);
  });
  s.firstPlayer = s.activePlayer = flip(s.rng) ? 0 : 1;
  log(s, `P${s.firstPlayer} goes first`);
  for (const pl of [0, 1] as PlayerId[]) drawCards(s, pl, s.rules.handSize);
  // mulligan loop: reveal, reshuffle, redraw until a Basic is in hand
  for (const pl of [0, 1] as PlayerId[]) {
    const ps = s.players[pl];
    let guard = 0;
    while (!ps.hand.some((c) => isBasicPokemon(defOf(c)))) {
      if (++guard > 200) throw new Error("deck cannot produce a Basic Pokémon hand");
      s.setup!.mulls[pl]++;
      log(s, `P${pl} mulligans (reveals hand)`);
      ps.deck.push(...ps.hand); ps.hand = [];
      shuffle(ps.deck, s.rng);
      drawCards(s, pl, s.rules.handSize);
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
  log(s, "setup complete");
  beginTurn(s);
}

// =============================================================== turn loop
function beginTurn(s: GameState): void {
  const pl = s.activePlayer;
  const ps = s.players[pl];
  ps.flags = { ...emptyFlags(), gxUsed: ps.flags.gxUsed, vstarUsed: ps.flags.vstarUsed };
  for (const p of inPlay(ps)) { p.evolvedThisTurn = false; p.usedAbilities = []; }
  if (drawCards(s, pl, 1) === 0) { setWinner(s, other(pl), "deckout"); return; }
  log(s, `P${pl} turn begins`);
}

function checkup(run: Run): void {
  const s = run.s;
  const ender = s.activePlayer;
  const actives = ([0, 1] as PlayerId[]).map((pl) => s.players[pl].active);
  actives.forEach((a, pl) => { if (a?.status.poisoned) { applyDamage(s, a, 10, { wr: false }); log(s, `P${pl} ${topDef(a).name} poison 10`); } });
  actives.forEach((a, pl) => {
    if (!a?.status.burned) return;
    applyDamage(s, a, 20, { wr: false });
    log(s, `P${pl} ${topDef(a).name} burn 20`);
    if (coin(s)) a.status.burned = false;
  });
  actives.forEach((a) => { if (a?.status.asleep && coin(s)) a.status.asleep = false; });
  // Paralysis ends at the end of the paralyzed Pokémon's controller's own turn.
  actives.forEach((a, pl) => { if (a?.status.paralyzed && pl === ender) a.status.paralyzed = false; });
}

/** Resolve all Knock Outs simultaneously: discard, prizes, win checks, then promotions (may ask). */
function resolveKOs(run: Run): void {
  const s = run.s;
  if (s.phase === "over") return;
  const collect = (): Array<[PlayerId, PokemonInPlay]> => {
    const out: Array<[PlayerId, PokemonInPlay]> = [];
    for (const pl of [0, 1] as PlayerId[]) for (const p of inPlay(s.players[pl])) if (p.damage >= maxHp(s, p)) out.push([pl, p]);
    return out;
  };
  let kos = collect();
  for (const [pl, p] of kos) fireOnKnockedOut(run, pl, p); // before removal; may add more damage
  kos = collect();
  for (const [pl, p] of kos) {
    log(s, `P${pl} ${topDef(p).name} is Knocked Out`);
    const prizes = prizeValueOf(topDef(p));
    discardPokemon(s, pl, p);
    s.players[pl].lastKOTurn = s.turn;
    const opp = s.players[other(pl)];
    const take = Math.min(prizes, opp.prizes.length);
    opp.hand.push(...opp.prizes.splice(0, take));
    log(s, `P${other(pl)} takes ${take} prize(s)`);
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
      log(s, `P${pl} promotes ${topDef(ps.active!).name}`);
    }
  }
}

function endTurnSequence(run: Run): void {
  const s = run.s;
  if (s.phase === "over") return;
  log(s, `P${s.activePlayer} ends turn`);
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
  log(s, `P${pl} plays ${defOf(card).name}`);
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
  log(s, `P${pl} ${topDef(atk).name} uses ${a.name}`);
  if (atk.status.confused && !coin(s)) {
    applyDamage(s, atk, 30, { wr: false });
    log(s, "confused: attack fails, 30 damage to itself");
    return;
  }
  if (atk.markers.some((m) => m.key === "attackTry") && !coin(s)) { log(s, "attack fails"); return; }
  const ctx = newCtx(run, pl, "attack", { self: atk.iid });
  ctx.dmg = a.damage && a.damage > 0 ? a.damage : null;
  if (a.effect) runEffect(ctx, a.effect);
  const target = s.players[other(pl)].active;
  if (!ctx.cancelled && ctx.dmg !== null && target) {
    let raw = ctx.dmg + ctx.mods;
    if (raw > 0) raw += attackerBonus(s, atk, target);
    const dealt = applyDamage(s, target, raw, { attacker: atk, wr: true, byAttack: true, ignoreEffects: ctx.ignoreDefEffects });
    log(s, `${topDef(target).name} takes ${dealt}`);
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
      log(s, `P${pl} benches ${defOf(a.card).name}`);
      fireOnBenched(run, np, pl, true);
      resolveKOs(run);
      return;
    case "evolve": {
      const t = findPokemon(s, a.target)!.p;
      removeItem(ps.hand, a.card);
      t.below.push(t.iid);
      t.iid = a.card;
      t.evolvedThisTurn = true;
      t.status = { asleep: false, paralyzed: false, confused: false, poisoned: false, burned: false };
      t.markers = []; t.usedAbilities = [];
      log(s, `P${pl} evolves into ${defOf(a.card).name}`);
      fireOnEvolve(run, pl, t);
      resolveKOs(run);
      return;
    }
    case "attachEnergy": {
      removeItem(ps.hand, a.card);
      findPokemon(s, a.target)!.p.energy.push(a.card);
      ps.flags.energyAttachedThisTurn = true;
      log(s, `P${pl} attaches ${defOf(a.card).name}`);
      return;
    }
    case "attachTool":
      removeItem(ps.hand, a.card);
      findPokemon(s, a.target)!.p.tool = a.card;
      log(s, `P${pl} attaches tool ${defOf(a.card).name}`);
      return;
    case "playItem": return playTrainer(run, pl, a.card, "item");
    case "playSupporter": ps.flags.supporterPlayedThisTurn = true; return playTrainer(run, pl, a.card, "supporter");
    case "playStadium":
      removeItem(ps.hand, a.card);
      if (s.stadium) s.players[s.stadium.owner].discard.push(s.stadium.iid);
      s.stadium = { iid: a.card, owner: pl };
      ps.flags.stadiumPlayedThisTurn = true;
      log(s, `P${pl} plays stadium ${defOf(a.card).name}`);
      return;
    case "useAbility": {
      const p = findPokemon(s, a.pokemon)!.p;
      const ab = topDef(p).abilities![a.abilityIndex]!;
      if (ab.limit === "oncePerGame") ps.usedGameAbilities.push(ab.name); else p.usedAbilities.push(ab.name);
      if (abilityIsNameLimited(ab)) ps.flags.abilityNamesUsed.push(ab.name);
      log(s, `P${pl} uses ability ${ab.name}`);
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
      swapActive(s, pl, a.newActive);
      ps.flags.retreatedThisTurn = true;
      log(s, `P${pl} retreats to ${topDef(ps.active!).name}`);
      return;
    }
    case "attack":
      executeAttack(run, pl, a.attackIndex);
      run.attackKOs = [];
      for (const q of [0, 1] as PlayerId[]) for (const p of inPlay(s.players[q])) if (p.damage >= maxHp(s, p)) run.attackKOs.push(p.iid);
      resolveKOsThenEnd(run);
      return;
    case "endTurn": endTurnSequence(run); return;
    default: throw new Error(`cannot execute ${a.type} in main phase`);
  }
}
function resolveKOsThenEnd(run: Run): void { endTurnSequence(run); }

// =============================================================== public step function
export function applyAction(state: GameState, action: Action): GameState {
  if (state.phase === "over") throw new Error("game is over");
  const who = decider(state);
  if (who === null) throw new Error("no decider");
  validate(state, action, who);
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
  const k = actionKey(a);
  if (!enumerate(s, who, false).some((x) => actionKey(x) === k)) throw new Error(`illegal action: ${JSON.stringify(a)}`);
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
    const drawn = drawCards(s, pc.player, n);
    log(s, `P${pc.player} draws ${drawn} extra card(s) from mulligans`);
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
  if (a.type === "mulliganAck") { su.acked[who] = true; log(s, `P${who} reveals hand after mulligan`); }
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
