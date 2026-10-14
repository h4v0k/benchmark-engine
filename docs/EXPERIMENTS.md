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

## Pilot tempo (2026-10-13)

`node scripts/tempo.mjs [nGreedy=200] [nSearch=60]` measures how fast the Dragapult ex player develops and attacks (own-turn numbers from the event
stream) and counts legal-but-unused evolve / attach / attack options per own turn. Finding that triggered it: the A/B report had Dragapult ex first
attacking on game turn ~16 (its own 8th turn). The engine was not the cause (`src/test/tempo.test.ts` plays the canonical Dreepy -> Drakloak ->
Dragapult ex curve, own turns 1/2/3, with Phantom Dive legal on turn 3, from either seat). The pilot was:

* Greedy kept a free-attacking Budew (or Munkidori) Active and the "retreat only if the Active cannot attack" rule never promoted the evolved
  Dragapult ex; Energy went to whoever attacked soonest (often Munkidori / the Active) instead of the main attacker's line.
* Search (`search:fast`) skipped evolutions 15-30% of own turns (22% on turn 2-3) because a 2-turn horizon does not see the Stage 2 payoff.

Fixes (all in the pilots; no engine rule changed): greedy attaches Energy that brings the main attacker's big attack closer to its line first (the
Pokémon being evolved included) and retreats to a benched Pokémon that hits clearly harder (`src/agents/tempo.ts`); search gets a tempo term in the leaf
heuristic (`HW.tempo`) and plays an available main-line evolution without searching. `FAST_SEARCH` iterations 20 -> 40 (see below).

| Dragapult ex player, own turn, median [p25-p75] | greedy before | greedy after | search:fast before | search:fast after |
|---|---|---|---|---|
| first Drakloak | 2 | 2 | 6 | 3 |
| first Dragapult ex | 4 | 4 | 7 | 5 |
| first Dragapult ex attack | 7 [3-12] | 5 [3-10] | 8 [6-13] | 5 [4-9] |
| first KO (game turn) | 11 | 9 | 12 | 8 |

Side effects to keep in mind: the stronger greedy shifts the Dragapult-vs-Zoroark matchup (greedy-vs-greedy Dragapult win rate 70% -> 87%, golden-50
regenerated for this reason), so earlier A/B numbers are not comparable with new ones. Search must beat a stronger greedy, so `FAST_SEARCH` now uses
40 iterations per world (20 gave about 80% against the new greedy, 40 gives 87%) at about half the games/s (0.95 -> 0.45-0.6).

Known remaining gap vs human play: median first Dragapult ex attack is own turn 5, a human gets there on turn 3-4. Mean Energy on the Dragapult line
by own turn 3 is only 1.1: the list has 8 Basic Energy (2 of them Darkness), so the second Energy (R+P for Phantom Dive) usually arrives late; the pilot
does not mulligan-evaluate / dig for Energy (Crispin, Rosa's Encouragement, Ultra Ball for Energy) with that goal, does not hold Dreepy back from the
Active slot (it is often KO'd early; 7.5% of games never reach Dragapult ex), and N's Zoroark ex's pilot often repeats a zero-damage Night Joker for many
turns (no copy source powered), which flatters Dragapult in the matchup. Tempo-based findings should still be read with a pilot-skill caveat.

### Pilot tempo, round 2: setup policy (M3d-1)

Measured pilot misplays (Dragapult vs Zoroark): the search pilot played Crispin by own turn 3 in only 11/40 games, picked Boss's Orders with nothing to KO on own turn 2
(13% of games), and Energy on the Dreepy/Drakloak/Dragapult line by own turn 3 averaged ~1.1 for both pilots. Known-answer positions for these are in `docs/DECISIONS.md`
(`src/test/decisions.test.ts`, 14 tests = 7 positions x 2 pilots; before the fixes greedy passed 2/7 and search 5/7, after: 7/7 and 7/7).

Changes (pilots only; no engine rule changed), all in `src/agents/tempo.ts` and used by both pilots:
* greedy: Supporters are ranked (KO gust > Crispin for a short line > draw > other); a draw Supporter waits for the Items; Energy targeting is the shared `mainAttach`
  (+ `holdForLine`: keep R/P Energy in hand until the Dragapult line is on the board); Crispin's choices and Pokemon-search picks (Poffin, Ultra Ball, ...) use the shared
  `preferredChoice` (previously Poffin / Ultra Ball / Crispin picks were arbitrary: the largest single gain, Dragapult ex never reached 7.5% -> 4.5%).
* search: Boss's Orders without a KO is pruned from the candidate set and only the best-ranked Supporter play is kept (`pruneSupporters`, narrow: Supporters and held Energy only);
  Crispin for a short line / a draw Supporter with no Items left to play are played without searching (`policySupporter`, like the existing main-line evolution), the line Basic is
  benched without searching (`mainLineBasic`), and Crispin / Poffin / Ultra Ball pending choices are answered by `preferredChoice` instead of being explored by UCT.
  rolloutTurns stays 2; a larger early-game `HW.tempo` weight was tried (x1.5 on game turns <= 8) and made search weaker (80% vs 84%), so it was dropped.
* Not done: "don't pick a 0-damage Night Joker when a damaging attack exists": N's Zoroark ex has no other attack, the real gap there is the retreat/promote decision (not cheap).

| Dragapult ex player, own turn (greedy 200 games, search:fast 40 games) | greedy before | greedy after | search before | search after |
|---|---|---|---|---|
| first Drakloak, median [p25-p75] | 2 [2-5] | 2 [2-2] | 3 [2-6] | 2 [2-4] |
| first Dragapult ex | 4 [3-8] | 4 [3-6] | 5 [4-8] | 4 [3-6] |
| Dragapult ex never reached | 7.5% | 4.5% | 7.5% | 0% |
| first Dragapult ex attack | 5 [3-10] | 5 [3-10] | 7 [4-9] | 5 [3-7] |
| attacked by own T3 / T4 (of all games) | - | 32% / 40% | - | 30% / 48% |
| Crispin played by own T3 (when in hand by T3) | 35% (93%) | 36% (92%) | 43% (89%) | 43% (85%) |
| Boss's Orders on own T2 without a KO | 0% | 0% | 13% | 0% |
| avg Energy on the line at end of own T3 (anywhere) | 1.15 | 1.65 (1.95) | 0.97 | 1.48 (1.93) |
| Dragapult win vs Zoroark | 87% | 91.5% | 100% | 100% |
| games/s | 151 | 142 | 0.8 | 0.9 |

Notes: "Crispin by T3" is capped by drawing one of the 2 copies (only 38% of games have it in hand by then); the conditional rate was already ~92%. Energy on the line is capped
by the 8 Basic Energy (about 2.3 Energy seen by T3) and one attach per turn; the line now gets 85% of the Energy on the board. The median first Dragapult ex attack is still
own turn 5 (40-48% of games attack by T4): the remaining delay is drawing Dreepy + Drakloak + Dragapult ex + both Energy types, which needs more draw/search play, not a better choice among the cards held.
search:fast vs greedy (100 games) is now 84% (was 87-89% against the old greedy; the weak pairing is search-as-Zoroark vs the stronger greedy-Dragapult, 11/24), so
`src/test/search.test.ts` asserts >= 70% (comment there). golden-50.json was regenerated because greedy's behaviour changed (engine unchanged); the hidden-information
test now probes seed 25 (seed 24's greedy game became too short for its 6 probe turns).
