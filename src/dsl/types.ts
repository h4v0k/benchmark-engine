// Pokémon TCG Standard effect DSL. Every attack/ability/Trainer/Energy/rule-box text compiles to Entry[].
export type PlayerRef = "self" | "opp" | "both" | "active-player";
export type Zone = "deck" | "hand" | "discard" | "prizes" | "bench" | "active" | "play" | "lostzone" | "attached";
export type EnergyType = "G"|"R"|"W"|"L"|"P"|"F"|"D"|"M"|"N"|"C";
export type Status = "paralyzed" | "confused" | "asleep" | "burned" | "poisoned";
export type Num = number;

// ---- Amounts -------------------------------------------------------------
export type Amount =
  | number
  | { k: "count"; of: Selector | (CardFilter & { zone: Zone; player: PlayerRef; from?: Selector }); per?: number }  // N * count
  | { k: "flips"; n: Amount; per: number }                // N coins, per heads
  | { k: "flipUntilTails"; per: number }
  | { k: "prizesTaken"; player: PlayerRef } | { k: "prizesLeft"; player: PlayerRef }
  | { k: "damageCounters"; of: Selector }
  | { k: "handSize"; player: PlayerRef }
  | { k: "cardsDiscardedThisWay" }                        // result of preceding "you may discard"
  | { k: "math"; op: "+" | "*" | "-" | "min" | "max"; a: Amount; b: Amount }
  | { k: "upTo"; n: Amount } | { k: "any" } | { k: "all" };

// ---- Card / Pokémon filters ---------------------------------------------
export interface CardFilter {
  supertype?: "pokemon" | "trainer" | "energy";
  subtype?: ("item"|"tool"|"supporter"|"stadium"|"basic"|"stage1"|"stage2"|"special-energy"|"basic-energy"|"ace-spec"|"tera"|"ex"|"v"|"vmax"|"vstar"|"mega"|"future"|"ancient"|"rule-box")[];
  noRuleBox?: boolean;
  type?: EnergyType[]; name?: string; nameIncludes?: string; hpMax?: number; hpMin?: number;
  attackNamed?: string; abilityNamed?: string; evolvesFrom?: string;
  hasEnergy?: boolean; hasTool?: boolean; damaged?: boolean; not?: CardFilter; any?: CardFilter[];
}

// ---- Targeting -------------------------------------------------------------
// A Selector resolves to a set of Pokémon (or cards) in play; "choose" is a decision point for a player.
export type Selector =
  | { s: "self" }                                   // the Pokémon using/holding this effect
  | { s: "defending" }                              // opp active
  | { s: "attached-to" }                            // Tool/Energy host
  | { s: "pick"; player: PlayerRef; where: "active" | "bench" | "play"; filter?: CardFilter;
      count: Amount; chooser?: PlayerRef; mode?: "choose" | "random" | "all" | "divide" }
  | { s: "ref"; id: string };                       // bind earlier choice (Bind.as)
export type CardSel = { player: PlayerRef; zone: Zone; filter?: CardFilter; count: Amount;
  from?: Selector; chooser?: PlayerRef; reveal?: boolean; random?: boolean; position?: "top" | "bottom" | "any" };

// ---- Conditions ------------------------------------------------------------
export type Condition =
  | { c: "and" | "or"; of: Condition[] } | { c: "not"; of: Condition }
  | { c: "cmp"; a: Amount; op: "<" | "<=" | "=" | ">=" | ">"; b: Amount }
  | { c: "is"; who: Selector; filter: CardFilter }              // "opp's Active is a Pokémon ex"
  | { c: "has"; player: PlayerRef; zone: Zone; filter: CardFilter; min?: number } // "any Darkness Energy attached"
  | { c: "status"; who: Selector; status: Status }
  | { c: "coin" }                                                // heads (flip is performed here)
  | { c: "didPrev" }                                             // "if you do" / "if you drew any cards"
  | { c: "koLastTurn"; player: PlayerRef }                       // "were KO'd during opp's last turn"
  | { c: "stadiumInPlay"; name?: string } | { c: "firstTurn" } | { c: "lastCardInHand" }
  | { c: "inPlayActive" } | { c: "playedFromHandThisTurn" }
  | { c: "tagged"; key: string };                                // a `tag` with this key was set for the current player (e.g. "Last-Ditch" used this turn)

