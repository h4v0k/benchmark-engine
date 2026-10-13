# M2 gaps: what remains after Milestone 2 part 2a

All 38 distinct cards in `src/cards/standard/` now have an interpreter/engine implementation for every feature their DSL uses
(see "M2 features" in docs/ENGINE.md). Both real decks pass `validateDeck` and run 40 random-agent games with no exceptions.
Per-card behaviour tests for the two real decks are part 2b; the feature tests are in `src/test/features.test.ts`.

## Still not implemented (used by none of the 38 cards)
- Effect nodes `evolve`, `useAgain`; `modify` stats `weakness`, `typeProvided`, `attackCost`, `toolSlots` (throw `notImplemented`).
- Triggers `wouldKO` and `betweenTurns` (parse, never fire); special-Energy `attach` effects.
- `copyAttack.viaDiscardTop`.

## Known approximations to review in part 2b
- `onKnockedOut` "by attack" is detected as "lethal right after the attack"; Knock Outs by counters placed on the same attack are
  treated the same way, and Pokémon Knocked Out only by an `onKnockedOut` effect's own damage do not fire their trigger.
- `onPutOnBench` only fires for placements during the placing player's own turn (what Risky Ruins needs); setup placement never fires.
- Meowth ex's `onPlayToBench` rule is silenced by Ability locks (it is an Ability in print) and uses the `last-ditch` tag for the name limit.
- Stadium numeric `modify` with `self`/`attached-to` applies to every Pokémon in play (legacy semantics used by the test cards).
- Damage `modify`/`damageDealt` markers are removed from a Pokémon when it leaves the Active Spot (existing marker model).
