# Experiment: dragapult-rare-candy

## Verdict

- **2 Candy for Drakloak+Pad** (-1 Drakloak -1 Poké Pad +2 Rare Candy): **too close to call**. Meta-weighted win rate 55.9% vs base 61.0%, delta -5.1 points, 95% interval [-11.0, 0.8] points. Games needed to detect a 2-point difference at 95%: about 2010 per matchup (we ran 232).
- **1 Candy for Pad** (-1 Poké Pad +1 Rare Candy): **too close to call**. Meta-weighted win rate 59.0% vs base 61.0%, delta -2.0 points, 95% interval [-8.0, 4.0] points. Games needed to detect a 2-point difference at 95%: about 2073 per matchup (we ran 232).

Final verdicts come from the confirm stage only (fresh seeds, search:fast). The screen (greedy, 600 games/matchup) is used only to choose what to confirm: 2 Candy for Drakloak+Pad -1.1 [-3.9, 1.8] (kept); 2 Candy for Drakloak+Hammer -1.7 [-4.5, 1.2] (dropped); 1 Candy for Pad -1.4 [-3.3, 0.5] (kept).

## Overall (meta-weighted)

| Deck | Change | Win rate | 95% interval | Delta vs base (pts) | Delta 95% interval | Verdict |
|---|---|---|---|---|---|---|
| Dragapult ex (Recife 3rd place list) (base) | - | 61.0% | [55.9, 66.1] | - | - | - |
| 2 Candy for Drakloak+Pad | -1 Drakloak -1 Poké Pad +2 Rare Candy | 55.9% | [50.8, 61.1] | -5.1 | [-11.0, 0.8] | too close to call |
| 1 Candy for Pad | -1 Poké Pad +1 Rare Candy | 59.0% | [53.9, 64.2] | -2.0 | [-8.0, 4.0] | too close to call |

## Per matchup

| Matchup (weight) | Deck | Games | Win rate | 95% Wilson | Delta vs base (pts) | Delta 95% interval |
|---|---|---|---|---|---|---|
| vs Dragapult ex (78.0%) | Dragapult ex (Recife 3rd place list) (base) | 232 | 53.4% | [47.0, 59.8] | - | - |
| | 2 Candy for Drakloak+Pad | 232 | 48.3% | [41.9, 54.7] | -5.2 | [-12.5, 2.2] |
| | 1 Candy for Pad | 232 | 52.6% | [46.2, 58.9] | -0.9 | [-8.3, 6.6] |
| vs N's Zoroark ex (22.0%) | Dragapult ex (Recife 3rd place list) (base) | 232 | 87.9% | [83.1, 91.5] | - | - |
| | 2 Candy for Drakloak+Pad | 232 | 83.2% | [77.8, 87.5] | -4.7 | [-10.8, 1.3] |
| | 1 Candy for Pad | 232 | 81.9% | [76.4, 86.3] | -6.0 | [-12.0, -0.1] |

## Mechanism

### 2 Candy for Drakloak+Pad (-1 Drakloak -1 Poké Pad +2 Rare Candy)

- 2 Candy for Drakloak+Pad attacked with Dragapult ex by its own turn 2 in 4.9 points more games across the weighted field.
- 2 Candy for Drakloak+Pad attacked with Dragapult ex by its own turn 2 in 4.7 points more games vs Dragapult ex.
- 2 Candy for Drakloak+Pad attacked with Dragapult ex by its own turn 2 in 5.6 points more games vs N's Zoroark ex.
- Drakloak (4 -> 3 copies): drawn by turn 3 in 61% -> 49% of games; played at all 93% -> 90%; played by turn 4 66% -> 53%. Observational (not causal): base win rate 74% when played (n=437) vs 11% when not (n=27); variant win rate 70% when played (n=429) vs 11% when not (n=35).
- Poké Pad (4 -> 3 copies): drawn by turn 3 in 59% -> 49% of games; played at all 86% -> 78%; played by turn 4 40% -> 30%. Observational (not causal): base win rate 75% when played (n=406) vs 40% when not (n=58); variant win rate 72% when played (n=376) vs 38% when not (n=88).
- Rare Candy (0 -> 2 copies): drawn by turn 3 in 0% -> 36% of games; played at all 0% -> 36%; played by turn 4 0% -> 9%. Observational (not causal): base no played/not-played split (card always or never played); variant win rate 72% when played (n=170) vs 62% when not (n=294).

| Own-turn mechanism (field-weighted) | Dragapult ex (Recife 3rd place list) (base) | 2 Candy for Drakloak+Pad |
|---|---|---|
| Dragapult ex first attack, mean own turn (games where it attacks) | 4.56 | 4.85 |
| Dragapult ex attacked by own turn 2 / 3 / 4 (% of all games) | 0.0% / 33.9% / 51.2% | 4.9% / 28.3% / 42.7% |
| games with a Dragapult ex attack at all | 79.9% | 77.3% |
| first KO, mean own turn | 4.28 | 4.44 |
| deck-out rate (the arm loses by decking) | 1.0% | 0.5% |
| Drakloak played by own turn 2 / 3 / 4 / 5 (% of all games) | 66.0% / 78.3% / 84.2% / 88.5% | 53.3% / 68.4% / 78.7% / 83.3% |
| Drakloak first played, mean own turn (when played) | 2.63 | 2.98 |
| Poké Pad played by own turn 2 / 3 / 4 / 5 (% of all games) | 39.7% / 53.2% / 62.6% / 68.3% | 29.7% / 42.1% / 53.2% / 59.1% |
| Poké Pad first played, mean own turn (when played) | 3.51 | 3.97 |
| Rare Candy played by own turn 2 / 3 / 4 / 5 (% of all games) | 0.0% / 0.0% / 0.0% / 0.0% | 8.9% / 14.4% / 19.2% / 24.2% |
| Rare Candy first played, mean own turn (when played) | n/a | 4.73 |

