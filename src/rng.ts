// Seeded deterministic PRNG (mulberry32). The state is one uint32 so it serializes with GameState.
export interface Rng { s: number }
export const makeRng = (seed: number): Rng => ({ s: seed >>> 0 });
/** float in [0,1) */
export function next(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** integer in [0,n) */
export const int = (rng: Rng, n: number): number => Math.floor(next(rng) * n);
/** coin: true = heads */
export const flip = (rng: Rng): boolean => next(rng) < 0.5;
/** in-place Fisher-Yates; returns the same array */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = int(rng, i + 1);
    const t = arr[i]!; arr[i] = arr[j]!; arr[j] = t;
  }
  return arr;
}
