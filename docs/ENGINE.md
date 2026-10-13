# Engine rules spec & implementation notes

## Rules spec (Standard)

- **Decks**: 60 cards, max 4 copies per card name (basic Energy exempt), at least one Basic Pokémon (`validateDeck`).
- **Setup**: shuffle, draw 7. Coin flip decides who goes first. A player with no Basic Pokémon in hand reveals,
  shuffles the hand back and redraws 7 (a *mulligan*; repeat as needed). The player with fewer mulligans **may**
  draw extra cards equal to the difference in mulligan counts. Each player places one Basic as Active and up to 5 Basics
  on the Bench, then sets aside the top 6 cards as Prizes. The first player then starts turn 1.
- **First-turn restrictions** (flags in `RulesConfig`): the player who goes first cannot attack on their first turn
  (`noAttackOnFirstTurnOfGame`) and cannot play a Supporter on it (`noSupporterOnFirstTurnOfGame`); neither player can
  evolve on their own first turn (`noEvolveOnFirstTurn`).
- **Turn**: draw a card (a player who cannot draw **loses**) → main phase, in any order: attach 1 Energy from hand, play
  Basics to the Bench (max 5), evolve (not a Pokémon played or evolved this turn), any number of Items, 1 Supporter,
  1 Stadium (not the same name as the Stadium in play), attach Tools (1 per Pokémon), use Abilities (respecting their
  limits), 1 retreat → optionally attack. **An attack ends the turn**; `endTurn` without attacking is also allowed.
- **Attack cost**: attached Energy provides its type(s); Colorless cost is payable by any Energy.
- **Retreat**: discard Energy equal to the retreat cost, swap with a Benched Pokémon; once per turn; not while Asleep/Paralyzed.
- **Pokémon Checkup** (after every turn, both players' Active Pokémon): Poisoned +10 damage; Burned +20 damage then a coin —
  heads cures; Asleep: coin — heads wakes; Paralyzed: removed at the end of the **paralyzed Pokémon's controller's own
  turn** (so it survives the opponent's turn that applied it, blocks that player's next turn, and clears after it).
- **Status conditions**: Asleep, Paralyzed and Confused are mutually exclusive (a new one replaces the old); Poisoned and Burned
  stack with them. Asleep/Paralyzed: cannot attack or retreat. Confused: attacking needs a coin — tails: the attack fails and the
  Pokémon puts 30 damage on itself. All statuses are removed when a Pokémon leaves the Active spot or evolves.
- **Damage**: weakness ×2 and resistance −30 apply only to attack damage dealt to the opponent's **Active** Pokémon (never
  Benched, unless a card says so), after "+N" modifiers, before prevention/reduction. Tool damage bonuses apply only when the
  attack already does damage and before weakness.
- **Knock Out**: damage ≥ HP. KOs are resolved *after* the Checkup, simultaneously: the Pokémon and everything attached go to
  its owner's discard pile; the opponent takes Prizes (1; Pokémon ex 2; Mega ex 3) into hand; then an owner whose Active was
  KO'd promotes a Benched Pokémon (a choice).
- **Win**: take your last Prize; the opponent has no Pokémon in play; or the opponent cannot draw at the start of their turn.
  *Simplification*: if both players satisfy a win condition at once (real rules: sudden death) the player whose turn it is wins.

### First-turn Supporter rule — verify against the current rulebook

