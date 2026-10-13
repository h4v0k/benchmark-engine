// Small hand-written card set, defined directly in the DSL, enough to play real games end to end.
import { DEF, SELF, type Entry, type EnergyType } from "../dsl/types.js";
import type { CardDef } from "./model.js";

const play = (supertype: "item" | "supporter" | "stadium" | "tool", effect: Entry["effect"]): Entry => ({ trigger: { t: "play", supertype }, effect });
const fx = (type: EnergyType) => ({ type, multiplier: 2 as const });
const common = { regulationMark: "H", setCode: "TST" };

export const sparkbit: CardDef = {
  ...common, id: "sparkbit", name: "Sparkbit", supertype: "Pokemon", subtypes: ["Basic"], hp: 70, types: ["L"], number: "1",
  attacks: [{ name: "Zap", cost: ["L"], damage: 20 }, { name: "Spark Rush", cost: ["L", "C"], damage: 30 }],
  weakness: fx("F"), retreatCost: 1,
};
export const voltorch: CardDef = {
  ...common, id: "voltorch", name: "Voltorch", supertype: "Pokemon", subtypes: ["Stage1"], hp: 110, types: ["L"], evolvesFrom: "Sparkbit", number: "2",
  abilities: [{ name: "Static Draw", trigger: { t: "ability", name: "Static Draw", limit: "oncePerTurn" }, limit: "oncePerTurn", effect: { e: "draw", player: "self", n: 1 } }],
  attacks: [{ name: "Thunder Jolt", cost: ["L", "C", "C"], damage: 70 }],
  weakness: fx("F"), retreatCost: 2,
};
export const boltkingEx: CardDef = {
  ...common, id: "boltking-ex", name: "Boltking ex", supertype: "Pokemon", subtypes: ["Basic", "ex"], hp: 200, types: ["L"], prizeValue: 2, number: "3",
  attacks: [{
    name: "Volt Crash", cost: ["L", "L", "C"], damage: 80, damageSuffix: "+",
    effect: { e: "damageMod", amount: { k: "count", per: 20, of: { player: "opp", zone: "attached", from: DEF, supertype: "energy" } } },
  }],
  weakness: fx("F"), retreatCost: 2,
};
export const rockpup: CardDef = {
  ...common, id: "rockpup", name: "Rockpup", supertype: "Pokemon", subtypes: ["Basic"], hp: 90, types: ["F"], number: "4",
  attacks: [{ name: "Rock Toss", cost: ["F", "C"], damage: 30 }],
  weakness: fx("G"), resistance: { type: "L", amount: 30 }, retreatCost: 2,
};
export const pondling: CardDef = {
  ...common, id: "pondling", name: "Pondling", supertype: "Pokemon", subtypes: ["Basic"], hp: 70, types: ["W"], number: "5",
  attacks: [
    { name: "Bubble", cost: ["W"], damage: 10, effect: { e: "flip", heads: { e: "status", to: DEF, status: "paralyzed" } } },
    { name: "Splash", cost: ["W", "C", "C"], damage: 40 },
  ],
  weakness: fx("L"), retreatCost: 1,
};
export const tidepup: CardDef = {
  ...common, id: "tidepup", name: "Tidepup", supertype: "Pokemon", subtypes: ["Basic"], hp: 80, types: ["W"], number: "6",
  attacks: [
    { name: "Lullaby", cost: ["W"], damage: 10, effect: { e: "flip", heads: { e: "status", to: DEF, status: "asleep" } } },
    { name: "Wave Crash", cost: ["W", "C"], damage: 30 },
  ],
  weakness: fx("L"), retreatCost: 1,
};
export const aquakingEx: CardDef = {
  ...common, id: "aquaking-ex", name: "Aquaking ex", supertype: "Pokemon", subtypes: ["Basic", "ex"], hp: 220, types: ["W"], prizeValue: 2, number: "7",
  attacks: [{
    name: "Hydro Burst", cost: ["W", "W", "C"], damage: 100,
    effect: { e: "discard", sel: { player: "self", zone: "attached", from: SELF, filter: { supertype: "energy" }, count: 1 } },
  }],
  weakness: fx("L"), retreatCost: 3,
};

const energy = (id: string, name: string, t: EnergyType, n: string): CardDef =>
  ({ ...common, id, name, supertype: "Energy", subtypes: ["Basic Energy"], types: [t], number: n });
export const lightningEnergy = energy("energy-l", "Lightning Energy", "L", "100");
export const waterEnergy = energy("energy-w", "Water Energy", "W", "101");
export const fightingEnergy = energy("energy-f", "Fighting Energy", "F", "102");

