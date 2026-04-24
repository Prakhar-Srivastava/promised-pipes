# Benchmarking promised-pipes

This project maintains two benchmark tracks:

- **CI track (`ci-v1`)**: deterministic regression detection with strict metadata checks.
- **Showcase track (`showcase-v1`)**: semantically equivalent scenario comparisons against manual Promise implementations.

## Quick commands

```sh
# Deterministic CI run
npm run bench:ci

# Local compare (informational; allows metadata mismatch)
npm run bench:compare

# CI compare (strict; uses main-branch baseline artifact)
npm run bench:compare:ci

# Showcase benchmark output
npm run bench:showcase
```

`npm run bench` runs both tracks back-to-back.

## CI track details

CI suite entrypoint: `bench/ci.index.mjs`

- Output file: `bench/out/ci-current.json`
- Report fields include:
  - environment metadata (`node`, `platform`, `arch`, timestamp)
  - benchmark profile metadata (`profile.id`, `profile.intent`)
  - deterministic suite hash (`suiteHash`, includes ids + operation metadata)
  - per benchmark stats (`medianMs`, `p95Ms`, `medianMsPerOp`, `opsPerSec`)

Baseline compare entrypoint: `bench/ci.compare.mjs`

- PR CI baseline source: latest successful **main-branch benchmark artifact** (`ci-baseline-report`).
- Local fallback baseline: `bench/baselines/ci-baseline.json`.
- Threshold source: `bench/baselines/ci-thresholds.json`.
- Default regression threshold: `20%` slower by `medianMsPerOp`.

Compare fails when any of these conditions are true:

- metadata mismatch (`node`, `platform`, `arch`, profile id/intent),
- missing benchmark ids in current run,
- new benchmark ids (unless explicitly allowed),
- threshold regression on existing ids.

Compare outputs:

- markdown summary (`bench/out/ci-compare-summary.md`)
- structured diff JSON (`bench/out/ci-compare-diff.json`)

## Refreshing baseline

Local baseline refresh (maintainers, informational only):

```sh
npm run bench:baseline
```

This writes `bench/baselines/ci-baseline.json`.

CI gating still relies on the latest successful main-branch artifact.

## Showcase track details

Showcase entrypoint: `bench/showcase.index.mjs`

Current scenarios:

1. Transform chain (`Promise.then` vs `Pipe.map`)
2. Retry only
3. Timeout only
4. Retry + timeout combined
5. Fan-out aggregation (`Promise.all` vs `Pipe.all`)
6. Abort-aware flow with equivalent signal-listener semantics
7. Coalescing (`ttl=0`, `ttl>0`, `shareErrors=false`)
8. Pool limiter behavior

Output file: `bench/out/showcase-current.json`

## Reading results responsibly

- Prioritize **relative deltas** and **median/per-op** metrics over single absolute times.
- Ignore tiny differences (<3-5%) unless repeated across runs on stable hardware.
- Treat `timerSensitive` scenarios as directional, not absolute truth.
- Use `cpuBound` scenarios for tighter throughput discussions.
- Keep semantics equivalent between compared implementations; correctness first.
