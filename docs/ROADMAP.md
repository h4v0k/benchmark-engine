# Roadmap

**Vision:** an evaluation oracle for Pokémon TCG Standard. Ask "does this change improve
this deck against the field?" and get an answer you can trust — with the *why*, backed by
simulated games and real tournament data — and have that answer track the meta as it moves.
Not a bot to beat humans; a research instrument for players and for Benchmark.

The one design rule everything hangs on: **the pilot must extract near-full value from any
card it is handed, including cards it has never seen.** A pilot that can't use a card will
report that the card is bad, and the finding will be wrong in a way nobody notices. So the
pilot is **search-first** (it evaluates cards by playing them out), with a learned *value*
function later only to make search sharper. Learned *policies* don't generalize to new cards.

## Status

- [x] **M1 — Engine core.** Zero-dependency TypeScript rules engine, effect DSL (~45
      primitives covering ~99% of the Standard pool's attack/ability texts), resumable choice
      model, seeded RNG, `legalActions()`, `observe()`.
- [x] **M2 — Real cards.** Dragapult ex and N's Zoroark ex (top-4 lists, Regional Recife
      2026-10-03) play complete games. Per-card tests, engine invariants (prizes, draws,
      card conservation, damage), greedy baseline agent. 105 tests.
- [ ] **M3 — The proof.** Search pilot, structured event stream, A/B framework, first real
      finding on a real list, speed pass.
- [ ] **M4 — Coverage.** The ~83-card competitive core, then every Standard ACE SPEC and
      common tech cards. Limitless as the field definition. Matchup matrix v1 calibrated
      against real Limitless matchup data.
- [ ] **M5 — Analytics.** Damage-math matrix; per-card metrics from logs (17Lands-style, per
      matchup); slot experiments; result caching by list hash; weekly re-run as the meta
      moves; deck optimizer; known-answers test suite.
- [ ] **M6 — Benchmark.** Engine as a package; Workers endpoints for instant queries; batch
      jobs on free compute writing to Supabase; grounded Q&A layer (deck doctor, matchup
      coach, tech picks) gated by the known-answers suite.

Later: learned value function from self-play; streamer-narration ingestion; pool-wide combo
discovery; best-of-3 and clock modeling.

## M3 — The proof

1. **Structured event stream** *(done, M3a: `src/events.ts`)*. Every draw / play / attach / evolve / ability / attack /
   KO / prize / switch as typed data. All analytics and mechanism stats read this.
2. **Speed pass** *(done, M3a: ~30 → ~100 games/s, golden-50 guard)*. Known hotspots: static-effect sources rescanning the board on every
   query; clone-on-write + GC. Target ≥3× (28 → 100+ games/s on 2 cores), then more.
3. **Search pilot.** Determinized MCTS over `legalActions()`: sample what the opponent could
   hold (consistent with `observe()`), search, pick the best line. Greedy as the rollout
   policy. Bar: beats greedy ≥85%, games end by prizes, deterministic for a seed.
4. **A/B framework** *(done, M3c: `src/experiments/ab.ts`, `docs/EXPERIMENTS.md`)*. Variant vs meta-weighted field; confidence ranges; two-stage
   screen-then-confirm (testing many swaps means some look good by chance); mechanism stats
   from the event stream; verdict = better / worse / too close + games needed.
5. **First finding.** One slot test on the real Dragapult list, checked against what a
   player expects. Right answer for the right reasons = oracle validated.

## Why Pokémon first (and Magic later)

Same architecture as mtg-lab (Forge + search + learned pilot), but every hard part is turned
down: no stack or instant-speed interaction, no layer system, a ~1,400-effect Standard pool
(vs ~30,000 Forge cards), sequential turns that search handles well, and an engine we own
and can make fast. Compute fits free tiers (GitHub Actions for batches, Kaggle for heavy
runs, Workers for serving, users' browsers later). Prove the whole pipeline here, then port
the methodology.

## Free compute plan

- **GitHub Actions** (public repo): CI, enumeration, test batches.
- **Kaggle notebooks**: heavy self-play / training (12h background CPU, 30h/wk GPU).
- **Cloudflare Workers**: serving inside Benchmark (single games are milliseconds).
- Every job is a **resumable batch writing to durable storage** (results branch / Supabase),
  so free-tier session limits never lose work.

## Honesty mechanisms

- Engine invariants asserted over thousands of games (prizes, draws, 60-card conservation,
  damage math).
- Per-card tests use the printed card text as the spec.
- Matchup matrix calibrated against real Limitless results.
- Known-answers suite: settled questions strong players agree on; every change must pass.
- Findings always carry: confidence range, games run, field used, date, and mechanism.