// ---- Effects (primitives) --------------------------------------------------
export type Effect =
  // composition
  | { e: "seq"; steps: Effect[] }
  | { e: "if"; cond: Condition; then: Effect; else?: Effect }
  | { e: "optional"; do: Effect; then?: Effect }                   // "you may X. If you do, Y"
  | { e: "repeat"; times: Amount; do: Effect }
  | { e: "choose"; options: Effect[]; n?: number }                 // "Choose 1: •A •B"
  | { e: "bind"; as: string; sel: Selector; then: Effect }
  | { e: "cost"; pay: Effect; then: Effect }                       // "discard 2 other cards to use this"
  // damage
  | { e: "damage"; to: Selector; amount: Amount; weakRes?: boolean; effects?: boolean }
  | { e: "damageMod"; amount: Amount; applyBeforeWeakness?: boolean } // "+N more", Amount can be per-X
  | { e: "counters"; to: Selector; n: Amount; distribute?: boolean; remove?: boolean }
  | { e: "heal"; to: Selector; amount: Amount }
  | { e: "selfDamage"; amount: Amount }
  | { e: "knockOut"; who: Selector }
  // conditions & flips
  | { e: "flip"; heads?: Effect; tails?: Effect; n?: Amount; each?: Effect }
  | { e: "status"; to: Selector; status: Status }
  | { e: "clearStatus"; to: Selector }
  // card movement (generic) + sugar
  | { e: "move"; sel: CardSel; to: Zone; dest?: Selector; position?: "top"|"bottom"|"shuffle"; order?: "any"; shuffleFirst?: boolean }
  // move N damage counters (n may be upTo) from the first Pokémon `from` selects to the first `to` selects; the number placed equals the number removed
  | { e: "moveCounters"; from: Selector; to: Selector; n: Amount }
  // search a zone for up to `upTo` cards matching `filter` (with `distinct` constraint between them); one goes to hand (player picks which), the other is attached to `b.attachTo`
  | { e: "searchSplit"; player: PlayerRef; zone?: Zone; filter: CardFilter; upTo: number; distinct?: "type" | "name"; a: { to: "hand" }; b: { attachTo: Selector }; shuffle?: boolean }
  | { e: "draw"; player: PlayerRef; n: Amount; untilHand?: Amount }
  | { e: "search"; player: PlayerRef; sel: CardSel; to: Zone; dest?: Selector; shuffle?: boolean }
  | { e: "shuffle"; player: PlayerRef; zone: Zone }
  | { e: "discard"; sel: CardSel }
  | { e: "look"; player: PlayerRef; zone: Zone; n: Amount; take?: Amount; rest?: "bottom"|"discard"|"top" }
  | { e: "attachEnergy"; sel: CardSel; to: Selector; free?: boolean }
  | { e: "moveEnergy"; from: Selector; to: Selector; filter?: CardFilter; count: Amount }
  | { e: "putOnBench"; sel: CardSel }
  | { e: "returnToHand"; who: Selector; withAttached?: boolean }
  | { e: "evolve"; from: Selector; sel: CardSel }
  // position
  | { e: "switch"; player: PlayerRef; whichBench: Selector; chooser?: PlayerRef } // active<->bench
  | { e: "retreatCost"; who: Selector; delta: number; duration: Duration }
  // persistence / restrictions / prevention
  | { e: "lock"; what: Lock; duration: Duration }
  | { e: "prevent"; from: "damage" | "effects" | "both"; who: Selector; sources?: CardFilter; duration: Duration }
  | { e: "modify"; stat: "hp" | "retreat" | "weakness" | "damageDealt" | "damageTaken" | "typeProvided" | "attackCost" | "toolSlots"; who: Selector;
      value: Amount | EnergyType; against?: Selector; /** damageDealt only: bonus applies only if the Defending Pokémon matches this filter at damage time */ againstFilter?: CardFilter; duration: Duration; beforeWR?: boolean }
  | { e: "copyAttack"; from: Selector; filter?: CardFilter; viaDiscardTop?: boolean }
  | { e: "useAgain" }
  | { e: "forEach"; over: Selector; bind: string; do: Effect }     // "for each of those Pokémon, ..." / "choose 1 ... 6 times"
  | { e: "reveal"; player: PlayerRef; sel: CardSel; to?: PlayerRef }  // hidden-info disclosure (hand, top N, prizes)
  | { e: "endTurn" } | { e: "noop" }                               // "your turn ends"; "this attack does nothing"
  | { e: "tag"; key: string; duration: Duration };                   // generic "remember" flag (used-this-turn etc.)

export type Duration = "now" | "thisTurn" | "oppNextTurn" | "yourNextTurn" | "whileInPlay" | "untilEndOfNextOppTurn";
export type Lock =
  | { l: "attack"; who: Selector; attackName?: string } | { l: "retreat"; who: Selector }
  | { l: "play"; player: PlayerRef; filter: CardFilter } | { l: "ability"; filter: CardFilter }
  | { l: "attackTry"; who: Selector; coinsMustBe: "heads" | "all-heads" }  // "if it tries to attack, flip; tails = fails"
  | { l: "heal"; who: Selector } | { l: "status"; who: Selector };

// ---- Triggers / Entries ------------------------------------------------------
export type Trigger =
  | { t: "attack"; name: string; cost: EnergyType[]; baseDamage?: number; damageSuffix?: "+" | "x" | "-" }
  | { t: "ability"; name: string; limit?: "oncePerTurn" | "oncePerGame" | "oncePerNamePerTurn"; requires?: Condition; costToUse?: Effect }
  | { t: "play"; supertype: "item" | "supporter" | "stadium" | "tool"; cost?: Effect; requires?: Condition; discardOnResolve?: boolean }
  | { t: "attach"; filter?: CardFilter }               // when attached from hand (special energy)
  | { t: "onPlayToBench"; fromHand: boolean }          // "when you play this Pokémon from hand onto bench"
  | { t: "onEvolve" } | { t: "onKnockedOut"; byAttack?: boolean }
  | { t: "onDamaged"; byAttack: boolean; active?: boolean; evenIfKO?: boolean }
  | { t: "wouldKO"; byAttack: boolean }                // replacement effect
  | { t: "endOfTurn"; whose: PlayerRef } | { t: "betweenTurns" }
  | { t: "static"; while?: Condition }                 // continuous rule modification
  | { t: "onPutOnBench"; whose: PlayerRef; filter?: CardFilter }
  | { t: "ruleBox"; rule: "ex" | "megaEx" | "v" | "vmax" | "vstar" | "tera" | "aceSpec" | "prismStar" | "radiantDeckLimit"; prizes?: number };

export interface Entry { trigger: Trigger; effect: Effect; text?: string }
export type DslCardDef = { id: string; entries: Entry[] };

// ---- Helpers --------------------------------------------------------------------
export const SELF: Selector = { s: "self" }, DEF: Selector = { s: "defending" };
export const oppBench = (count: Amount = 1, filter?: CardFilter): Selector =>
  ({ s: "pick", player: "opp", where: "bench", filter, count, chooser: "self" as PlayerRef });
