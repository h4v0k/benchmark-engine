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

**A/B experiments:** `node scripts/experiment.mjs <spec.json>` evaluates list changes against a weighted field with paired seeds and confidence intervals; see `docs/EXPERIMENTS.md`.

## Architecture (in 10 lines)

1. `src/dsl/types.ts` — the effect DSL (cards are data: `Entry[]` of trigger + effect). See `docs/DSL.md`.
2. `src/cards/model.ts` — `CardDef`, card registry, filters, deck validation. `test-cards.ts` is a small hand-written set.
3. `src/state.ts` — plain JSON-serializable `GameState`; `observe()` returns a hidden-information-safe view.
   `src/events.ts` — the typed `GameEvent` stream (`state.events`) that replaces prose logs; see "Event stream" below.
4. `src/rng.ts` — seeded mulberry32; all randomness (shuffles, coins) flows through `state.rng`.
5. `src/interpreter.ts` — executes DSL effects; decisions surface as a resumable *pending choice* (no callbacks).
6. `src/actions.ts` — the `Action` union and `legalActions(state, player)`.
7. `src/game.ts` — setup/mulligan, turn loop, Pokémon Checkup, KO/prize/win handling, `applyAction(state, action)`.
8. `src/agents/` — random and greedy agents; `src/sim.ts` — `playGame` / `simulate`, all stats derived from the event stream.
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

**Milestone 3a — events and speed (in progress on `m3-search-pilot`).** Structured event stream, ~3.3x faster simulation, Night Joker tightened.

**Next:** more of the Standard card pool (remaining gaps in `docs/M2-GAPS.md`), then a search AI (MCTS / determinized rollouts)
on top of `legalActions` + `applyAction` + `observe`, then the A/B framework.

## Real cards (Milestone 2)

Decklists live in `data/decks/*.txt` (Limitless format: `count name SET number`). Raw card data is extracted from a local
clone of [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data) — the clone path is a CLI argument, never hardcoded:

```sh
node scripts/extract-cards.mjs <path-to-pokemon-tcg-data> data/decks/dragapult-ex.txt data/decks/ns-zoroark-ex.txt [--out data/cards]
```

It resolves each card via the set's `ptcgoCode` + number (falling back to exact name, newest printing with regulationMark >= H),
writes `data/cards/<setId>-<number>.json`, and prints a resolution table. Basic Energy is synthesized in code, not extracted.
DSL definitions: `src/cards/standard/` (`CARD_DEFS`, `DRAGAPULT_EX_DECK`, `NS_ZOROARK_EX_DECK`, `deckFromList`). Engine gaps: `docs/M2-GAPS.md`.

## Event stream, JSONL export, speed (Milestone 3a)

Every game is recorded as typed events (`draw`, `play`, `evolve`, `attachEnergy`, `ability`, `attack`, `damageCounters`, `ko`, `prize`,
`switch`, `status`, `checkup`, `gameEnd`, ...) in `state.events`, with stable card instance ids plus names. All analytics read this stream;
`formatEvent` / `logText(state)` render it as text for debugging. Event reference: `docs/ENGINE.md`.

```sh
npm run build
node scripts/sim.mjs dragapult zoroark 300 1 --greedy --jsonl games.jsonl   # one JSON line per game: seed, decks, winner, reason, turns, events
node scripts/bench.mjs 200                                                  # greedy-vs-greedy games/s
```

Speed: greedy-vs-greedy Dragapult vs N's Zoroark runs at about **100 games/s per core** (was about 30; best-of-8 runs of 80 games, 94 to 109),
with games identical for a given seed: `src/test/golden.test.ts` replays 50 seeds against a committed fixture
(`src/test/fixtures/golden-50.json`) and is a permanent regression guard for any engine change. If a rules or card change legitimately alters
outcomes, regenerate the fixture in that same change and say so (golden-50 is a greedy-behaviour fixture too: it was regenerated on 2026-10-13 when the greedy pilot's tempo changed, engine unchanged; see `docs/EXPERIMENTS.md`, "Pilot tempo"). What made it fast is in `docs/ENGINE.md` ("Performance").
