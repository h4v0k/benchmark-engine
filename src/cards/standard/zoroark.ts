// N's Zoroark ex deck (Regional Recife 2026-10-03, 4th place, Marco Cifuentes Meta) — cards not shared with the Dragapult deck.
import { DEF, SELF, type Condition } from "../../dsl/types.js";
import type { CardDef } from "../model.js";
import { atk, weak, resist, EX_RULE, pkmn, trainer, play, pickSelf, pickOpp, allOf } from "./shared.js";

const N_POKEMON = { supertype: "pokemon", nameIncludes: "N's" } as const;

export const NS_ZORUA = pkmn("sv9", "JTG", "97", "I", {
  name: "N's Zorua", subtypes: ["Basic"], hp: 70, types: ["D"], weakness: weak("G"), retreatCost: 1,
  text: "Scratch [D] 20", attacks: [atk("Scratch", ["D"], 20, "")],
});
export const NS_ZOROARK_EX = pkmn("sv9", "JTG", "98", "I", {
  name: "N's Zoroark ex", subtypes: ["Stage1", "ex"], hp: 280, types: ["D"], evolvesFrom: "N's Zorua", weakness: weak("G"), retreatCost: 2, prizeValue: 2,
  text: "Trade: You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards. | Night Joker [DD]: Choose 1 of your Benched N's Pokémon's attacks and use it as this attack. | Pokémon ex rule.",
  rules: [EX_RULE],
  abilities: [{
    name: "Trade", limit: "oncePerTurn", text: "You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.",
    trigger: { t: "ability", name: "Trade", limit: "oncePerTurn",
      costToUse: { e: "discard", sel: { player: "self", zone: "hand", count: 1, chooser: "self" } } },
    effect: { e: "draw", player: "self", n: 2 },
  }],
  attacks: [atk("Night Joker", ["D", "D"], null, "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.",
    { e: "copyAttack", from: pickSelf("bench", N_POKEMON) })],
});
export const NS_ZEKROM = pkmn("me2pt5", "ASC", "155", "I", {
  name: "N's Zekrom", subtypes: ["Basic"], hp: 130, types: ["N"], retreatCost: 2,
  text: "Shred [CCC] 70: This attack's damage isn't affected by any effects on your opponent's Active Pokémon. | Rampaging Thunder [RLLC] 250: During your next turn, this Pokémon can't use attacks.",
  attacks: [
    atk("Shred", ["C", "C", "C"], null, "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.",
      { e: "damage", to: DEF, amount: 70, effects: false }),
    atk("Rampaging Thunder", ["R", "L", "L", "C"], 250, "During your next turn, this Pokémon can't use attacks.",
      { e: "lock", what: { l: "attack", who: SELF }, duration: "yourNextTurn" }),
  ],
});
export const NS_RESHIRAM = pkmn("sv9", "JTG", "116", "I", {
  name: "N's Reshiram", subtypes: ["Basic"], hp: 130, types: ["N"], retreatCost: 2,
  text: "Powerful Rage [RL] 20x: This attack does 20 damage for each damage counter on this Pokémon. | Virtuous Flame [RRLC] 170",
  attacks: [
    atk("Powerful Rage", ["R", "L"], null, "This attack does 20 damage for each damage counter on this Pokémon.",
      { e: "damage", to: DEF, amount: { k: "math", op: "*", a: { k: "damageCounters", of: SELF }, b: 20 } }, "x"),
    atk("Virtuous Flame", ["R", "R", "L", "C"], 170, ""),
  ],
});
export const PECHARUNT_EX = pkmn("sv6pt5", "SFA", "39", "H", {
  name: "Pecharunt ex", subtypes: ["Basic", "ex"], hp: 190, types: ["D"], weakness: weak("F"), retreatCost: 1, prizeValue: 2,
  text: "Subjugating Chains: Once during your turn, you may switch 1 of your Benched Darkness Pokémon, except any Pecharunt ex, with your Active Pokémon. If you do, the new Active Pokémon is now Poisoned. You can't use more than 1 Subjugating Chains Ability each turn. | Irritated Outburst [DD] 60x: This attack does 60 damage for each Prize card your opponent has taken. | Pokémon ex rule.",
  rules: [EX_RULE],
  abilities: [{
    name: "Subjugating Chains", limit: "oncePerTurn", text: "Once during your turn, you may switch 1 of your Benched Darkness Pokémon, except any Pecharunt ex, with your Active Pokémon. If you do, the new Active Pokémon is now Poisoned. You can't use more than 1 Subjugating Chains Ability each turn.",
    trigger: { t: "ability", name: "Subjugating Chains", limit: "oncePerNamePerTurn" },
    effect: { e: "optional", do: { e: "bind", as: "newActive", sel: pickSelf("bench", { type: ["D"], not: { name: "Pecharunt ex" } }), then: { e: "seq", steps: [
      { e: "switch", player: "self", whichBench: { s: "ref", id: "newActive" } },
      { e: "status", to: { s: "ref", id: "newActive" }, status: "poisoned" },
    ] } } },
  }],
  attacks: [atk("Irritated Outburst", ["D", "D"], null, "This attack does 60 damage for each Prize card your opponent has taken.",
    { e: "damage", to: DEF, amount: { k: "math", op: "*", a: { k: "prizesTaken", player: "opp" }, b: 60 } }, "x")],
});
export const YVELTAL = pkmn("me1", "MEG", "88", "I", {
  name: "Yveltal", subtypes: ["Basic"], hp: 110, types: ["D"], weakness: weak("L"), resistance: resist("F"), retreatCost: 0,
  text: "Clutch [D] 20: During your opponent's next turn, the Defending Pokémon can't retreat. | Dark Feather [DDC] 110",
  attacks: [
    atk("Clutch", ["D"], 20, "During your opponent's next turn, the Defending Pokémon can't retreat.", { e: "lock", what: { l: "retreat", who: DEF }, duration: "oppNextTurn" }),
    atk("Dark Feather", ["D", "D", "C"], 110, ""),
  ],
});

