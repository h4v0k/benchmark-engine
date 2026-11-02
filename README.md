# benchmark-engine

Open-source **Pokémon TCG (Standard) rules engine and simulation core** — the backend for Benchmark.
Pure TypeScript, **zero runtime dependencies**, deterministic from a seed, and designed as a pure state machine so
agents, UIs and search algorithms can all drive it the same way.

## Build & test

```sh
npm i -g typescript   # or use `npx -p typescript tsc ...`; the repo itself has no dependencies
npm run typecheck
npm test              # builds, then runs node:test (Node >= 20; developed on 22)
```

## Architecture (in 10 lines)

1. `src/dsl/types.ts` — the effect DSL (cards are data: `Entry[]` of trigger + effect). See `docs/DSL.md`.
2. `src/cards/model.ts` — `CardDef`, card registry, filters, deck validation. `test-cards.ts` is a small hand-written set.
3. `src/state.ts` — plain JSON-serializable `GameState`; `observe()` returns a hidden-information-safe view.
4. `src/rng.ts` — seeded mulberry32; all randomness (shuffles, coins) flows through `state.rng`.
5. `src/interpreter.ts` — executes DSL effects; decisions surface as a resumable *pending choice* (no callbacks).
6. `src/actions.ts` — the `Action` union and `legalActions(state, player)`.
7. `src/game.ts` — setup/mulligan, turn loop, Pokémon Checkup, KO/prize/win handling, `applyAction(state, action)`.
8. `src/agents/random.ts` — random agent; `src/sim.ts` — `playGame` / `simulate`.
9. `applyAction` never mutates its input (clone-on-write), so tree search can branch freely.
10. Rules flags live in `RulesConfig` so rule-version differences are data, not code. See `docs/ENGINE.md`.

## Status

**Milestone 1 — engine core: done.** Setup, turns, attacks, weakness/resistance, status conditions, KOs and prizes,
the choice model, ~all common DSL primitives, random agent, simulator, and an end-to-end test deck pair.
Rare DSL nodes (`evolve` effect, `copyAttack`, `useAgain`, some `modify` stats) throw `notImplemented`.

**Milestone 2 — real Standard cards: complete.** Two real decks (Dragapult ex, N's Zoroark ex; 38 distinct cards, each with its printed
text next to its DSL) play full games end to end: every non-trivial card has a behaviour test (`src/test/cards.test.ts`), and
`src/test/realdecks.test.ts` plays 300 Dragapult-vs-Zoroark games plus both mirrors with random agents (no exceptions, no stuck
games, deterministic per seed, key effects like Phantom Dive / Night Joker / Trade confirmed in the logs).
Run any matchup outside the tests: `npm run build && node scripts/sim.mjs dragapult zoroark 300 1`.

**Next:** more of the Standard card pool (remaining gaps in `docs/M2-GAPS.md`), then a search AI (MCTS / determinized rollouts)
on top of `legalActions` + `applyAction` + `observe`, and performance work (cache static effects, structural sharing instead of deep clones).

## Real cards (Milestone 2)

Decklists live in `data/decks/*.txt` (Limitless format: `count name SET number`). Raw card data is extracted from a local
clone of [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data) — the clone path is a CLI argument, never hardcoded:

```sh
node scripts/extract-cards.mjs <path-to-pokemon-tcg-data> data/decks/dragapult-ex.txt data/decks/ns-zoroark-ex.txt [--out data/cards]
```

It resolves each card via the set's `ptcgoCode` + number (falling back to exact name, newest printing with regulationMark >= H),
writes `data/cards/<setId>-<number>.json`, and prints a resolution table. Basic Energy is synthesized in code, not extracted.
DSL definitions: `src/cards/standard/` (`CARD_DEFS`, `DRAGAPULT_EX_DECK`, `NS_ZOROARK_EX_DECK`, `deckFromList`). Engine gaps: `docs/M2-GAPS.md`.
