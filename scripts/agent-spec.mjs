// Parses --agent specs: "greedy" | "random" | "search:fast" | "search:strong" | "search:default"; "x,y" gives deck A / deck B (or player 0 / 1) different agents.
import { greedyAgent, randomAgent, searchAgent, SEARCH_PRESETS } from "../dist/index.js";

export function parseAgent(spec) {
  if (spec === "greedy") return greedyAgent;
  if (spec === "random") return randomAgent;
  const m = /^search(?::(\w+))?$/.exec(spec);
  if (m) {
    const preset = SEARCH_PRESETS[m[1] ?? "fast"];
    if (!preset) throw new Error(`unknown search preset "${m[1]}" (fast | strong | default)`);
    return searchAgent(preset);
  }
  throw new Error(`unknown agent "${spec}" (greedy | random | search:fast | search:strong)`);
}
/** "x" -> [x, x]; "x,y" -> [x, y] */
export function parseAgentPair(spec) {
  const [a, b = a] = spec.split(",");
  return [parseAgent(a), parseAgent(b)];
}