// ---- Trainers only in this deck ----
export const BLACK_BELTS_TRAINING = trainer("sv9", "JTG", "143", "H", "Black Belt's Training", "Supporter", [play("supporter", {
  e: "modify", stat: "damageDealt", who: allOf("self", "play"), value: 40, duration: "thisTurn", beforeWR: true,
  against: pickOpp("active", { subtype: ["ex"] }), // GAP: conditional-on-target-filter is expressed through `against` selector; verify semantics
})], "During this turn, attacks used by your Pokémon do 40 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance).");

export const CYRANO = trainer("sv8", "SSP", "170", "H", "Cyrano", "Supporter", [play("supporter", {
  e: "search", player: "self", to: "hand", shuffle: true,
  sel: { player: "self", zone: "deck", filter: { supertype: "pokemon", subtype: ["ex"] }, count: { k: "upTo", n: 3 }, reveal: true },
})], "Search your deck for up to 3 Pokémon ex, reveal them, and put them into your hand. Then, shuffle your deck.");

export const NS_PP_UP = trainer("sv9", "JTG", "153", "I", "N's PP Up", "Item", [play("item", {
  e: "attachEnergy", sel: { player: "self", zone: "discard", filter: { subtype: ["basic-energy"] }, count: 1 },
  to: pickSelf("bench", { nameIncludes: "N's" }),
})], "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon.");

const oppPrizesLow: Condition = { c: "cmp", a: { k: "prizesLeft", player: "opp" }, op: "<=", b: 3 };
export const SPECIAL_RED_CARD = trainer("me4", "CRI", "82", "J", "Special Red Card", "Item", [play("item", { e: "seq", steps: [
  { e: "move", sel: { player: "opp", zone: "hand", count: { k: "all" } }, to: "deck", position: "bottom" },
  { e: "if", cond: { c: "didPrev" }, then: { e: "draw", player: "opp", n: 3 } },
] }, { requires: oppPrizesLow })], "You can use this card only if your opponent has 3 or fewer Prize cards remaining. Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 3 cards.");

export const PUNK_HELMET = trainer("me2", "PFL", "92", "I", "Punk Helmet", "Tool", [
  { trigger: { t: "onDamaged", byAttack: true, active: true, evenIfKO: true },
    text: "If the Darkness Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 4 damage counters on the Attacking Pokémon.",
    effect: { e: "if", cond: { c: "is", who: { s: "attached-to" }, filter: { type: ["D"] } },
      then: { e: "counters", to: { s: "ref", id: "attacker" }, n: 4 } } }, // GAP: trigger-supplied 'attacker' ref
], "If the Darkness Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 4 damage counters on the Attacking Pokémon.");

export const NS_CASTLE = trainer("sv9", "JTG", "152", "I", "N's Castle", "Stadium", [
  play("stadium", { e: "noop" }),
  { trigger: { t: "static" }, text: "N's Pokémon in play (both yours and your opponent's) have no Retreat Cost.",
    effect: { e: "retreatCost", who: allOf("both", "play", { nameIncludes: "N's" }), delta: -99, duration: "whileInPlay" } },
], "N's Pokémon in play (both yours and your opponent's) have no Retreat Cost.");

export const TR_WATCHTOWER = trainer("sv10", "DRI", "180", "I", "Team Rocket's Watchtower", "Stadium", [
  play("stadium", { e: "noop" }),
  { trigger: { t: "static" }, text: "Colorless Pokémon in play (both yours and your opponent's) have no Abilities.",
    effect: { e: "lock", what: { l: "ability", filter: { supertype: "pokemon", type: ["C"] } }, duration: "whileInPlay" } },
], "Colorless Pokémon in play (both yours and your opponent's) have no Abilities.");

export const ZOROARK_DEFS: CardDef[] = [
  NS_ZORUA, NS_ZOROARK_EX, NS_ZEKROM, NS_RESHIRAM, PECHARUNT_EX, YVELTAL,
  BLACK_BELTS_TRAINING, CYRANO, NS_PP_UP, SPECIAL_RED_CARD, PUNK_HELMET, NS_CASTLE, TR_WATCHTOWER,
];
