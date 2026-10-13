# Experiment: dragapult-9th-energy

## Verdict

- **9 Energy (4 Psychic)** (-1 Night Stretcher +1 Psychic Energy): **too close to call**. Meta-weighted win rate 53.0% vs base 52.3%, delta +0.7 points, 95% interval [-4.7, 6.1] points. Games needed to detect a 2-point difference at 95%: about 2655 per matchup (we ran 363).

Final verdicts come from the confirm stage only (fresh seeds, search:fast). The screen (greedy, 400 games/matchup) is used only to choose what to confirm: 9 Energy (4 Psychic) +0.9 [-2.1, 3.9] (kept).

## Overall (meta-weighted)

| Deck | Change | Win rate | 95% interval | Delta vs base (pts) | Delta 95% interval | Verdict |
|---|---|---|---|---|---|---|
| Dragapult ex (Recife 3rd place list) (base) | - | 52.3% | [48.1, 56.4] | - | - | - |
| 9 Energy (4 Psychic) | -1 Night Stretcher +1 Psychic Energy | 53.0% | [48.8, 57.1] | +0.7 | [-4.7, 6.1] | too close to call |

## Per matchup

| Matchup (weight) | Deck | Games | Win rate | 95% Wilson | Delta vs base (pts) | Delta 95% interval |
|---|---|---|---|---|---|---|
| vs Dragapult ex (78.0%) | Dragapult ex (Recife 3rd place list) (base) | 363 | 49.3% | [44.2, 54.4] | - | - |
| | 9 Energy (4 Psychic) | 363 | 50.7% | [45.6, 55.8] | +1.4 | [-5.3, 8.1] |
| vs N's Zoroark ex (22.0%) | Dragapult ex (Recife 3rd place list) (base) | 363 | 62.8% | [57.7, 67.6] | - | - |
| | 9 Energy (4 Psychic) | 363 | 61.2% | [56.1, 66.0] | -1.7 | [-8.1, 4.8] |

## Mechanism

### 9 Energy (4 Psychic) (-1 Night Stretcher +1 Psychic Energy)

- 9 Energy (4 Psychic) took its first KO 1.1 turns earlier across the weighted field.
- 9 Energy (4 Psychic) decked out 1.8 points less often across the weighted field.
- 9 Energy (4 Psychic) decked out 1.9 points less often vs Dragapult ex.
- Night Stretcher (3 -> 2 copies): drawn by turn 3 in 50% -> 36% of games; played at all 83% -> 71%; played by turn 4 16% -> 11%. Observational (not causal): base win rate 58% when played (n=614) vs 45% when not (n=112); variant win rate 60% when played (n=536) vs 44% when not (n=190).
- Psychic Energy (3 -> 4 copies): drawn by turn 3 in 49% -> 58% of games; played at all 90% -> 94%; played by turn 4 44% -> 52%. Observational (not causal): base win rate 59% when played (n=665) vs 23% when not (n=61); variant win rate 58% when played (n=693) vs 12% when not (n=33).

### Baseline game flow (base list)

- Average game length 25.7 turns; 3.13 KOs and 3.51 prizes per game; first KO on turn 12.2; Dragapult ex first attacks on turn 16.1 (attacks in 67.6% of games); deck-out rate 2.6%.
- Win reasons: prizes 82.5%, no-pokemon 9.8%, deckout 7.6%.
- vs Dragapult ex: 23.8 turns, first KO T11.6, Dragapult ex first attacks T15.4, 3.10 KOs/game.
- vs N's Zoroark ex: 32.3 turns, first KO T14.2, Dragapult ex first attacks T18.4, 3.20 KOs/game.

## Method notes

- Date 2026-10-13. Agent: search:fast for both seats (the same pilot plays every deck; a strong pilot reduces but does not remove pilot-skill bias). Stage: confirm.
- Games: 363 per matchup per deck (2000 requested, stopped at a time budget), 1452 games in total, seats alternate by game index, seeds 50001000 + matchup*100000 + game index.
- Paired design: base and every variant use the SAME seed and seat in each game (common random numbers), so deltas are intervals on paired differences, much tighter than comparing two independent win rates. Draws count 1/2.
- Field (normalized meta share): Dragapult ex 78.0%, N's Zoroark ex 22.0%. Field coverage: this field contains only 2 archetypes; results say nothing about matchups outside it, and a real meta has many more.
- Intervals: per-matchup Wilson 95%; overall and deltas are normal 95% intervals with per-matchup variances propagated by weight (sum of w^2 var). Verdict = whether the overall delta interval excludes 0. Games needed = games per matchup for a 2-point half-width at the observed variance (about 50% power to detect a true 2-point edge; multiply by ~1.6 for 80% power).
- Mechanism stats are read from the event stream. "Drawn by turn 3" counts draw events (opening hand and draws) by game turn 3, not searches; "played" = benched / evolved into / attached / played; turn numbers are game turns (both players' turns count), "by turn N" uses N=4. Played-vs-not-played win-rate splits are observational and confounded. Mechanism sentences are shown only when the difference exceeds its 95% noise band (unpaired, so conservative).
- Caveats: only cards implemented in the engine can appear in lists; the pilot plays no hidden-information bluffs; the verdict is about this pilot and this field, not about human play. Testing many variants inflates false positives; use the two-stage workflow and trust only the confirm stage.
