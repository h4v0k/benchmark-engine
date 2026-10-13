import type { CardDef } from "../model.js";
import { SHARED_DEFS } from "./shared.js";
import { DRAGAPULT_DEFS } from "./dragapult.js";
import { ZOROARK_DEFS } from "./zoroark.js";

export const CARD_DEFS: Record<string, CardDef> = Object.fromEntries([...SHARED_DEFS, ...DRAGAPULT_DEFS, ...ZOROARK_DEFS].map((d) => [d.id, d]));

const BASIC_ENERGY: Record<string, string> = { Fire: "basic-r", Psychic: "basic-p", Darkness: "basic-d", Grass: "basic-g", Water: "basic-w", Lightning: "basic-l", Fighting: "basic-f", Metal: "basic-m" };

/** Parse a Limitless-style list ("4 Dreepy TWM 128", `#` comments, section headers ignored) into a CardDef[] using CARD_DEFS. */
export function deckFromList(text: string, defs: Record<string, CardDef> = CARD_DEFS): CardDef[] {
  const byName = new Map(Object.values(defs).map((d) => [d.name, d]));
  const deck: CardDef[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+?)(?:\s+([A-Z0-9]{2,4})\s+(\d+))?$/);
    if (!m) continue;
    const [, count, name, , number] = m;
    const setIdByCode = number ? Object.values(defs).find((d) => d.name === name && d.number === number) : undefined;
    const be = name.match(/^(?:Basic )?(\w+) Energy$/);
    const def = setIdByCode ?? byName.get(name) ?? (be ? defs[BASIC_ENERGY[be[1]]] : undefined);
    if (!def) throw new Error(`deckFromList: no card def for "${name}"${number ? ` (${number})` : ""}`);
    for (let i = 0; i < Number(count); i++) deck.push(def);
  }
  return deck;
}

// Deck texts are inlined (rather than read from data/decks) so the module stays browser/Worker-safe; keep in sync with data/decks/*.txt.
const DRAGAPULT_LIST = `
4 Dreepy TWM 128
4 Drakloak TWM 129
3 Dragapult ex TWM 130
2 Munkidori TWM 95
2 Budew ASC 16
1 Dunsparce TEF 128
1 Dudunsparce TEF 129
1 Moltres PFL 14
1 Fezandipiti ex ASC 142
1 Meowth ex POR 62
4 Lillie's Determination MEG 119
3 Boss's Orders MEG 114
2 Crispin SCR 133
1 Rosa's Encouragement POR 84
1 Judge POR 76
4 Crushing Hammer POR 71
4 Buddy-Buddy Poffin TEF 144
4 Poké Pad POR 81
3 Night Stretcher ASC 196
3 Ultra Ball MEG 131
1 Unfair Stamp TWM 165
2 Risky Ruins MEG 127
3 Fire Energy MEE 10
3 Psychic Energy MEE 13
2 Darkness Energy MEE 15`;
const NS_ZOROARK_LIST = `
4 N's Zorua JTG 97
4 N's Zoroark ex JTG 98
2 N's Zekrom ASC 155
2 Munkidori TWM 95
1 N's Reshiram JTG 116
1 Meowth ex POR 62
1 Pecharunt ex SFA 39
1 Yveltal MEG 88
1 Budew ASC 16
4 Lillie's Determination MEG 119
4 Boss's Orders MEG 114
2 Black Belt's Training JTG 143
1 Cyrano SSP 170
1 Judge POR 76
4 Buddy-Buddy Poffin TEF 144
4 N's PP Up JTG 153
4 Ultra Ball MEG 131
2 Night Stretcher ASC 196
2 Poké Pad POR 81
1 Unfair Stamp TWM 165
1 Special Red Card CRI 82
2 Punk Helmet PFL 92
2 N's Castle JTG 152
2 Team Rocket's Watchtower DRI 180
7 Darkness Energy MEE 15`;

export const DRAGAPULT_EX_DECK: CardDef[] = deckFromList(DRAGAPULT_LIST);
export const NS_ZOROARK_EX_DECK: CardDef[] = deckFromList(NS_ZOROARK_LIST);
