# Changelog

## 0.2.2

- Published maintenance release with synchronized package/runtime type versions.
- Updated README CDN and Bundlephobia links to point at `0.2.2`.

## 0.2.0

- Added opt-in configured execution variants through `configure(...)`:
  - `abort` extension (`AbortError`, signal-aware `fromAsync(..., { signal })`)
  - `pool` extension (bounded in-flight concurrency with queue limits)
  - `coalesce` extension (keyed in-flight promise deduping with optional TTL)
- Extended `Pipe.config` with resolved `abort`, `pool`, and `coalesce` snapshots.
- Extended `fromAsync` to accept optional per-call options (`signal`, `key`).
- Added new benchmark harness with warmup/sampled summaries and dedicated suites for core, pipeline, abort, concurrency, and coalescing.
- Added `npm run bench` script.
- Updated TypeScript declarations and tests for v0.2 behavior.
- Added [`samples/`](./samples/) runnable use-case scripts and index.
- Added TypeDoc-based API generation (`npm run docs:build`, `npm run docs:watch`) and `npm run check:types` for `pipe.d.ts`.
- Added root **MIT** [`LICENSE`](./LICENSE), [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`CONTRIBUTION.md`](./CONTRIBUTION.md), and [`AUTHORING.md`](./AUTHORING.md).

### Compatibility notes

- Default import behavior remains backward compatible when new config groups are not enabled.
- Existing APIs and method names are preserved.
- New behavior is opt-in via `configure(...)`.