Default `noSupporterOnFirstTurnOfGame: true`. Source: Bulbapedia, *Supporter card (TCG)* —
"Beginning with the Sword & Shield Series, the player who goes first cannot play a Supporter card on their first turn."
(<https://bulbapedia.bulbagarden.net/wiki/Supporter_card_(TCG)>). A single web search plus that page found **no evidence of a
2026 change**, but Bulbapedia is a secondary source and does not give a date; confirm against the official Pokémon TCG
rulebook (pokemon.com) before relying on it. It is a flag precisely so a rules change is a one-line default switch.

## Implementation notes

### State & purity
`GameState` is plain JSON (no classes, no functions). Card instances are strings `"<defId>#<n>"`; `defOf(iid)` resolves the
immutable `CardDef` via a registry filled by `createGame`/`registerCards` (defs are data, so this does not break purity).
`applyAction(state, action)` validates the action against the legal set, deep-clones the state, mutates the clone and returns
it — the input is never touched. See *Performance* below for how the clone is made cheap.

### The choice model (resumable interpreter)
Effects often need decisions (which Pokémon to gust, which card to search). The interpreter never calls back out. Instead:

1. `ask(run, request)` returns a recorded answer if one exists; if the decision is forced (`min >= options`) it answers itself;
   otherwise it throws `NeedChoice`.
2. `applyAction` catches it and returns the *partially resolved* state with `state.pendingChoice =
   {player, kind, options, min, max, prompt, origin}`. `origin` holds the originating action, the answers recorded so far, and the
   pre-action snapshot `base`.
3. `legalActions(state, pendingChoice.player)` returns `{type:"choose", picks}` actions (all subsets with `min ≤ size ≤ max`;
   identical-name cards are deduped; capped at 256 combos). Nobody else has actions.
4. `applyAction(state, choose)` **replays** the originating action from `origin.base` with the answers `[...answers, picks]`.
   Because the RNG state is part of `base`, replays are exactly deterministic (same coin flips, same shuffles), so the process
   needs no continuations. Multi-step decisions simply chain (each `choose` may produce another pending choice).

Everything that can ask lives inside one "origin action" — including the post-attack Checkup, KO promotion and the next
turn's start — so a mid-turn promotion or a Checkup-time decision uses the same mechanism. Callers may also pre-supply answers:
`playSupporter`/`playItem`/`useAbility`/`attack` accept `choices: string[][]` (one pick-list per decision, in order).
`mulliganDraw` is the only non-replayed choice (setup phase). Choice kinds: `pokemon` (options are Pokémon ids), `cards`,
`option` (index of a `choose` effect branch, an attack index, or a number), `yesno`, `mulliganDraw` (options `"0".."n"`), `distribute` (see below).

### Interpreter coverage
Implemented: `seq if optional repeat choose bind forEach cost`, `damage damageMod selfDamage heal counters knockOut`, `flip status
clearStatus`, `draw search discard move look reveal shuffle attachEnergy moveEnergy putOnBench returnToHand switch`, `lock prevent
modify(hp|retreat|damageDealt|damageTaken) retreatCost tag endTurn noop`, all `Amount`s and `Condition`s. Attack damage model:
printed damage (null = none) + `damage`-to-Defending nodes + `damageMod`s form one pool, then Tool bonus, then weakness/
resistance, then prevention markers. `noop` inside an attack cancels its damage. Bench damage uses `weakRes: false`.
Persistent effects are *markers* with expiry (`thisTurn`, `oppNextTurn`, `yourNextTurn`, `whileInPlay`) on Pokémon or players.
Tools and Stadiums contribute through `static` entries (`modify hp|retreat|damageDealt|damageTaken`).

`notImplemented`: effect nodes `evolve`, `useAgain`; `modify` stats `weakness|typeProvided|attackCost|toolSlots`; triggers
`wouldKO`/`betweenTurns` and special-Energy `attach` effects. These throw a descriptive error when reached. Milestone 2 features follow.

### M2 features (part 2a)
- **copyAttack** (`{e:"copyAttack", from, filter?}`): `from` selects the source Pokémon (a `pick` asks the player), then the player
  picks one of its attacks (`option` choice, auto if only one). The copied attack's printed damage replaces the pool and its effect runs
  in the *copier's* context (copier's type for weakness, copier's bonuses), without checking/paying the copied cost. Attacks that
  themselves contain `copyAttack` are not offered, and a Pokémon whose attacks are all like that (another Zoroark ex with only Night Joker)
  is not offered as a source either (`selectPokemon`'s `accept` filter); `ctx.copying` makes a nested copy a no-op (recursion guard).
- **Triggers** (all run through the normal choice/replay model; helpers `fireOn*` in interpreter.ts): `onPlayToBench{fromHand:true}`
  fires on a Basic played from hand (silenced by Ability locks); `fromHand:false` entries fire for effect placements (`putOnBench`,
  `search`/`move` to bench). `onPutOnBench{whose,filter}` fires on Pokémon, attached Tool and Stadium rules for any bench placement
  made during the placing player's own turn and supplies ref `benched`. `onDamaged` fires after an opponent's attack deals > 0 to a
  Pokémon (`active`: only while Active; `evenIfKO`) and supplies ref `attacker`. `onKnockedOut{byAttack}` fires in `resolveKOs`
  before removal (a KO counts as "by attack" if the Pokémon was lethally damaged right after an attack and the attacker is the
  opponent); supplies `attacker`. `onEvolve` fires after evolving from hand. `endOfTurn{whose}` fires when the active player's turn ends
  (before markers expire and before Checkup); `whose` is relative to the rule owner. Tools' and Stadiums' rules are collected too.
- **Static effects** (`src/statics.ts`): board state is never cached (only the per-card list of static entries, which is immutable data;
  see *Performance* for the read-only scope cache). `staticStat` (numeric `modify` and `retreatCost` deltas, resolved over the
  entry's selector), `staticPreventsDamage` (`prevent from damage|both`, applies to damage done *by attacks* only, so counters,
  poison, burn and confusion are unaffected) and `abilityLocked` (`lock ability{filter}` plus the temporary global `noAbility`
  marker) re-scan Pokémon (with their `while` condition), attached Tools and the Stadium on every call. A Stadium's `self` /
  `attached-to` modify applies to every Pokémon in play. Used by `maxHp`, `retreatCostOf`, `attackerBonus`, `applyDamage`, `legalActions`.
- **Trainer `requires` / `cost`**: `legalActions` hides a Trainer unless `play.requires` holds and any cost can be paid
  (`play.cost`, or a top-level `{e:"cost"}` wrapper: discards are counted, excluding the played card itself). `play.cost` is run via
  the choice model before the effect. `Player.lastKOTurn` records "a Pokémon of mine was Knocked Out" for `koLastTurn`.
- **Abilities**: `trigger.costToUse` is checked for payability in `legalActions` and run first when used.
  `oncePerNamePerTurn` (on `trigger.limit` or `limit`) records the name in `flags.abilityNamesUsed` (reset each turn) so only one
  Pokémon may use an ability of that name per turn; `oncePerTurn` stays per Pokémon. The "Last-Ditch" family uses the new
  `tag` (player-level marker) + `{c:"tagged"}` condition.
- **validateDeck**: also rejects more than one ACE SPEC (`AceSpec` subtype).
- **New nodes**: `moveCounters{from,to,n}` (n may be `upTo`; the count is a choice capped by counters present, placed = removed);
  `searchSplit{filter,upTo,distinct,a,b}` (sequential picks that obey the `distinct` type/name constraint, then one to hand and the
  other attached to `b.attachTo`); `modify.againstFilter` (damageDealt marker that only applies if the Defending Pokémon matches at
  damage time); `move.shuffleFirst`; `move` of in-play Pokémon (`zone: play|active|bench` with `from`) moves the whole stack
  (Pokémon, evolutions, Energy, Tool) and clears the slot.
- **`damage{effects:false}`**: the attack's damage skips defender markers (`preventDamage`, `mod:damageTaken`) and static
  prevention/modifiers; weakness/resistance still apply.
- **`distribute` choice** (counters with `distribute:true` over several targets): options are target ids, `min = max = N`, each pick
  is `"<id>=<count>"` (counts >= 1, total = N, ids unique). `legalActions` enumerates all compositions (cap 512); `randomAgent`
  assigns each counter uniformly at random.

### Other design decisions
- Damage is stored in HP points (multiples of 10 = counters). `turn` is a global counter (turn 1 = first player's first turn).
- Setup is a sequential state machine (`mulliganAck → mulliganDraw → setupActive → setupBench → main`); placement is not hidden.
- `observe(state, viewer)` redacts opponent hand/decks/prizes to counts and hides option lists of the opponent's pending choices. Its `events` copy
  hides the opponent's decklist (`gameStart`), drawn card ids (`draw`) and unrevealed searches (`search`).
- `randomAgent(state, rng, {attackBias})` takes a legal attack with probability `attackBias` (default 0.7), else uniform.

## Event stream (`src/events.ts`)

`GameState.events: GameEvent[]` is the append-only, typed record of a game; it replaced the old prose `log: string[]`. Every event is a
member of the discriminated union `GameEvent` (tag `type`) and carries `turn` (the global turn counter; 0 during setup). Cards are
identified by stable instance ids (`"<defId>#<n>"`, unique within a game) plus printed names, so analytics can follow one card through a game
and group by name. The stream is plain JSON, deterministic per seed, and identical between replays of a choice (replayed actions re-run
from the `base` snapshot, so partially-resolved states never leak events into later ones).

| type | fields (besides `turn`) | emitted when |
|---|---|---|
| `gameStart` | `seed, decks, firstPlayer` | game created (`decks`: sorted card def ids per player) |
| `mulligan` | `player` | each mulligan during setup |
| `setupComplete` | | Prizes set, turn 1 about to start |
| `turnStart` | `player` | a turn begins (before its draw) |
| `draw` | `player, count, cardIds, reason` | `reason`: `setup`, `turn`, `effect`, `mulligan` (extra cards) |
| `coin` | `heads` | every coin flip |
| `play` | `player, cardId, cardName, kind, targetId?` | `kind`: `basic` (bench from hand), `item`, `supporter`, `stadium`, `tool` (`targetId` = host) |
| `putOnBench` | `player, pokemonId, pokemonName` | a Basic placed on the Bench by an effect |
| `evolve` | `player, from, to, fromName, toName` | evolve from hand |
| `attachEnergy` | `player, cardId, cardName, targetId, targetName, source` | `source`: `hand` (manual) or `effect` |
| `ability` | `player, pokemonId, pokemonName, name` | an Ability is used |
| `attack` | `player, attackerId, attackerName, attackName, targetId, targetName, damage, ko, copied?, failed?` | pushed when the attack starts (so its coin flips and effects follow it) and finished once resolved: `damage` dealt to the Defending Pokémon after weakness/effects, `ko` = it was Knocked Out by this attack, `copied` = name of the attack a copy effect used (Night Joker), `failed` = `confused` / `attackTry` |
| `damageCounters` | `player, owner, targetId, targetName, amount, source` | counters placed (+) or removed (-) by effects, bench damage, self damage, confusion; `source` tells which |
| `ko` | `owner, pokemonId, pokemonName, byAttack, prizesTaken, takenBy` | each Knock Out (followed immediately by its `prize`) |
| `prize` | `player, count, remaining` | Prizes taken |
| `switch` | `player, pokemonId, pokemonName, replacedId?, reason` | new Active: `retreat`, `gust` (opponent's Pokémon switched by an effect), `promote` (after a KO), `effect` |
| `status` | `player, pokemonId, pokemonName, condition` | a Special Condition is applied (`player` = its owner) |
| `checkup` | `results[]` | Pokémon Checkup outcomes (`poison`/`burn` damage, `burnCured`, `wokeUp`, `paralysisEnded`); omitted if nothing happened |
| `search` / `discard` / `reveal` | `player, zone, cardIds, ...` | deck/zone searches, discards, revealed cards |
| `moveInPlay` | `player, pokemonId, pokemonName, to, cardCount` | a whole Pokémon stack moved off the board |
| `gameEnd` | `winner, reason, turns` | winner set; `playGame` also appends one with `winner: null` for `maxTurns` / `actionLimit` |

Helpers: `formatEvent(e)` renders one event as a line, `logText(state)` the whole stream (what tests use when they want strings).
`src/sim.ts` derives every statistic from the stream and nothing else: `statsFromEvents(events)` gives per-player KOs, prizes taken, attacks,
zero-damage attacks and damage dealt; `keyEffectUses(events)` counts the key attacks/abilities (Last-Ditch Catch = a `play` of `Meowth ex`
immediately followed by a `search`). `GameResult` holds `seed, winner, reason, turns, events, decks, stats`. `exportGamesJsonl(results, path)`
(CLI: `scripts/sim.mjs ... --jsonl <path>`) writes one line per game, `{seed, decks, winner, reason, turns, events}`, for offline analytics.

## Performance

Greedy-vs-greedy Dragapult vs Zoroark runs at about 100 games/s per core (`node scripts/bench.mjs`), up from about 30. What changed, in order
of effect, all behaviour-preserving (`src/test/golden.test.ts` replays 50 seeds against `src/test/fixtures/golden-50.json`, generated before
the speed pass, and demands identical winner, reason and turn count):

1. **Exceptions are not free: keep the frames between `ask` and `runOrPend` small.** A pending choice is a throw, and V8's unwind cost grows
   with the size of every function it passes through (a ~400-line `runEffect` switch cost ~70 µs per throw, about 17% of runtime). Heavy
   effect cases are now separate `run_<effect>` functions; the recursive dispatcher is small, and a throw costs ~14 µs. `NeedChoice` is a plain
   object, not an `Error`, so no stack is captured. Keep new effects out of the `runEffect` switch body.
2. **Static sources.** `statics.ts` memoizes each card's list of `static` entries (immutable data), so scanning a board of cards with no
   statics is a few pointer reads, and `withStaticSnapshot(s, fn)` computes the live sources once for a *read-only* scope (all of `enumerate`,
   the KO sweep). The cache is dropped when the scope ends; nothing is cached across state changes, so effects still stop the moment their
   source leaves play. Do not mutate the board inside a snapshot scope.
3. **Cloning.** `cloneState` copies field by field (card-id lists via `slice`) instead of a generic deep clone, and shares what is immutable once
   created: event objects, markers, `rules`, `stadium`, `pendingChoice` with its `origin.base` snapshot. `enumerate`'s condition scratch is a
   shallow copy with its own rng and event list rather than a full clone. A test checks the clone equals a deep clone and that mutating it
   never leaks into the source. Further structural sharing (untouched players/zones) is possible but cloning is now ~2% of a profile.
4. **Lookups.** `defOf` memoizes iid to `CardDef`; `defIdOf` reads it from the def; `hasSub`/`norm` no longer allocate or run regexes per call.
5. **Validation.** `applyAction` still checks every action against the legal set. `playGame` passes `{trusted: true}` only when the action is,
   by identity, one `legalActions` returned for that exact state object (`wasIssued`), skipping a duplicate enumeration. Any other caller,
   and any agent that builds its own action object, is fully validated. `sameAction` replaced JSON-key comparison.

Profile with `node --cpu-prof scripts/bench.mjs 100`. Remaining cost is mostly garbage collection (~15%), enumeration, and the replay model
(each choice re-runs its action from the snapshot).
