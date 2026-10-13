# Experiments (A/B framework, milestone 3c)

The engine as an evaluation oracle: take a base list, make a small edit, and ask whether the edit wins more against a
weighted field. Code: `src/experiments/ab.ts`; CLI: `scripts/experiment.mjs`; tests: `src/test/experiments.test.ts`.

## Run one

```sh
npm run build
node scripts/experiment.mjs experiments/dragapult-9th-energy.json --shards 2 --budget-min 25
```

Spec JSON (decks are referenced by name from `src/cards/standard`: `dragapult`, `zoroark`):

```json
{ "name": "my-test",
  "base": { "deck": "dragapult" },
  "variants": [ { "name": "9 Energy", "change": "-1 Night Stretcher +1 Psychic Energy" } ],
  "field": [ { "deck": "dragapult", "weight": 33.4 }, { "deck": "zoroark", "weight": 9.4 } ],
  "gamesPerMatchup": 400, "agent": "greedy", "seedBase": 1000,
  "screen":  { "agent": "greedy", "gamesPerMatchup": 400, "keep": 1 },
  "confirm": { "agent": "search:fast", "gamesPerMatchup": 2000 } }
```

* `change` is `"-N Card +N Card"` count edits applied by `applyChanges`, which validates the result (60 cards, at most 4
  copies, at most 1 ACE SPEC, a Basic Pokémon). Added cards replace removed ones **in place** so paired games stay aligned.
* With `screen` + `confirm` the CLI runs `screenThenConfirm`; without them it runs a single stage.
* `--shards N` splits game indices over N processes (use the core count). `--budget-min M` stops the last stage after M
  minutes at a game-index boundary, so every matchup and arm keeps the same number of games; `gamesPerMatchup` is then a cap.
* Output: `experiments/<name>-<date>/report.md`, `result.json`, the stage specs and raw per-game records
  (`*-records-*.json`, enough to re-run `analyze` without replaying).
* From code: `runExperiment(spec)`, `screenThenConfirm(spec, opts)`, `renderReport(result)`, `toJSON(result)`.
* Speed: greedy ~ thousands of games per minute; `search:fast` about 2 s per game per core.

## Statistical design

* **Paired comparison (common random numbers).** For matchup m and game index g every arm uses the same seed
  (`seedBase + m*100000 + g`) and the same seat (alternating). Arms differ only in the edited card, so until that card matters
  the games are identical. Deltas are intervals on per-game paired differences. (The pairing helps most early in the game; once
  the pilot's choices diverge the games decorrelate, so expect partial variance reduction, not magic.)
* **Per matchup:** win rate (draw = 1/2) with a 95% Wilson interval.
* **Overall:** weighted by normalized meta share. Variance is propagated by weight, `sum w_m^2 var_m`, normal 95% interval.
* **Verdict** per variant: `better` / `worse` if the overall paired-delta interval excludes 0, else `too close to call` plus
  the games per matchup needed for a 2-point half-width, `n * (1.96 * se / 0.02)^2` (about 50% power for a true 2-point
  edge; multiply by about 1.6 for 80% power).
* **Multiple comparisons.** Testing many swaps means some look good by chance. `screenThenConfirm` screens all variants cheaply,
  keeps the top `keep` by delta, and re-runs only those on **fresh seeds**. Final verdicts come only from the confirm stage:
  the screen chose its winners using its own data (winner's curse), the confirm stage tests pre-selected hypotheses on data the
  selection never saw.
* **Mechanism stats** come from the event stream, per deck, per matchup and weighted overall: game length, win reasons, KOs and
  prizes per game, turn of first KO, turn the main attacker first attacked, deck-out rate, and for each edited card the share of
  games where it was drawn by turn 3 (draw events only, not searches), played at all, played by turn N, and the win rate when it
  was played vs not played. The played/not-played split is **observational**, not causal. Turns are game turns (both players).
  Mechanism sentences appear only when a difference exceeds its (conservative, unpaired) 95% noise band.

## Caveats

* The field is only the archetypes the engine scripts (currently Dragapult ex and N's Zoroark ex); say so in any finding.
* One pilot plays both seats. The result is about that pilot; a greedy pilot may mis-value a card a human would use well, and
  `search:fast` is a shallow search. Re-confirm interesting results with `search:strong` before believing them.
* Best-of-one, Standard rules as implemented; no sideboarding, no best-of-three, no clock.
* An interval that includes 0 is not evidence of "no effect": check the games-needed figure.
* Findings must carry: interval, games, field, date, and mechanism (the report does).
