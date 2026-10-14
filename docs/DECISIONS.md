# Known-answer decisions

Positions where every competent player of the deck agrees on the play. They are hand-built, deterministic states (`src/test/decisions.test.ts`), played for one whole
turn by **both** pilots (greedy, and `search:fast` with a fixed seed), each with the hand in three card orders (as listed, reversed, rotated) so the answer cannot depend
on hand order. This is the seed of the known-answers suite: add a position here and in the test file whenever a pilot misplays something a human would not.

All positions: Dragapult ex deck (Phantom Dive costs {R}{P}, so the attacker line is Dreepy -> Drakloak -> Dragapult ex), the pilot is the first player on its own
turn 2, the opponent is N's Zoroark ex (no Pokemon the Active can KO unless stated). The top of the pilot's deck is Items, so Recon Directive does not hand out Energy by luck.

| id | position | known answer |
|---|---|---|
| a | Dreepy Active with 1 Psychic, Budew + Munkidori benched, hand: Drakloak, Crispin, Boss's Orders, Lillie's Determination; nothing can be KO'd | Evolve to Drakloak, play **Crispin** (not Boss, not Lillie's), and Crispin's attach plus the fetched Energy go onto the Drakloak line (Fire + Psychic), never onto Budew / Munkidori ahead of it |
| b | Drakloak Active with R+P (Dragon Headbutt 70), a 70 HP N's Zorua benched behind a 280 HP Zoroark ex; hand: Lillie's, Crispin, Boss's Orders | **Boss's Orders** is played and the Zorua is Knocked Out: the rule is "no Boss without a KO", not "never Boss early" |
| c | Budew Active, Dreepy benched with no Energy, hand: one Psychic Energy | The Energy goes to **Dreepy**, not to the free-attacking Budew |
| d | Budew Active; Drakloak (1 Psychic) and Munkidori (0) benched; hand: Crispin; the turn's attach is already used | Crispin fetches Fire + Psychic and the attach goes to **Drakloak** (it then holds R+P = Phantom Dive online), not Munkidori |
| e1 | Line short of Energy (Dreepy with only Psychic), hand of 3: Lillie's, Boss's Orders, Crispin | **Crispin**, not Lillie's Determination |
| e2 | Line already holds R+P (Drakloak), hand of 2: Crispin, Lillie's | **Lillie's Determination** (Crispin adds nothing the line still needs) |
| f | Deck-out guard: 8 cards left in the deck, small hand with Lillie's Determination | Lillie's is **not** played |

Rules the pilots now follow (`src/agents/tempo.ts`, shared by greedy and search):

* Supporter order on setup turns: a gust that KOs; Crispin while the main line is short of its attack cost (counting the one hand Energy it can still receive);
  draw Supporters (hand <= 3, deck > 12; played after Items, and ranked last if the shuffle would throw away a main-line Pokemon that cannot be played yet); other Supporters;
  Crispin once the line is online. Boss's Orders without a KO is never played.
* Energy targeting: the main attacker line first (the Pokemon that will evolve into it included), then the next-best attacker; an Energy of a type the main attack
  costs is held in hand (game turn <= 6) while the deck's best line is not on the board yet, instead of being spent on Munkidori / Fezandipiti ex.
* Pending choices: Crispin's fetch / hand / attach-target and Pokemon searches (Buddy-Buddy Poffin, Ultra Ball, ...) take the main line's card the board can use now.