### 1 Candy for Pad (-1 Poké Pad +1 Rare Candy)

- 1 Candy for Pad attacked with Dragapult ex by its own turn 2 in 2.2 points more games across the weighted field.
- 1 Candy for Pad attacked with Dragapult ex by its own turn 2 in 2.2 points more games vs Dragapult ex.
- 1 Candy for Pad attacked with Dragapult ex by its own turn 2 in 2.2 points more games vs N's Zoroark ex.
- Poké Pad (4 -> 3 copies): drawn by turn 3 in 59% -> 48% of games; played at all 86% -> 77%; played by turn 4 40% -> 29%. Observational (not causal): base win rate 75% when played (n=406) vs 40% when not (n=58); variant win rate 72% when played (n=369) vs 47% when not (n=95).
- Rare Candy (0 -> 1 copies): drawn by turn 3 in 0% -> 19% of games; played at all 0% -> 16%; played by turn 4 0% -> 4%. Observational (not causal): base no played/not-played split (card always or never played); variant win rate 70% when played (n=73) vs 67% when not (n=391).

| Own-turn mechanism (field-weighted) | Dragapult ex (Recife 3rd place list) (base) | 1 Candy for Pad |
|---|---|---|
| Dragapult ex first attack, mean own turn (games where it attacks) | 4.56 | 4.78 |
| Dragapult ex attacked by own turn 2 / 3 / 4 (% of all games) | 0.0% / 33.9% / 51.2% | 2.2% / 30.6% / 46.5% |
| games with a Dragapult ex attack at all | 79.9% | 78.7% |
| first KO, mean own turn | 4.28 | 4.41 |
| deck-out rate (the arm loses by decking) | 1.0% | 0.7% |
| Poké Pad played by own turn 2 / 3 / 4 / 5 (% of all games) | 39.7% / 53.2% / 62.6% / 68.3% | 29.1% / 39.3% / 49.7% / 54.9% |
| Poké Pad first played, mean own turn (when played) | 3.51 | 4.15 |
| Rare Candy played by own turn 2 / 3 / 4 / 5 (% of all games) | 0.0% / 0.0% / 0.0% / 0.0% | 3.8% / 6.9% / 8.6% / 12.2% |
| Rare Candy first played, mean own turn (when played) | n/a | 4.44 |

### Baseline game flow (base list)

- Average game length 16.1 turns; 3.44 KOs and 3.91 prizes per game; first KO on turn 8.0; Dragapult ex first attacks on turn 8.5 (attacks in 79.9% of games); deck-out rate 1.0%.
- Win reasons: prizes 85.9%, no-pokemon 12.6%, deckout 1.6%.
- vs Dragapult ex: 15.1 turns, first KO T7.8, Dragapult ex first attacks T8.1, 3.11 KOs/game.
- vs N's Zoroark ex: 19.5 turns, first KO T8.8, Dragapult ex first attacks T10.2, 4.63 KOs/game.

## Method notes

- Date 2026-10-14. Agent: search:fast for both seats (the same pilot plays every deck; a strong pilot reduces but does not remove pilot-skill bias). Stage: confirm.
- Games: 232 per matchup per deck (2000 requested, stopped at a time budget), 1392 games in total, seats alternate by game index, seeds 50003000 + matchup*100000 + game index.
- Paired design: base and every variant use the SAME seed and seat in each game (common random numbers), so deltas are intervals on paired differences, much tighter than comparing two independent win rates. Draws count 1/2.
- Field (normalized meta share): Dragapult ex 78.0%, N's Zoroark ex 22.0%. Field coverage: this field contains only 2 archetypes; results say nothing about matchups outside it, and a real meta has many more.
- Intervals: per-matchup Wilson 95%; overall and deltas are normal 95% intervals with per-matchup variances propagated by weight (sum of w^2 var). Verdict = whether the overall delta interval excludes 0. Games needed = games per matchup for a 2-point half-width at the observed variance (about 50% power to detect a true 2-point edge; multiply by ~1.6 for 80% power).
- Mechanism stats are read from the event stream. "Drawn by turn 3" counts draw events (opening hand and draws) by game turn 3, not searches; "played" = benched / evolved into / attached / played; turn numbers in the sentences are game turns (both players' turns count), "by turn N" uses N=4; the own-turn tables count the seat's own turns (k-th own turn = ceil(game turn / 2)). Played-vs-not-played win-rate splits are observational and confounded. Mechanism sentences are shown only when the difference exceeds its 95% noise band (unpaired, so conservative).
- Caveats: only cards implemented in the engine can appear in lists; the pilot plays no hidden-information bluffs; the verdict is about this pilot and this field, not about human play. Testing many variants inflates false positives; use the two-stage workflow and trust only the confirm stage.
