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
it — the input is never touched. *Perf (future work)*: whole-state deep clone per action is simple but O(state); structural
sharing or an undo log would help for large-scale search. A random game of ~35 turns takes ~10 ms today.

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
`option` (index of a `choose` effect branch), `yesno`, `mulliganDraw` (options `"0".."n"`).

### Interpreter coverage
Implemented: `seq if optional repeat choose bind forEach cost`, `damage damageMod selfDamage heal counters knockOut`, `flip status
clearStatus`, `draw search discard move look reveal shuffle attachEnergy moveEnergy putOnBench returnToHand switch`, `lock prevent
modify(hp|retreat|damageDealt|damageTaken) retreatCost tag endTurn noop`, all `Amount`s and `Condition`s. Attack damage model:
printed damage (null = none) + `damage`-to-Defending nodes + `damageMod`s form one pool, then Tool bonus, then weakness/
resistance, then prevention markers. `noop` inside an attack cancels its damage. Bench damage uses `weakRes: false`.
Persistent effects are *markers* with expiry (`thisTurn`, `oppNextTurn`, `yourNextTurn`, `whileInPlay`) on Pokémon or players.
Tools and Stadiums contribute through `static` entries (`modify hp|retreat|damageDealt|damageTaken`).

`notImplemented`: effect nodes `evolve`, `copyAttack`, `useAgain`; `modify` stats `weakness|typeProvided|attackCost|toolSlots`;
triggers `onKnockedOut/onDamaged/wouldKO/onEvolve/onPlayToBench/endOfTurn` (parsed but never fired); special-Energy `attach`
effects. These are reached only by cards that use them, and throw a descriptive error rather than silently misplaying.

### Other design decisions
- Damage is stored in HP points (multiples of 10 = counters). `turn` is a global counter (turn 1 = first player's first turn).
- Setup is a sequential state machine (`mulliganAck → mulliganDraw → setupActive → setupBench → main`); placement is not hidden.
- `observe(state, viewer)` redacts opponent hand/decks/prizes to counts and hides option lists of the opponent's pending choices.
- `randomAgent(state, rng, {attackBias})` takes a legal attack with probability `attackBias` (default 0.7), else uniform.
