# Pokémon TCG effect DSL (design)

Types live in `dsl.ts`. A card = `Entry[]`, each `(Trigger, Effect)`. Effects/Conditions/Amounts/Selectors are plain JSON-able discriminated unions, so cards are data, can be validated, and interpreted by one resolver.

## Primitive families
- **Composition**: `seq`, `if`(Condition), `optional` (+ "if you do" via `then`), `repeat`, `choose` (Choose 1 •A •B), `bind` (name a selection for later steps), `forEach`, `cost` (pay-to-use).
- **Damage**: `damage(to, amount)`, `damageMod` (+N, per-X via Amount), `counters` (place/remove/distribute), `heal`, `selfDamage`, `knockOut`. `damage.weakRes=false` for bench/"not affected by weakness" text.
- **Coins/status**: `flip` (heads/tails branches, n coins, `each`), `status`, `clearStatus`. Coin-count damage = Amount `flips`/`flipUntilTails`.
- **Cards/zones**: `move` (generic), sugar `draw`, `search`, `discard`, `look`, `reveal`, `shuffle`, `attachEnergy`, `moveEnergy`, `putOnBench`, `returnToHand`, `evolve`.
- **Position**: `switch`, retreat-cost changes.
- **Persistence**: `lock` (attack/retreat/play/ability/heal/status/attackTry), `prevent`, `modify` (hp, retreat, weakness, damage dealt/taken, energy type provided, attack cost, tool slots), each with a `Duration`.
- **Meta**: `copyAttack`, `useAgain`, `endTurn`, `noop`, `tag`.

## Composition / amounts / conditions
`seq` runs steps in order sharing a frame (bound selectors, `didPrev`, `cardsDiscardedThisWay`). `if.cond` is a pure predicate; `{c:"coin"}` flips at evaluation. `Amount` is a number or an expression: `count`, `flips`, `prizesTaken`, `damageCounters`, `handSize`, `math`. "20 damage for each X" = `damage(amount={count, per:20})`; "+N more if C" = `if(C, damageMod(N))`. Base printed damage lives in the attack Trigger; `damageMod`s accumulate before weakness/resistance, then the engine applies W/R unless suppressed.

## Targeting / selection
`Selector` resolves to Pokémon: `self`, `defending`, `attached-to`, or `pick{player, where, filter, count, chooser, mode}`. `chooser` models "your opponent chooses" (e.g. forced switch). `CardSel` does the same for cards in a zone (filter, count, `upTo`, reveal, position). Choices are surfaced to the engine as explicit decision requests (player, legal set, min/max), which makes AI/UI/replay uniform.

## Coin flips and hidden information
Randomness goes through an injected RNG; every flip/shuffle is logged as an event so games replay. Hidden zones (deck, hand, prizes) are never enumerated to the chooser: `search` presents the full deck to the searcher (they may fail to find), `reveal` is a separate step so "reveal and put into hand" shows the opponent. Prizes: random/face-down; only `reveal`/`look` primitives (or "any time" engine rules) expose them. `random:true` on a CardSel = engine picks.

## Card -> entries
Attack -> `{t:attack,...}`; Ability -> `{t:ability, limit, requires}`; Item/Supporter/Stadium -> `{t:play}`; Tool/special Energy: `static`, `onDamaged`, `attach`; rule boxes -> `{t:ruleBox}` (prize count, Tera bench immunity = `static`+`prevent`). The engine owns universal rules (one Supporter/turn, once-per-turn tracking keyed by (card instance, ability name), first-turn limits); `limit` is just metadata for it.

## Worked examples
1. **Gust** ("Switch in 1 of your opponent's benched Pokémon"):
`{trigger:{t:"play",supertype:"item"}, effect:{e:"switch",player:"opp",whichBench:{s:"pick",player:"opp",where:"bench",count:1,chooser:"self"},chooser:"self"}}`
2. **Search** ("Search your deck for a Pokémon, reveal it, put in hand, shuffle"):
`{e:"search",player:"self",sel:{player:"self",zone:"deck",filter:{supertype:"pokemon"},count:1,reveal:true},to:"hand",shuffle:true}`
3. **Coin-flip status attack** ("Flip a coin. If heads, Defending is now Paralyzed"):
`{e:"flip",heads:{e:"status",to:DEF,status:"paralyzed"}}`
4. **Counter placement** ("Put 6 damage counters on opp's Benched in any way you like"):
`{e:"counters",to:{s:"pick",player:"opp",where:"bench",count:{k:"all"},mode:"divide"},n:6,distribute:true}`
5. **Once-per-turn ability** ("Once during your turn, if this has Darkness Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of opp's"): Trigger `{t:"ability",name,limit:"oncePerTurn",requires:{c:"has",player:"self",zone:"attached",filter:{type:["D"]}}}`; effect `optional{do:bind(src=pick self play, bind(dst=pick opp play, seq[counters(src,remove 3 upTo), counters(dst,+same)]))}`.
6. **Supporter draw** ("Shuffle your hand into your deck. Then draw 6; if exactly 6 Prizes remain draw 8"):
`seq[move(hand->deck,shuffle), draw(self, if(cmp(prizesLeft(self)=6),8,6))]` (use `if` around two `draw`s).
7. **Tool** ("+100 HP"): Entry `{t:"static"}` -> `{e:"modify",stat:"hp",who:{s:"attached-to"},value:100,duration:"whileInPlay"}`.
8. **Damage mod on energy** ("+30 for each Energy on both Active Pokémon"):
`{e:"damageMod",amount:{k:"count",per:30,of:{player:"both",zone:"attached",filter:{supertype:"energy"},from:active}}}` ; "If Active is ex, +80" = `if({c:"is",who:DEF,filter:{subtype:["ex"]}}, damageMod(80))`.

## Coverage
`scripts/dsl_coverage.py` (clause-level regex per family; approximation only). See report for numbers.
