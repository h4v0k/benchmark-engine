# M2 gaps: real-card features the interpreter does not implement yet (for Part 2)

Card DSL compiles (`npm run typecheck`) for all 38 distinct cards in `src/cards/standard/`; the items below are what cannot run yet.
Ids are `setId-number`. "Printed text" is in each CardDef `text` field.

## A. Interpreter throws `notImplemented`
| Feature | Cards |
|---|---|
| `copyAttack` | N's Zoroark ex (sv9-98) Night Joker: "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack." Needs: pick bench N's Pokémon, pick one of its attacks (incl. cost-free use, no energy requirement check on the source), run its effect/damage as this attack's. Name filter `nameIncludes:"N's"` is used. |
| `modify` stat `attackCost` / `typeProvided` / `weakness` / `toolSlots` | none of the 38 cards need them |
| `evolve` effect, `useAgain` | none (evolving from hand is a core action, not these nodes) |
| `prevent` with `who` selector other than marks (see C) | Dragapult ex bench immunity runs through a `static` entry, which is not evaluated (see B) |

## B. Triggers that parse but never fire
- `onPlayToBench`: Meowth ex (me3-62) Last-Ditch Catch: "Once during your turn, when you play this Pokémon from your hand onto your Bench, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck. You can't use more than 1 Ability that has "Last-Ditch" in its name each turn." (the once-per-"Last-Ditch" name limit is currently a `tag` only).
- `onPutOnBench` (any player's bench placement): Risky Ruins (me1-127): "Whenever any player puts a Basic non-Darkness Pokémon onto their Bench during their turn, place 2 damage counters on that Pokémon." Needs: trigger supplies the benched Pokémon as ref `benched`; "during their turn" check; also should fire for Poffin / Meowth Tuck/etc. placements.
- `onDamaged`: Punk Helmet (me2-92): "If the Darkness Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 4 damage counters on the Attacking Pokémon." Needs the trigger to supply ref `attacker`, and Tool-hosted triggers to be collected.
- `static` entries on Pokémon (only Tools/Stadiums are scanned by `staticModifiers`, and only numeric `modify` of hp/retreat/damageDealt/damageTaken): 
  - Dragapult ex (sv6-130): "Tera: As long as this Pokémon is on your Bench, prevent all damage done to this Pokémon by attacks (both yours and your opponent's)." (`static`+`prevent`, `while: not inPlayActive`). Needs prevention evaluated in `applyDamage` for benched Tera Pokémon (also vs. Phantom Dive-style counters? No: counters are not damage, so Tera does not stop them; ensure `counters` bypasses it).
  - N's Castle (sv9-152): "N's Pokémon in play (both yours and your opponent's) have no Retreat Cost." (`static` `retreatCost` delta -99 over a selector, not a numeric `modify`).
  - Team Rocket's Watchtower (sv10-180): "Colorless Pokémon in play (both yours and your opponent's) have no Abilities." (`static` `lock ability`; the ability legality check in actions.ts must consult stadium locks).
- `endOfTurn`, `wouldKO`, `onKnockedOut`, `onEvolve`: not used by these 38 cards.
- Special-Energy attach effects: none in either list (only Basic Energy).

## C. Trainer `play` entry fields not enforced
`play.requires` and `play.cost` are declared but `legalActions`/play resolution only use the `effect` of the first `play` rule:
- Ultra Ball (me1-131): "You can use this card only if you discard 2 other cards from your hand." (uses `cost` effect wrapper + handSize >= 3 requires)
- Rosa's Encouragement (me3-84): "You can use this card only if you have more Prize cards remaining than your opponent."
- Special Red Card (me4-82): "You can use this card only if your opponent has 3 or fewer Prize cards remaining."
- Unfair Stamp (sv6-165): "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn." Also needs ACE SPEC deck-limit validation (`ruleBox aceSpec`) in `validateDeck`.
- Ability `costToUse` (N's Zoroark ex Trade: "You must discard a card from your hand in order to use this Ability.") is not handled by `legalActions`.
- Ability `limit: "oncePerNamePerTurn"` (Fezandipiti ex Flip the Script; Pecharunt ex Subjugating Chains: "You can't use more than 1 ... Ability each turn.") needs engine support keyed by player+name.

## D. Text the DSL cannot express faithfully (proposed new nodes)
1. **Munkidori Adrena-Brain** (sv6-95): "move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon." Placed count must equal count actually removed. Propose `{e:"moveCounters", from:Selector, to:Selector, n:Amount(upTo)}`. Current card uses `counters remove` + `counters` with a placeholder amount (WRONG until fixed).
2. **Crispin** (sv7-133): "up to 2 Basic Energy cards of different types ... put 1 of them into your hand. Attach the other to 1 of your Pokémon." Propose `CardSel.distinct?: "type"|"name"` plus a `split` effect: `{e:"searchSplit", filter, upTo:2, distinct:"type", a:{to:"hand"}, b:{attachTo:Selector}}`. Current card approximates (search 2 -> hand, then attach any 1 Basic Energy from hand).
3. **Black Belt's Training** (sv9-143): "+40 to opp's Active Pokémon **ex**". Condition on defender should be evaluated at damage time. Propose `modify.againstFilter?: CardFilter` (current card puts the filter in the `against` pick selector, which may resolve at play time and be wrong if Active changes).
4. **N's Zekrom Shred** (sv9-155): "damage isn't affected by any effects on your opponent's Active Pokémon". Uses `damage{effects:false}`; the interpreter must honor `effects:false` by skipping defender-side damageTaken/prevent markers (weakness/resistance still apply).
5. **Special Red Card** (me4-82): "shuffles their hand and puts it on the bottom of their deck ... if they put any, they draw 3." Uses `move` to deck bottom + `didPrev`; needs hand shuffle before bottom (order randomization), a `position:"bottom"` with `shuffleFirst`.
6. **Dudunsparce Run Away Draw** (sv5-129): "shuffle this Pokémon and all attached cards into your deck" — uses `move` with `zone:"play", from: SELF`; needs the interpreter to support moving an in-play Pokémon stack (all evolution/energy/tool cards) to deck, and clean up bench slot.
7. **Meowth ex Tuck Tail** (me3-62): `returnToHand{withAttached:true}` exists; verify it also returns evolution-stack cards.
8. **Judge / Lillie's / Unfair Stamp**: use `move` with `player:"both"` and `draw player:"both"`; verify both-player expansion (and that Unfair Stamp's shuffle includes opponent hand).
9. **Crushing Hammer / Night Stretcher / Poffin**: rely on `discard` with `from: Selector` for opp-attached Energy, `filter.any` in a discard-zone `move`, and `search to:"bench"` with `upTo` + `hpMax` filter respecting bench space. Believed supported; verify in Part 2 tests.
10. **Pecharunt ex Subjugating Chains** (sv6pt5-39): uses `bind` + `switch whichBench ref` + `status` on the same ref after switch; verify ref identity survives the switch.
11. **Dragapult ex Phantom Dive** (sv6-130): `counters` with `distribute:true` over `allOf(opp bench)` and `mode` "all" vs "divide" — verify the interpreter prompts for distribution of 6 counters (and handles KOs from counters).
12. **Fezandipiti ex Cruel Arrow** (me2pt5-142): `damage` to `pickOpp("play")` with `weakRes:false` for any target incl. Active.

## E. Cards with no gaps (data only): Dreepy, Drakloak (look/take/rest), N's Zorua, Yveltal, Moltres, Budew, Dunsparce, N's Reshiram, Cyrano, Poké Pad, Boss's Orders, N's PP Up, Buddy-Buddy Poffin, basic Energy.
