// Cards used by both Standard decks (Dragapult ex / N's Zoroark ex) + helpers. Card ids are `${setId}-${number}`.
// `text` holds the printed card text next to the DSL so reviewers can compare. Source: pokemon-tcg-data via scripts/extract-cards.mjs.
import { DEF, SELF, type Effect, type Entry, type EnergyType, type CardFilter, type Selector, type Condition } from "../../dsl/types.js";
import type { CardDef, AttackDef } from "../model.js";

// ---- helpers (exported for dragapult.ts / zoroark.ts) ----
export const play = (supertype: "item" | "supporter" | "stadium" | "tool", effect: Effect, extra: { requires?: Condition; cost?: Effect } = {}, text?: string): Entry =>
  ({ trigger: { t: "play", supertype, ...extra }, effect, text });
export const weak = (type: EnergyType) => ({ type, multiplier: 2 as const });
export const resist = (type: EnergyType) => ({ type, amount: 30 as const });
export const atk = (name: string, cost: EnergyType[], damage: number | null, text: string, effect?: Effect, damageSuffix?: "+" | "x" | "-"): AttackDef =>
  ({ name, cost, damage, text, ...(effect ? { effect } : {}), ...(damageSuffix ? { damageSuffix } : {}) });
export const EX_RULE: Entry = { trigger: { t: "ruleBox", rule: "ex", prizes: 2 }, effect: { e: "noop" }, text: "Pokémon ex rule: When your Pokémon ex is Knocked Out, your opponent takes 2 Prize cards." };
export const ACE_SPEC_RULE: Entry = { trigger: { t: "ruleBox", rule: "aceSpec" }, effect: { e: "noop" }, text: "ACE SPEC: You can't have more than 1 ACE SPEC card in your deck." };
export const pickSelf = (where: "active" | "bench" | "play", filter?: CardFilter, count = 1): Selector => ({ s: "pick", player: "self", where, filter, count, chooser: "self" });
export const pickOpp = (where: "active" | "bench" | "play", filter?: CardFilter, count = 1): Selector => ({ s: "pick", player: "opp", where, filter, count, chooser: "self" });
export const allOf = (player: "self" | "opp" | "both", where: "active" | "bench" | "play", filter?: CardFilter): Selector =>
  ({ s: "pick", player, where, filter, count: { k: "all" }, mode: "all" });
const common = (setId: string, setCode: string, number: string, mark: string) => ({ id: `${setId}-${number}`, setCode, number, regulationMark: mark });
export const pkmn = (setId: string, setCode: string, number: string, mark: string, d: Omit<CardDef, "id" | "setCode" | "number" | "regulationMark" | "supertype">): CardDef =>
  ({ ...common(setId, setCode, number, mark), supertype: "Pokemon", ...d });
export const trainer = (setId: string, setCode: string, number: string, mark: string, name: string, sub: "Item" | "Supporter" | "Stadium" | "Tool", rules: Entry[], text: string, extraSubs: ("AceSpec")[] = []): CardDef =>
  ({ ...common(setId, setCode, number, mark), name, supertype: "Trainer", subtypes: [sub, ...extraSubs], rules, text });

// ---- Basic Energy (synthesized; Limitless lists Mega Evolution Energy printings) ----
const basicEnergy = (id: string, name: string, t: EnergyType): CardDef =>
  ({ id, name, supertype: "Energy", subtypes: ["Basic Energy"], types: [t], setCode: "MEE", text: `Basic ${name}` });
export const FIRE_ENERGY = basicEnergy("basic-r", "Fire Energy", "R");
export const PSYCHIC_ENERGY = basicEnergy("basic-p", "Psychic Energy", "P");
export const DARKNESS_ENERGY = basicEnergy("basic-d", "Darkness Energy", "D");

