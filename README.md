<div align="center">
  <img src="https://raw.githubusercontent.com/Prakhar-Srivastava/promised-pipes/master/promised-pipes.svg" alt="promised-pipes" width="100" />
  <br/><br/>
  <h1>promised-pipes</h1>
  <p><strong>Unix pipes. For async JavaScript.</strong></p>
  <p>
    <code>fetch | retry | timeout | recover</code>
    <br/>
    Reliability primitives, composed as readable pipelines.
  </p>
  <br/>

[![npm](https://img.shields.io/npm/v/promised-pipes?color=6ee7b7&labelColor=0b0c0f&label=npm)](https://www.npmjs.com/package/promised-pipes)
[![downloads](https://img.shields.io/npm/dw/promised-pipes?color=38bdf8&labelColor=0b0c0f&label=downloads%2Fweek)](https://www.npmjs.com/package/promised-pipes)
[![size](https://img.shields.io/bundlephobia/minzip/promised-pipes?color=f472b6&labelColor=0b0c0f&label=3.2kb)](https://bundlephobia.com/package/promised-pipes@0.2.2)
[![jsdelivr](https://img.shields.io/jsdelivr/npm/hw/promised-pipes?color=a78bfa&labelColor=0b0c0f&label=jsdelivr)](https://www.jsdelivr.com/package/npm/promised-pipes)
[![license](https://img.shields.io/npm/l/promised-pipes?color=fbbf24&labelColor=0b0c0f)](./LICENSE)

  <p>
    <a href="https://www.npmjs.com/package/promised-pipes">npm</a> ·
    <a href="https://classic.yarnpkg.com/en/package/promised-pipes">Yarn</a> ·
    <a href="https://www.jsdelivr.com/package/npm/promised-pipes">jsDelivr</a> ·
    <a href="https://bundlephobia.com/package/promised-pipes@0.2.2">Bundlephobia</a> ·
    <a href="https://github.com/Prakhar-Srivastava/promised-pipes">GitHub</a>
  </p>
</div>

---

## In 30 seconds

`promised-pipes` gives you:

- **Promise-native pipelines** you can `await` directly.
- **Clear success/error channels** without branching noise.
- **Built-in execution control**: retry, timeout, abort, pool, and coalescing.
- **Tiny production footprint**: 3.2KB minzipped, zero dependencies.

Install:

```sh
npm install promised-pipes
```

Use:

```js
import Pipe from 'promised-pipes';

const orders = await Pipe.fromAsync(fetchOrders)
  .retryWhen(e => e.status === 503, { attempts: 3, delay: 150 })
  .timeout(5_000)
  .orElse(() => []);
```

Then keep reading for API, execution policies, benchmarks, and runtime-specific examples.

---

## The problem it solves

You have written this shape of code before. Every backend and edge service eventually does.

```js
let data;
try {
  data = await fetchOrders();
} catch (e) {
  if (e.status === 503) {
    let retries = 0;
    while (retries < 3) {
      try {
        await sleep(150 * Math.pow(2, retries));
        data = await fetchOrders();
        break;
      } catch (retryErr) {
        retries++;
        if (retries === 3) {
          logger.error('pipeline', retryErr);  // 🐛 if logger throws, retryErr is gone
          try {
            data = await cache.get('orders:latest');
          } catch {
            data = [];  // 🐛 silently swallowed
          }
        }
      }
    }
  }
}
```

25 lines. No timeout. Logger failure can overwrite the original error. Retry semantics are easy to get subtly wrong. Fallbacks can swallow failures. This is exactly how pager fatigue starts.

This is the same thing:

```js
import Pipe from 'promised-pipes';

const data = await Pipe.fromAsync(fetchOrders)
  .retryWhen(e => e.status === 503, { attempts: 3, delay: 150 })
  .timeout(5_000)
  .tapError(e => logger.error('pipeline', e))   // isolated — logger crash cannot replace real error
  .orRecover(async () => cache.get('orders:latest'))
  .orElse(() => []);
```

Each concern is explicit. Each failure mode is isolated. The timeout is real. The code is readable under pressure.

---

## Why the model works

In Unix, `ls | grep foo | sort | head -10` works because:
- data flows left to right through each stage
- each stage does exactly one thing
- if any stage fails, the pipeline stops

`promised-pipes` brings that model to async JavaScript:

```
                    ┌─ success channel ───────────────────────────────────────┐
Pipe.fromAsync(fn)  │  .map()  .chain()  .mapTo()  .tap()                    │  await
                    └─ error channel ─────────────────────────────────────────┘
                       .tapError()  .orFail()  .orRecover()  .orElse()
```

Methods on the wrong channel **are skipped by design**. `.map` never runs on a rejected pipe, `.tapError` never runs on a resolved one. No guard clauses. No `if (err) return`. No channel confusion.

Every Pipe is still a **native Promise** under the hood: `await` it, pass it to `Promise.all`, chain `.then/.catch/.finally`. No wrappers to unwrap. No lock-in.

---

## Install and load

```sh
npm install promised-pipes
yarn add promised-pipes
```

```js
// ESM — CDN, no install
import Pipe from 'https://cdn.jsdelivr.net/npm/promised-pipes@0.2.2/+esm'

// Vanilla JS — CDN script tag (exposes global Pipe object)
// <script src="https://cdn.jsdelivr.net/npm/promised-pipes@0.2.2/dist/pipe.global.js"></script>
```

**3.2KB minzipped. Zero dependencies. Native Promise interoperability.**

If you assemble this capability piecemeal, size and complexity climb quickly:

| | size | does |
|---|---|---|
| `p-retry` | 1.8KB | retry only |
| `p-timeout` | 0.6KB | timeout only |
| `p-queue` | 4.1KB | concurrency only |
| **`promised-pipes`** | **3.2KB** | **all of the above + pipeline + abort + coalescing** |

---

## Why teams choose promised-pipes

- **Readable control flow**: one linear pipeline instead of nested `try/catch` and ad-hoc guards.
- **Safer failure semantics**: clear success/error channels and isolated side-effects.
- **Built-in resilience**: retry, timeout, abort, coalescing, and pooling in one mental model.
- **Production-friendly footprint**: tiny bundle, zero dependencies, native Promise interoperability.

---

## Core API

The API is intentionally small: values in, transforms, error channel, resilience primitives, and controlled concurrency.

### Getting values in

```js
import Pipe from 'promised-pipes';

Pipe.of(42)                                          // lift any value
Pipe.of(Promise.resolve('hello'))                    // lifts + unwraps — no double-wrap
Pipe.from(fetch('/api').then(r => r.json()))         // existing Promise
Pipe.fromAsync(() => fetchUser(id))                  // async factory — use this for .retryWhen
Pipe.fromCallback(fs.readFile, 'config.json', 'utf8') // Node-style callbacks
Pipe.reject(new Error('pre-failed'))                 // start in the error channel
```

### Transforming

```js
await Pipe.of(10)
  .map(n => n * 2)           // sync or async, both work
  .chain(n => Pipe.of(n + 1)) // sequence another Pipe — never nests
  .mapTo('done')             // replace the value entirely
  .tap(v => console.log(v))  // side-effect, value passes through
```

### Handling failures

```js
// Recover — re-enter the success channel
.orElse(() => defaultValue)
.orRecover(async () => cache.get('key'))    // same thing, signals async intent

// Reshape — stay rejected, change the error
.orFail(e => Object.assign(new Error(`api: ${e.message}`), { code: 503 }))

// Observe — side-effect, stay rejected
// IMPORTANT: if your logger throws here, the original error still propagates.
// Side-effects never get to rewrite upstream truth.
.tapError(e => logger.error('something broke', e))
```

### Resilience

```js
import { TimeoutError } from 'promised-pipes';

// Retry — factory must be the upstream so each attempt re-runs the work
await Pipe.fromAsync(() => fetch('/api').then(r => r.json()))
  .retryWhen(
    (err, attempt) => err.status === 503 && attempt <= 3,
    { attempts: 4, delay: 300, jitter: true }  // exponential backoff + ±25% jitter
  )

// Timeout
await Pipe.fromAsync(slowQuery)
  .timeout(5_000)
  .orElse(e => e instanceof TimeoutError ? staleData : Promise.reject(e))

// Inline timeout fallback — intercepts TimeoutError only, not other errors
await Pipe.fromAsync(fetchUser).timeout(2_000, () => guestUser)
```

### Concurrent work

```js
// All succeed or fail-fast
const [user, orders] = await Pipe.all([fetchUser(id), fetchOrders(id)])

// All settle, nothing lost
const results = await Pipe.allSettled([Pipe.of(1), Pipe.reject(new Error('x'))])

// Map async over array — concurrent, fail-fast
const users = await Pipe.traverse([1, 2, 3], id =>
  Pipe.fromAsync(() => fetchUser(id))
    .orFail(e => new Error(`user ${id}: ${e.message}`))
).orElse(() => [])

// Merge sources — failed items become Error values in-place, nothing lost
const [primary, backup] = await Pipe.fromAsync(fetchPrimary)
  .merge([Pipe.fromAsync(fetchBackup)])
```

---

## v0.2 — Execution policies

Three opt-in execution policies, fully backward compatible.

```js
import { configure } from 'promised-pipes';

const Pipe = configure({
  maxTimeout  : 10_000,    // .timeout(ms) upper bound
  maxAttempts : 5,         // .retryWhen attempts upper bound
  maxDelay    : 2_000,     // .retryWhen backoff upper bound

  abort    : { enabled: true },
  pool     : { enabled: true, limit: 8, maxQueue: 100 },
  coalesce : { enabled: true, ttl: 500 },
})
```

### AbortSignal

```js
import { configure, AbortError } from 'promised-pipes';

const Pipe = configure({ abort: { enabled: true } })
const ctrl = new AbortController()

await Pipe.fromAsync(
  signal => fetch('/api/data', { signal }).then(r => r.json()),
  { signal: ctrl.signal }
).orElse(e => e instanceof AbortError ? null : Promise.reject(e))

ctrl.abort('user-navigated-away')
```

### Concurrency pool

```js
const Pipe = configure({ pool: { enabled: true, limit: 4 } })

// Launches as many as you want — at most 4 run at any time
await Promise.all(
  urls.map(url => Pipe.fromAsync(() => fetch(url).then(r => r.text())))
)
```

### Request coalescing

```js
const Pipe = configure({ coalesce: { enabled: true, ttl: 500 } })

// Three callers, one fetch
const [a, b, c] = await Promise.all([
  Pipe.fromAsync(() => fetchUser(1), { key: 'user:1' }),
  Pipe.fromAsync(() => fetchUser(1), { key: 'user:1' }),
  Pipe.fromAsync(() => fetchUser(1), { key: 'user:1' }),
])
// fetchUser ran exactly once
```

---

## Cloudflare Workers

`promised-pipes` runs on Workers without adaptation: zero Node builtins, neutral ESM target, and footprint-friendly for isolates.

```js
import Pipe from 'promised-pipes'

export default {
  fetch(request, env) {
    return Pipe.fromAsync(() => env.KV.get('config'))
      .map(JSON.parse)
      .chain(cfg => Pipe.fromAsync(() =>
        fetch(cfg.upstream + new URL(request.url).pathname)
      ))
      .retryWhen(e => e.status === 503, { attempts: 3, delay: 50 })
      .timeout(5_000)
      .map(r => r.json())
      .map(data => Response.json(data))
      .tapError(e => console.error('worker failed', e))
      .orElse(() => new Response('unavailable', { status: 503 }))
  }
}
```

Pass `request.signal` to cancel automatically when the client disconnects:

```js
const Pipe = configure({ abort: { enabled: true } })

export default {
  fetch(request, env) {
    return Pipe.fromAsync(
      signal => fetch(upstreamUrl, { signal }).then(r => r.json()),
      { signal: request.signal }
    )
    .map(data => Response.json(data))
    .orElse(() => new Response('unavailable', { status: 503 }))
  }
}
```

---

## TypeScript

Full declarations ship in-package. No `@types` install, no degraded inference.

```ts
import Pipe, {
  configure,
  TimeoutError,
  AbortError,
  PipeError,
  type Pipe as PipeType,
  type PipeAPI,
  type ConfigureOptions,
} from 'promised-pipes'

// Inference all the way through
const result: string = await Pipe.of(42)
  .map(n => n * 2)        // Pipe<number>
  .map(n => `val:${n}`)   // Pipe<string>

// lift preserves argument types
const double = Pipe.lift((n: number) => n * 2)
const r: PipeType<number> = double(5)
```

---

## A few things that might surprise you

**Your logger cannot eat your real error.** `.tapError(fn)` isolates side-effects. If `fn` throws, that exception is discarded and the original error keeps propagating. This is deliberate: observability should not mutate control flow.

**It is already a Promise.** No `.toPromise()`. No adapters. `await pipe`, `Promise.all([pipe])`, and `.then(handler)` work exactly as expected.

**`pipe.p` is `undefined`.** The internal Promise lives behind an unexported Symbol, not a string key. `Object.keys(pipe)` is empty. No accidental leakage.

**Bad arguments fail fast.** Pass a non-function to `.map()` and the throw points at your callsite immediately, not later inside a nested async chain.

**`.retryWhen` needs a factory upstream.** `Pipe.fromAsync(factory).retryWhen(...)` re-runs work each attempt. `.map(fn).retryWhen(...)` only replays an already settled value. This is intentional.

---

## What's in the box

| | |
|---|---|
| **Size** | [3.2KB minified + gzip](https://bundlephobia.com/package/promised-pipes@0.2.2) |
| **Dependencies** | Zero |
| **Node** | ≥ 18 |
| **Runtimes** | Node · Browser · Cloudflare Workers · Deno · Bun |
| **TypeScript** | Declarations included, no install needed |
| **Formats** | ESM · IIFE (CDN) · neutral/edge |
| **Tests** | 173, all passing, zero external test dependencies |

---

## Benchmarks

Benchmarks are product-quality, not vanity metrics: one track protects regressions, one track demonstrates behavior on realistic scenarios.

- **CI track (`ci-v1`)** keeps regression checks deterministic and gateable.
- **Showcase track (`showcase-v1`)** compares equivalent Promise vs Pipe scenarios.

### Run benchmark commands

```sh
# CI benchmark run (deterministic)
npm run bench:ci

# Local compare (informational, non-gating)
npm run bench:compare

# CI compare (strict, gating)
npm run bench:compare:ci

# Headline Promise vs Pipe scenarios
npm run bench:showcase

# Run both tracks
npm run bench
```

### Output files

- `bench/out/ci-current.json` - CI track raw report
- `bench/out/showcase-current.json` - showcase track raw report
- `bench/out/ci-compare-summary.md` - human-readable compare summary
- `bench/out/ci-compare-diff.json` - machine-readable compare diff

### Baseline and thresholds

- Default regression threshold: **20% slower** by `medianMsPerOp`.
- Threshold config lives in `bench/baselines/ci-thresholds.json`.
- Local fallback baseline: `bench/baselines/ci-baseline.json`.
- CI baseline source: latest successful `main` benchmark artifact (`ci-baseline-report`).

### Current benchmark coverage

The deterministic CI suite currently covers 18 benchmark IDs and fails on metadata mismatch, missing IDs, unexpected new IDs (unless allowed), or threshold regressions.

Benchmark methodology and interpretation guidance live in [docs/benchmarking.md](./docs/benchmarking.md).

---

## Contributing

```sh
git clone https://github.com/Prakhar-Srivastava/promised-pipes
npm install
npm test          # 173 tests, node:test built-in, no Jest
npm run bench:ci  # deterministic regression benchmark suite
npm run bench:showcase   # Promise/manual comparison scenarios
npm run bench:compare    # local informational compare vs fallback baseline
npm run samples   # runnable use-case scripts
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

## Competition

| Feature                          | promised-pipes  | promised-pipe | p-pipe        | pipe-promised | promise-pipe | promisepipe     | promise.pipe  |
|:-------------------------------- |:--------------- |:------------- |:------------- |:------------- |:------------ |:--------------- |:------------- |
| Promise pipeline                 | ✅ Core          | ✅ Compose     | ✅ Compose     | ✅ Compose     | ✅ Chain      | ⚠️ Streams      | ✅ Compose     |
| Sync + async composition         | ✅ Yes           | ✅ Yes         | ✅ Yes         | ✅ Yes         | ✅ Yes        | ❌ Stream-only   | ✅ Yes         |
| Thenable / awaitable Pipe object | ✅ Yes           | ❌ Function    | ❌ Function    | ❌ Function    | ❌ Function   | ❌ Stream helper | ❌ Function    |
| Structured error channel         | ✅ orElse/orFail | ❌ Catch       | ❌ Catch       | ❌ Catch       | ❌ Catch      | ❌ Stream err    | ❌ Catch       |
| Retry primitive                  | ✅ retryWhen     | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| Timeout primitive                | ✅ Built-in      | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| Abort / cancellation             | ✅ AbortSignal   | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| In-flight coalescing             | ✅ Keyed         | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| TTL coalescing/cache window      | ✅ TTL           | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| Concurrency pool                 | ✅ Pool          | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| Backpressure                     | ✅ Yes           | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| all/race/allSettled helpers      | ✅ Yes           | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| Callback bridge                  | ✅ fromCallback  | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| Browser build                    | ✅ ESM/IIFE      | ⚠️ ES5-era    | ✅ Tiny        | ⚠️ CJS-era    | ⚠️ Old       | ⚠️ Node streams | ⚠️ Old        |
| WASM/neutral target              | ✅ Neutral ESM   | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| Benchmarks                       | ✅ Dedicated     | ❌ No          | ❌ No          | ❌ No          | ❌ No         | ❌ No            | ❌ No          |
| Samples                          | ✅ Runnable      | ⚠️ Examples   | ✅ Basic       | ⚠️ Basic      | ⚠️ Basic     | ⚠️ Basic        | ⚠️ Basic      |
| Type declarations                | ✅ .d.ts         | ❌Unknown     | ✅ Included    | ❌Old         | ❌Old        | ❌Old           | ❌Old         |
| Modern execution-control focus   | ✅ Yes           | ❌ Composition | ❌ Composition | ❌ Composition | ❌ Chains     | ❌ Streams       | ❌ Composition |


---

<div align="center">
  <p>If promised-pipes helped you ship safer async code,<br/>consider leaving a ⭐ so more teams can find it.</p>
  <br/>
  <a href="https://github.com/Prakhar-Srivastava/promised-pipes">github.com/Prakhar-Srivastava/promised-pipes</a>
  <br/><br/>
  MIT © <a href="https://github.com/Prakhar-Srivastava">Prakhar Srivastava</a>
</div>
