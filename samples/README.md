# Samples

Runnable examples for **promised-pipes** v0.2. Run from the repository root (after `npm install` if you add dev-only tooling; samples only need Node 18+ and the local `pipe.mjs`).

```sh
node samples/01-basics.mjs
npm run samples   # all samples in sequence
```

| Sample | Command | What it shows |
|--------|---------|----------------|
| Basics | `node samples/01-basics.mjs` | `Pipe.of`, `.map`, `.chain`, `await` |
| Error channel | `node samples/02-error-channel.mjs` | `.tapError`, `.orFail`, `.orElse` |
| Retry + factory | `node samples/03-retry-factory.mjs` | `fromAsync` upstream + `.retryWhen` |
| Configure limits | `node samples/04-configure-limits.mjs` | `configure({ maxTimeout, … })` |
| v0.2 abort | `node samples/05-abort-signal.mjs` | `abort: { enabled }`, `fromAsync(fn, { signal })` |
| v0.2 pool | `node samples/06-concurrency-pool.mjs` | `pool: { enabled, limit }` |
| v0.2 coalesce | `node samples/07-coalesce-by-key.mjs` | `coalesce: { enabled }`, `{ key }`, TTL |

Expected output: each script prints one or a few lines to `stdout` ending with `ok` or a resolved value.

See also [../README.md](../README.md), [../CONTRIBUTING.md](../CONTRIBUTING.md), and generated API docs (`npm run docs:build`).