// ---- shared Pokémon ----
export const MUNKIDORI = pkmn("sv6", "TWM", "95", "H", {
  name: "Munkidori", subtypes: ["Basic"], hp: 110, types: ["P"], weakness: weak("D"), resistance: resist("F"), retreatCost: 1,
  text: "Adrena-Brain: Once during your turn, if this Pokémon has any Darkness Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon. | Mind Bend [PC] 60: Your opponent's Active Pokémon is now Confused.",
  abilities: [{
    name: "Adrena-Brain", limit: "oncePerTurn", text: "Once during your turn, if this Pokémon has any Darkness Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.",
    // "if THIS Pokémon has any Darkness Energy attached" -> only Energy on Munkidori itself counts
    trigger: { t: "ability", name: "Adrena-Brain", limit: "oncePerTurn", requires: { c: "has", player: "self", zone: "attached", from: SELF, filter: { type: ["D"], supertype: "energy" } } },
    requires: { c: "has", player: "self", zone: "attached", from: SELF, filter: { type: ["D"], supertype: "energy" } },
    effect: { e: "optional", do: { e: "bind", as: "src", sel: pickSelf("play", { damaged: true }), then: { e: "bind", as: "dst", sel: pickOpp("play"),
      then: { e: "moveCounters", from: { s: "ref", id: "src" }, to: { s: "ref", id: "dst" }, n: { k: "upTo", n: 3 } } } } },
  }],
  attacks: [atk("Mind Bend", ["P", "C"], 60, "Your opponent's Active Pokémon is now Confused.", { e: "status", to: DEF, status: "confused" })],
});

export const BUDEW = pkmn("me2pt5", "ASC", "16", "H", {
  name: "Budew", subtypes: ["Basic"], hp: 30, types: ["G"], weakness: weak("R"), retreatCost: 0,
  text: "Itchy Pollen [] 10: During your opponent's next turn, they can't play any Item cards from their hand.",
  attacks: [atk("Itchy Pollen", [], 10, "During your opponent's next turn, they can't play any Item cards from their hand.",
    { e: "lock", what: { l: "play", player: "opp", filter: { supertype: "trainer", subtype: ["item"] } }, duration: "oppNextTurn" })],
});

export const MEOWTH_EX = pkmn("me3", "POR", "62", "J", {
  name: "Meowth ex", subtypes: ["Basic", "ex"], hp: 170, types: ["C"], weakness: weak("F"), retreatCost: 1, prizeValue: 2,
  text: "Last-Ditch Catch: Once during your turn, when you play this Pokémon from your hand onto your Bench, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck. You can't use more than 1 Ability that has \"Last-Ditch\" in its name each turn. | Tuck Tail [CCC] 60: Put this Pokémon and all attached cards into your hand.",
  rules: [EX_RULE, {
    trigger: { t: "onPlayToBench", fromHand: true }, text: "Last-Ditch Catch (see text); name-limited: only 1 'Last-Ditch' Ability per turn",
    effect: { e: "if", cond: { c: "not", of: { c: "tagged", key: "last-ditch" } }, then: { e: "optional", do: { e: "seq", steps: [
      { e: "tag", key: "last-ditch", duration: "thisTurn" },
      { e: "search", player: "self", to: "hand", shuffle: true, sel: { player: "self", zone: "deck", filter: { supertype: "trainer", subtype: ["supporter"] }, count: 1, reveal: true } },
    ] } } },
  }],
  attacks: [atk("Tuck Tail", ["C", "C", "C"], 60, "Put this Pokémon and all attached cards into your hand.", { e: "returnToHand", who: SELF, withAttached: true })],
});

// ---- shared Trainers ----
export const LILLIES_DETERMINATION = trainer("me1", "MEG", "119", "I", "Lillie's Determination", "Supporter", [play("supporter", { e: "seq", steps: [
  { e: "move", sel: { player: "self", zone: "hand", count: { k: "all" } }, to: "deck", position: "shuffle" },
  { e: "if", cond: { c: "cmp", a: { k: "prizesLeft", player: "self" }, op: "=", b: 6 }, then: { e: "draw", player: "self", n: 8 }, else: { e: "draw", player: "self", n: 6 } },
] })], "Shuffle your hand into your deck. Then, draw 6 cards. If you have exactly 6 Prize cards remaining, draw 8 cards instead.");

