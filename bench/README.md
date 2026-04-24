# Benchmarking Layout

This folder now has two benchmark tracks:

- `bench/ci.index.mjs` -> deterministic regression suite for CI gates.
- `bench/showcase.index.mjs` -> headline comparisons against manual Promise baselines.

Both tracks use canonical profiles from `bench/lib/profiles.mjs`.

## Legacy suites (kept for reference)

These files are the original benchmark scenarios and remain available:

- `bench/core.bench.mjs`
- `bench/pipeline.bench.mjs`
- `bench/abort.bench.mjs`
- `bench/concurrency.bench.mjs`
- `bench/coalesce.bench.mjs`

## CI benchmark components

- `bench/ci/core-ci.bench.mjs` -> core channels + timeout + callback + traverse/race.
- `bench/ci/execution-ci.bench.mjs` -> retry variants, pool pressure/overflow, coalesce modes.
- `bench/ci.compare.mjs` -> baseline comparison with threshold gating.
- `bench/baselines/ci-thresholds.json` -> default threshold + per-benchmark overrides with rationale.

## Output conventions

- Current CI run output: `bench/out/ci-current.json`
- Current showcase run output: `bench/out/showcase-current.json`
- PR CI baseline source: downloaded artifact `ci-baseline-report` from latest successful `main` benchmark run.
- Local fallback baseline: `bench/baselines/ci-baseline.json`
