// Dragapult ex deck (Regional Recife 2026-10-03, 3rd place, Pedro Pertusi) — cards not shared with the Zoroark deck.
import { DEF, SELF, type Condition } from "../../dsl/types.js";
import type { CardDef } from "../model.js";
import { atk, weak, EX_RULE, pkmn, trainer, play, pickSelf, pickOpp, allOf } from "./shared.js";

export const DREEPY = pkmn("sv6", "TWM", "128", "H", {
  name: "Dreepy", subtypes: ["Basic"], hp: 70, types: ["N"], retreatCost: 1,
  text: "Petty Grudge [P] 10 | Bite [RP] 40",
  attacks: [atk("Petty Grudge", ["P"], 10, ""), atk("Bite", ["R", "P"], 40, "")],
});
export const DRAKLOAK = pkmn("sv6", "TWM", "129", "H", {
  name: "Drakloak", subtypes: ["Stage1"], hp: 90, types: ["N"], evolvesFrom: "Dreepy", retreatCost: 1,
  text: "Recon Directive: Once during your turn, you may look at the top 2 cards of your deck and put 1 of them into your hand. Put the other card on the bottom of your deck. | Dragon Headbutt [RP] 70",
  abilities: [{
    name: "Recon Directive", limit: "oncePerTurn", text: "Once during your turn, you may look at the top 2 cards of your deck and put 1 of them into your hand. Put the other card on the bottom of your deck.",
    trigger: { t: "ability", name: "Recon Directive", limit: "oncePerTurn" },
    effect: { e: "look", player: "self", zone: "deck", n: 2, take: 1, rest: "bottom" },
  }],
  attacks: [atk("Dragon Headbutt", ["R", "P"], 70, "")],
});
export const DRAGAPULT_EX = pkmn("sv6", "TWM", "130", "H", {
  name: "Dragapult ex", subtypes: ["Stage2", "Tera", "ex"], hp: 320, types: ["N"], evolvesFrom: "Drakloak", retreatCost: 1, prizeValue: 2,
  text: "Jet Headbutt [C] 70 | Phantom Dive [RP] 200: Put 6 damage counters on your opponent's Benched Pokémon in any way you like. | Tera: As long as this Pokémon is on your Bench, prevent all damage done to this Pokémon by attacks (both yours and your opponent's). | Pokémon ex rule: 2 Prize cards.",
  attacks: [
    atk("Jet Headbutt", ["C"], 70, ""),
    atk("Phantom Dive", ["R", "P"], 200, "Put 6 damage counters on your opponent's Benched Pokémon in any way you like.",
      { e: "counters", to: allOf("opp", "bench"), n: 6, distribute: true }),
  ],
  rules: [
    EX_RULE,
    { trigger: { t: "ruleBox", rule: "tera" }, effect: { e: "noop" }, text: "Tera" },
    { trigger: { t: "static", while: { c: "not", of: { c: "inPlayActive" } } }, text: "As long as this Pokémon is on your Bench, prevent all damage done to this Pokémon by attacks (both yours and your opponent's).",
      effect: { e: "prevent", from: "damage", who: SELF, duration: "whileInPlay" } },
  ],
});
export const DUNSPARCE = pkmn("sv5", "TEF", "128", "H", {
  name: "Dunsparce", subtypes: ["Basic"], hp: 60, types: ["C"], weakness: weak("F"), retreatCost: 0,
  text: "Gnaw [C] 10 | Dig [CC] 30: Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
  attacks: [atk("Gnaw", ["C"], 10, ""), atk("Dig", ["C", "C"], 30, "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
    { e: "flip", heads: { e: "prevent", from: "both", who: SELF, duration: "oppNextTurn" } })],
});
export const DUDUNSPARCE = pkmn("sv5", "TEF", "129", "H", {
  name: "Dudunsparce", subtypes: ["Stage1"], hp: 140, types: ["C"], evolvesFrom: "Dunsparce", weakness: weak("F"), retreatCost: 3,
  text: "Run Away Draw: Once during your turn, you may draw 3 cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck. | Land Crush [CCC] 90",
  abilities: [{
    name: "Run Away Draw", limit: "oncePerTurn", text: "Once during your turn, you may draw 3 cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck.",
    trigger: { t: "ability", name: "Run Away Draw", limit: "oncePerTurn" },
    effect: { e: "optional", do: { e: "seq", steps: [
      { e: "draw", player: "self", n: 3 },
      { e: "if", cond: { c: "didPrev" }, then: { e: "move", sel: { player: "self", zone: "play", from: SELF, count: { k: "all" } }, to: "deck", position: "shuffle" } },
    ] } },
  }],
  attacks: [atk("Land Crush", ["C", "C", "C"], 90, "")],
});
export const MOLTRES = pkmn("me2", "PFL", "14", "I", {
  name: "Moltres", subtypes: ["Basic"], hp: 120, types: ["R"], weakness: weak("W"), retreatCost: 1,
  text: "Fighting Wings [R] 20+: If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage.",
  attacks: [atk("Fighting Wings", ["R"], 20, "If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage.",
    { e: "if", cond: { c: "is", who: DEF, filter: { subtype: ["ex"] } }, then: { e: "damageMod", amount: 90 } }, "+")],
});
export const FEZANDIPITI_EX = pkmn("me2pt5", "ASC", "142", "H", {
  name: "Fezandipiti ex", subtypes: ["Basic", "ex"], hp: 210, types: ["D"], weakness: weak("F"), retreatCost: 1, prizeValue: 2,
  text: "Flip the Script: Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn. | Cruel Arrow [CCC]: This attack does 100 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) | Pokémon ex rule.",
  rules: [EX_RULE],
  abilities: [{
    name: "Flip the Script", limit: "oncePerTurn", text: "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn.",
    trigger: { t: "ability", name: "Flip the Script", limit: "oncePerNamePerTurn", requires: { c: "koLastTurn", player: "self" } },
    requires: { c: "koLastTurn", player: "self" },
    effect: { e: "optional", do: { e: "draw", player: "self", n: 3 } },
  }],
  attacks: [atk("Cruel Arrow", ["C", "C", "C"], null, "This attack does 100 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    { e: "damage", to: pickOpp("play"), amount: 100 })], // W/R applies to the Active target only (the engine never applies it to Benched Pokémon)
});

// ---- Trainers only in this deck ----
export const CRISPIN = trainer("sv7", "SCR", "133", "H", "Crispin", "Supporter", [play("supporter",
  { e: "searchSplit", player: "self", filter: { subtype: ["basic-energy"] }, upTo: 2, distinct: "type", a: { to: "hand" }, b: { attachTo: pickSelf("play") }, shuffle: true })], "Search your deck for up to 2 Basic Energy cards of different types, reveal them, and put 1 of them into your hand. Attach the other to 1 of your Pokémon. Then, shuffle your deck.");

const morePrizes: Condition = { c: "cmp", a: { k: "prizesLeft", player: "self" }, op: ">", b: { k: "prizesLeft", player: "opp" } };
export const ROSAS_ENCOURAGEMENT = trainer("me3", "POR", "84", "J", "Rosa's Encouragement", "Supporter", [play("supporter", {
  e: "attachEnergy", sel: { player: "self", zone: "discard", filter: { subtype: ["basic-energy"] }, count: { k: "upTo", n: 2 } },
  to: pickSelf("play", { subtype: ["stage2"] }),
}, { requires: morePrizes })], "You can use this card only if you have more Prize cards remaining than your opponent. Attach up to 2 Basic Energy cards from your discard pile to 1 of your Stage 2 Pokémon.");

export const CRUSHING_HAMMER = trainer("me3", "POR", "71", "J", "Crushing Hammer", "Item", [play("item", {
  e: "flip", heads: { e: "discard", sel: { player: "opp", zone: "attached", from: pickOpp("play", { hasEnergy: true }), filter: { supertype: "energy" }, count: 1, chooser: "self" } },
})], "Flip a coin. If heads, discard an Energy from 1 of your opponent's Pokémon.");

export const RISKY_RUINS = trainer("me1", "MEG", "127", "I", "Risky Ruins", "Stadium", [
  play("stadium", { e: "noop" }),
  { trigger: { t: "onPutOnBench", whose: "both", filter: { supertype: "pokemon", subtype: ["basic"], not: { type: ["D"] } } },
    text: "Whenever any player puts a Basic non-Darkness Pokémon onto their Bench during their turn, place 2 damage counters on that Pokémon.",
    effect: { e: "counters", to: { s: "ref", id: "benched" }, n: 2 } }, // GAP: needs trigger-supplied 'benched' ref + 'during their turn' check
], "Whenever any player puts a Basic non-Darkness Pokémon onto their Bench during their turn, place 2 damage counters on that Pokémon.");

export const DRAGAPULT_DEFS: CardDef[] = [
  DREEPY, DRAKLOAK, DRAGAPULT_EX, DUNSPARCE, DUDUNSPARCE, MOLTRES, FEZANDIPITI_EX,
  CRISPIN, ROSAS_ENCOURAGEMENT, CRUSHING_HAMMER, RISKY_RUINS,
];