export const BOSS_ORDERS = trainer("me1", "MEG", "114", "I", "Boss's Orders", "Supporter", [play("supporter", {
  e: "switch", player: "opp", chooser: "self", whichBench: pickOpp("bench"),
})], "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.");

export const JUDGE = trainer("me3", "POR", "76", "J", "Judge", "Supporter", [play("supporter", { e: "seq", steps: [
  { e: "move", sel: { player: "both", zone: "hand", count: { k: "all" } }, to: "deck", position: "shuffle" },
  { e: "draw", player: "both", n: 4 },
] })], "Each player shuffles their hand into their deck and draws 4 cards.");

export const BUDDY_BUDDY_POFFIN = trainer("sv5", "TEF", "144", "H", "Buddy-Buddy Poffin", "Item", [play("item", {
  e: "search", player: "self", to: "bench", shuffle: true,
  sel: { player: "self", zone: "deck", filter: { supertype: "pokemon", subtype: ["basic"], hpMax: 70 }, count: { k: "upTo", n: 2 } },
})], "Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench. Then, shuffle your deck.");

export const ULTRA_BALL = trainer("me1", "MEG", "131", "I", "Ultra Ball", "Item", [play("item", {
  e: "cost",
  pay: { e: "discard", sel: { player: "self", zone: "hand", count: 2, chooser: "self" } },
  then: { e: "search", player: "self", to: "hand", shuffle: true, sel: { player: "self", zone: "deck", filter: { supertype: "pokemon" }, count: 1, reveal: true } },
}, { requires: { c: "cmp", a: { k: "handSize", player: "self" }, op: ">=", b: 3 } })], // hand includes Ultra Ball itself: needs 2 OTHER cards
"You can use this card only if you discard 2 other cards from your hand. Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.");

export const NIGHT_STRETCHER = trainer("me2pt5", "ASC", "196", "H", "Night Stretcher", "Item", [play("item", {
  e: "move", to: "hand",
  sel: { player: "self", zone: "discard", filter: { any: [{ supertype: "pokemon" }, { subtype: ["basic-energy"] }] }, count: 1, chooser: "self" },
})], "Put a Pokémon or a Basic Energy card from your discard pile into your hand.");

export const POKE_PAD = trainer("me3", "POR", "81", "J", "Poké Pad", "Item", [play("item", {
  e: "search", player: "self", to: "hand", shuffle: true,
  sel: { player: "self", zone: "deck", filter: { supertype: "pokemon", noRuleBox: true }, count: 1, reveal: true },
})], "Search your deck for a Pokémon that doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck.");

export const UNFAIR_STAMP = trainer("sv6", "TWM", "165", "H", "Unfair Stamp", "Item", [
  play("item", { e: "seq", steps: [
    { e: "move", sel: { player: "both", zone: "hand", count: { k: "all" } }, to: "deck", position: "shuffle" },
    { e: "draw", player: "self", n: 5 },
    { e: "draw", player: "opp", n: 2 },
  ] }, { requires: { c: "koLastTurn", player: "self" } }),
  ACE_SPEC_RULE,
], "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn. Each player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 2 cards. (ACE SPEC: max 1 in deck)", ["AceSpec"]);

export const SHARED_DEFS: CardDef[] = [
  FIRE_ENERGY, PSYCHIC_ENERGY, DARKNESS_ENERGY, MUNKIDORI, BUDEW, MEOWTH_EX,
  LILLIES_DETERMINATION, BOSS_ORDERS, JUDGE, BUDDY_BUDDY_POFFIN, ULTRA_BALL, NIGHT_STRETCHER, POKE_PAD, UNFAIR_STAMP,
];