const trainer = (id: string, name: string, sub: "Item" | "Supporter" | "Stadium" | "Tool", rules: Entry[], n: string): CardDef =>
  ({ ...common, id, name, supertype: "Trainer", subtypes: [sub], rules, number: n });

export const quickDraw = trainer("quick-draw", "Quick Draw", "Item", [play("item", { e: "draw", player: "self", n: 2 })], "110");
export const ballThrow = trainer("ball-throw", "Ball Throw", "Item", [play("item", {
  e: "search", player: "self", to: "hand", shuffle: true,
  sel: { player: "self", zone: "deck", filter: { supertype: "pokemon", subtype: ["basic"] }, count: 1, reveal: true },
})], "111");
export const switcheroo = trainer("switcheroo", "Switcheroo", "Item", [play("item", {
  e: "switch", player: "self", whichBench: { s: "pick", player: "self", where: "bench", count: 1, chooser: "self" },
})], "112");
export const potion = trainer("potion", "Potion", "Item", [play("item", {
  e: "heal", amount: 30, to: { s: "pick", player: "self", where: "play", filter: { damaged: true }, count: 1 },
})], "113");
export const profNotes = trainer("prof-notes", "Professor's Notes", "Supporter", [play("supporter", { e: "draw", player: "self", n: 0, untilHand: 6 })], "120");
export const bossOrders = trainer("boss-orders", "Boss's Orders", "Supporter", [play("supporter", {
  e: "switch", player: "opp", chooser: "self", whichBench: { s: "pick", player: "opp", where: "bench", count: 1, chooser: "self" },
})], "121");
export const dynamoGirl = trainer("dynamo-girl", "Dynamo Girl", "Supporter", [play("supporter", {
  e: "attachEnergy", sel: { player: "self", zone: "discard", filter: { subtype: ["basic-energy"] }, count: { k: "upTo", n: 2 } },
  to: { s: "pick", player: "self", where: "play", count: 1 },
})], "122");
export const trainingCourt = trainer("training-court", "Training Court", "Stadium", [
  play("stadium", { e: "noop" }),
  { trigger: { t: "static" }, effect: { e: "modify", stat: "retreat", who: SELF, value: -1, duration: "whileInPlay" } },
], "130");
export const openField = trainer("open-field", "Open Field", "Stadium", [play("stadium", { e: "noop" })], "131");
export const muscleBand = trainer("muscle-band", "Muscle Band", "Tool", [
  { trigger: { t: "static" }, effect: { e: "modify", stat: "damageDealt", who: { s: "attached-to" }, value: 10, duration: "whileInPlay" } },
], "140");
export const hpBand = trainer("hp-band", "HP Band", "Tool", [
  { trigger: { t: "static" }, effect: { e: "modify", stat: "hp", who: { s: "attached-to" }, value: 30, duration: "whileInPlay" } },
], "141");

export const ALL_TEST_CARDS: CardDef[] = [
  sparkbit, voltorch, boltkingEx, rockpup, pondling, tidepup, aquakingEx, lightningEnergy, waterEnergy, fightingEnergy,
  quickDraw, ballThrow, switcheroo, potion, profNotes, bossOrders, dynamoGirl, trainingCourt, openField, muscleBand, hpBand,
];

const x = (d: CardDef, n: number): CardDef[] => Array.from({ length: n }, () => d);
/** Lightning / Fighting deck (60). */
export const deckA: CardDef[] = [
  ...x(sparkbit, 4), ...x(voltorch, 3), ...x(boltkingEx, 2), ...x(rockpup, 3),
  ...x(quickDraw, 4), ...x(ballThrow, 4), ...x(profNotes, 3), ...x(bossOrders, 2), ...x(trainingCourt, 2),
  ...x(muscleBand, 2), ...x(switcheroo, 2), ...x(potion, 2), ...x(dynamoGirl, 2),
  ...x(lightningEnergy, 17), ...x(fightingEnergy, 8),
];
/** Water deck (60). */
export const deckB: CardDef[] = [
  ...x(pondling, 4), ...x(tidepup, 4), ...x(aquakingEx, 3), ...x(pondling, 0),
  ...x(quickDraw, 4), ...x(ballThrow, 4), ...x(profNotes, 3), ...x(bossOrders, 2), ...x(openField, 2),
  ...x(hpBand, 2), ...x(switcheroo, 2), ...x(potion, 2), ...x(dynamoGirl, 2),
  ...x(waterEnergy, 26),
];
