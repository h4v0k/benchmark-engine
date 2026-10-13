# M2 gaps: what remains after Milestone 2 (part 2b)

Milestone 2 is complete: both real decks (38 distinct cards) play end to end. Per-card behaviour tests: `src/test/cards.test.ts`;
real-deck simulations: `src/test/realdecks.test.ts` and `scripts/sim.mjs`. What follows is everything still open.

## Not implemented (used by none of the 38 cards)
- Effect nodes `evolve` (effect-driven evolution, e.g. Rare Candy), `useAgain`; `modify` stats `weakness`, `typeProvided`, `attackCost`, `toolSlots` (throw `notImplemented`).
- Triggers `wouldKO` and `betweenTurns` (parse, never fire); special-Energy `attach` effects.
- `copyAttack.viaDiscardTop`.

## Known approximations
- `onKnockedOut` "by attack" is detected as "lethal right after the attack"; Pokémon Knocked Out only by an `onKnockedOut` effect's own damage do not fire their trigger.
- `onPutOnBench` only fires for placements during the placing player's own turn (what Risky Ruins needs); setup placement never fires.
- Meowth ex's `onPlayToBench` rule is silenced by Ability locks (it is an Ability in print) and uses the `last-ditch` tag for the name limit.
- Stadium numeric `modify` with `self`/`attached-to` applies to every Pokémon in play (legacy semantics used by the test cards).
- Damage `modify`/`damageDealt` markers are removed from a Pokémon when it leaves the Active Spot.
- "Prevent all effects of attacks" (`preventEffects`, Dunsparce Dig) blocks status, lock/marker and counter effects on the protected Pokémon; it does not yet block
  other attack effects on it (moving/discarding its Energy, returning it to hand).
- `koLastTurn` is `lastKOTurn === turn - 1`, so a Knock Out from Poison/Burn at the end of the opponent's turn counts as "during your opponent's last turn".
- Trainers/Abilities whose only effect can't resolve are blocked only for the cases `effectUsable` knows (top-level `switch`, `bind` of a `pick` with no candidates);
  e.g. Rosa's Encouragement with no Stage 2 in play, or Cruel Arrow-style effects with no target, can still be played and do nothing.
- Simultaneous-win ("sudden death") is awarded to the active player instead of being played out.
- Random agents only: win rates and game length (most games end by deck-out) say nothing about deck strength.

## Card text the DSL cannot fully honor
None of the 38 cards. Note: N's Zoroark ex's Trade has no "only 1 Trade each turn" clause in print, so it is `oncePerTurn` per Pokémon (two Zoroark ex can each Trade); Fezandipiti ex, Pecharunt ex and Meowth ex carry the printed name limits.

## Performance (see README / report)
- Done in M3a (about 30 to 100 games/s greedy-vs-greedy): see `docs/ENGINE.md`, "Performance".
