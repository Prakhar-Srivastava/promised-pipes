# promised-pipes

> Elegant async pipelines that flow, transform, and recover without the noise.

A monadic Promise proxy for vanilla JavaScript. Wraps async values in a chainable, fully thenable interface — `await`-able, `Promise.all`-compatible, and Symbol-transparent — without abandoning the native Promise ecosystem.

Every entry point validates its arguments synchronously. Bad inputs throw before entering the Promise chain, giving you stack traces that point at your code, not at anonymous `.then()` handlers inside the library.

```js
import Pipe from 'promised-pipes';

const orders = await Pipe.fromAsync(fetchOrders)
  .retryWhen(e => e.status === 503, { attempts: 3, delay: 150 })
  .timeout(5_000)
  .tap(d => metrics.count(d.length))
  .tapError(e => logger.error('pipeline', e))
  .orFail(e => new AppError('orders.fetch', e))
  .orRecover(async () => cache.get('orders:latest'))
  .orElse(() => []);
```

---

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [API reference](#api-reference)
  - [Static constructors](#static-constructors)
  - [Core monad](#core-monad)
  - [Error channel](#error-channel)
  - [Resilience](#resilience)
  - [Collection](#collection)
- [Configuration](#configuration)
- [TypeScript](#typescript)
- [Security model](#security-model)
- [Known limitations](#known-limitations)
- [Running the tests](#running-the-tests)

---

## Installation

```sh
npm install promised-pipes
```

Requires Node.js ≥ 18. No runtime dependencies.

---

## Quick start

```js
// Zero-config — default operational limits
import Pipe from 'promised-pipes';

// Custom limits
import { configure } from 'promised-pipes';
const Pipe = configure({ maxTimeout: 60_000, maxAttempts: 5, maxDelay: 5_000 });
```

Every `Pipe` instance is a native `Promise` proxy. You can `await` it, pass it to `Promise.all`, and chain `.then` / `.catch` / `.finally` directly — no adapter, no `.toPromise()` escape hatch needed.

```js
// await works
const value = await Pipe.of(42).map(n => n * 2); // 84

// Promise.all works
const [a, b] = await Promise.all([Pipe.of(1), Pipe.of(2)]);

// .then / .catch work natively
Pipe.of(99)
  .map(n => n + 1)
  .then(console.log)
  .catch(console.error);
```

---

## Core concepts

### The two channels

Every `Pipe` is in one of two channels at any moment: **success** or **error**. Methods that operate on the success channel are skipped while the pipe is in the error channel, and vice versa. This lets you describe a complete data flow — including all failure cases — as a single linear chain.

```
Pipe.of(value)          ← enter success channel
  .map(transform)       ← success only, skipped on error
  .chain(asyncStep)     ← success only
  .tapError(log)        ← error only, value passes through
  .orFail(reshape)      ← error only, stays rejected
  .orRecover(fallback)  ← error → success via async computation
  .orElse(() => [])     ← error → success, last resort
```

### Full Promise proxy

A `Pipe` proxies its underlying `Promise` transparently. Any property not defined as a Pipe method is forwarded to the Promise — including `Symbol.toStringTag`, `Symbol.species`, and `.constructor`. This means:

```js
Object.prototype.toString.call(Pipe.of(1)); // '[object Promise]'
Pipe.of(1) instanceof Promise;              // true (via proxy)
```

### Synchronous guards

Every method validates its arguments before touching the Promise chain. A non-function callback, an invalid timeout, a non-array iterable — all throw a `PipeError` synchronously with a stack trace pointing at your call site, not inside the library.

---

## API reference

### Static constructors

#### `Pipe.of(value)`

Lift any value into a Pipe. Non-Promise values are wrapped via `Promise.resolve()`.

```js
await Pipe.of(42);                    // 42
await Pipe.of(Promise.resolve('hi')); // 'hi' — no double-wrap
await Pipe.of(null);                  // null
```

#### `Pipe.reject(reason)`

Create a pre-rejected Pipe. Useful for tests or lifting existing errors.

```js
await Pipe.reject(new Error('oops')).orElse(() => 'recovered'); // 'recovered'
```

#### `Pipe.from(promise)`

Lift an existing Promise or thenable into Pipe-land.

- **Native Promise** — zero overhead, no extra microtask tick.
- **Foreign thenable** — safely wrapped via `Promise.resolve()` so it cannot hijack internal callbacks.
- **Non-thenable** — throws `PipeError` synchronously.

```js
const pipe = Pipe.from(fetch('/api/data').then(r => r.json()));
```

#### `Pipe.fromAsync(factory)`

Construct a Pipe from a zero-argument async factory. The factory is called immediately.

> **Important for `.retryWhen`:** Use `Pipe.fromAsync(factory).retryWhen(...)` rather than `.map(fn).retryWhen(...)`. Retries re-run the current Promise value — the factory must be the upstream for retries to re-execute the operation.

```js
Pipe.fromAsync(() => fetch('/api/orders').then(r => r.json()))
  .retryWhen(e => e.status === 503, { attempts: 3 });
```

#### `Pipe.fromCallback(fn, ...args)`

Bridge a Node.js-style `(err, result)` callback API. A one-shot guard prevents double-invoke from buggy callbacks.

```js
import { readFile } from 'node:fs';

await Pipe.fromCallback(readFile, 'config.json', 'utf8')
  .map(JSON.parse)
  .orElse(() => defaultConfig);
```

#### `Pipe.lift(fn)`

Lift a plain function into a Pipe-returning form. Useful for composing synchronous transforms via `.chain`.

```js
const double = Pipe.lift(n => n * 2);
const inc    = Pipe.lift(n => n + 1);

await double(10).chain(inc); // 21
```

#### `Pipe.all(pipes)`

Resolve all Pipes/Promises concurrently. Rejects on the first failure (fail-fast). Throws `PipeError` synchronously if the argument is not an Array.

```js
const [user, orders] = await Pipe.all([fetchUser(1), fetchOrders(1)]);
```

#### `Pipe.race(pipes)`

Settle with the first Pipe/Promise to resolve or reject.

```js
const result = await Pipe.race([
  Pipe.fromAsync(() => fetchFromRegionA()),
  Pipe.fromAsync(() => fetchFromRegionB()),
]);
```

#### `Pipe.allSettled(pipes)`

Settle all Pipes/Promises, collecting every outcome regardless of success or failure. Returns the native `PromiseSettledResult[]` shape.

```js
const results = await Pipe.allSettled([Pipe.of(1), Pipe.reject(new Error('x'))]);
// [{ status: 'fulfilled', value: 1 }, { status: 'rejected', reason: Error }]
```

#### `Pipe.traverse(arr, fn)`

Map `fn` over `arr` where `fn` returns a Pipe per element, then collect all results concurrently. Semantics: all succeed → `Pipe<result[]>`, first failure → `Pipe<never>`.

This is the monadic generalisation of `Promise.all(arr.map(fn))` — both arguments are validated before any work begins.

```js
const users = await Pipe.traverse([1, 2, 3], id =>
  Pipe.fromAsync(() => fetchUser(id))
    .orFail(e => new Error(`user ${id}: ${e.message}`))
).orElse(() => []);
```

---

### Core monad

#### `.map(fn)`

Transform the resolved value. `fn` may be sync or async.

```js
await Pipe.of(10).map(n => n * 2);           // 20
await Pipe.of(5).map(async n => n * n);       // 25
await Pipe.of([1,2,3]).map(arr => arr.length); // 3
```

#### `.chain(fn)`

Sequence an async step. `fn` should return a `Pipe` or `Promise` — `.then` flattens it automatically, preventing `Pipe<Pipe<B>>` nesting.

```js
const fetchUser   = id   => Pipe.fromAsync(() => fetch(`/users/${id}`).then(r => r.json()));
const fetchOrders = user => Pipe.fromAsync(() => fetch(`/orders/${user.id}`).then(r => r.json()));

await fetchUser(1).chain(fetchOrders); // Pipe<Order[]>, never Pipe<Pipe<Order[]>>
```

#### `.mapTo(value)`

Replace the current value with a constant. Equivalent to `.map(() => value)` — communicates intent when you care about sequencing but not the upstream result.

```js
await Pipe.of(userId)
  .chain(db.deleteUser)     // returns { affected: 1 }
  .mapTo({ success: true }); // discard db result, return clean shape
```

#### `.tap(fn)`

Run a side-effect on the resolved value without transforming it. The value passes through unchanged.

> If `fn` throws, the Pipe rejects. For side-effects on the error channel, use `.tapError`.

```js
await Pipe.of(orders)
  .tap(o => metrics.count(o.length)) // side-effect
  .map(summarise);                   // value is still `orders`
```

---

### Error channel

#### `.orElse(fn)`

Recover from any rejection with a fallback value or async computation. Re-enters the success channel — subsequent `.map` / `.chain` calls will see the fallback.

```js
await Pipe.fromAsync(fetchUser).orElse(() => guestUser);
await Pipe.reject(new Error('x')).orElse(async () => cache.get('user'));
```

#### `.orFail(fn)`

Reshape or enrich a rejection while staying in the error channel. The Pipe remains rejected — only the error changes. Use this to add context, normalise error types, or attach error codes before surfacing to a caller.

```js
Pipe.fromAsync(fetchOrders)
  .orFail(e => Object.assign(
    new Error(`orders: ${e.message}`),
    { code: 'ORDERS_ERR', upstream: e }
  ))
  .orElse(() => []);
```

#### `.orRecover(fn)`

Recover from a rejection via an async computation — hit a cache, call a fallback API, or compute a replacement asynchronously. Semantically identical to `.orElse` but signals async intent at the call site.

```js
Pipe.fromAsync(fetchUser)
  .orRecover(async () => cache.get('user:latest'));
```

#### `.tapError(fn)`

Run a side-effect on the rejection reason without consuming it. The Pipe stays rejected with the original error propagating unchanged.

**Isolation guarantee:** if `fn` itself throws, that exception is silently discarded and the *original* error is re-rejected. A crashing logger will never silently replace an upstream failure.

```js
Pipe.fromAsync(fetchData)
  .tapError(e => logger.error('fetch failed', { error: e })) // logs, stays rejected
  .orElse(() => []);                                          // then recovers
```

---

### Resilience

#### `.timeout(ms, fallback?)`

Race the pipeline against a hard deadline.

- Without `fallback`: rejects with a named `TimeoutError` on deadline.
- With `fallback`: intercepts only `TimeoutError` and re-enters the success channel. Non-timeout errors propagate normally.

`ms` must be a positive integer in `(0, maxTimeout]`. Passing `NaN`, `Infinity`, `0`, or a negative value throws `PipeError` synchronously.

```js
// Reject on timeout, recover with orElse
await Pipe.fromAsync(heavyReport)
  .timeout(3_000)
  .orElse(() => cachedReport);

// Inline fallback — intercepts TimeoutError only
await Pipe.fromAsync(fetchUser)
  .timeout(2_000, () => guestUser);
```

```js
import { TimeoutError } from 'promised-pipes';

await Pipe.fromAsync(fetchData)
  .timeout(5_000)
  .orElse(e => e instanceof TimeoutError ? staleData : Promise.reject(e));
```

#### `.retryWhen(predicate, opts?)`

Retry on transient failure with exponential backoff and optional jitter.

**`predicate(error, attemptNumber) → boolean`** controls which errors are retried. Return `true` to retry, `false` to propagate immediately. The attempt number is 1-based.

**Backoff:** each wait doubles (`lastDelay * 2`), capped at `maxDelay`.
**Jitter:** ±25% randomisation is on by default, preventing thundering-herd when many clients retry simultaneously.

| Option | Default | Description |
|---|---|---|
| `attempts` | `3` | Max retry count. Clamped to `[1, maxAttempts]`. |
| `delay` | `200` | Initial delay in ms. Clamped to `[0, maxDelay]`. |
| `jitter` | `true` | Add ±25% randomisation to each wait. |

> **Note:** retries re-run the current Promise value, not the upstream factory. Use `Pipe.fromAsync(factory).retryWhen(...)` to re-execute a network call on each attempt.

```js
const isTransient = (e, attempt) => e.status === 503 && attempt <= 3;

await Pipe.fromAsync(fetchOrders)
  .retryWhen(isTransient, { attempts: 4, delay: 300 })
  .orElse(() => []);
```

---

### Collection

#### `.merge(others)`

Merge this Pipe with additional Pipes, Promises, or plain values, resolving all concurrently via `Promise.allSettled` semantics.

Failures become `Error` values in the result array — nothing is lost. Result order is `[this, ...others]`.

```js
const [primary, backup, stale] = await Pipe.fromAsync(fetchPrimary)
  .merge([
    Pipe.fromAsync(fetchBackup),
    Pipe.fromAsync(fetchStale),
  ]);

// Inspect each — failures are Error instances
const data = primary instanceof Error ? backup : primary;
```

#### `.sort(comparator?)`

Sort an array value carried by the Pipe. Always copies — never mutates the upstream array. If the pipe value is not an Array, rejects with a `PipeError` (catchable via `.orElse`).

`comparator` is optional — omitting it uses JavaScript's default lexicographic sort. If provided, must be a function.

```js
// Descending numeric
await Pipe.of([3, 1, 4, 1, 5]).sort((a, b) => b - a); // [5, 4, 3, 1, 1]

// Natural lexicographic
await Pipe.of(['zebra', 'apple', 'mango']).sort(); // ['apple', 'mango', 'zebra']

// Composed with map
await Pipe.fromAsync(fetchScores)
  .map(scores => scores.filter(s => s.active))
  .sort((a, b) => b.score - a.score)
  .map(sorted => sorted.slice(0, 10)); // top 10
```

---

## Configuration

Default operational limits ship as exported constants so you can read them without hardcoding magic numbers:

```js
import {
  DEFAULT_MAX_TIMEOUT,   // 300_000 ms (5 minutes)
  DEFAULT_MAX_ATTEMPTS,  // 20
  DEFAULT_MAX_DELAY,     // 30_000 ms (30 seconds)
} from 'promised-pipes';
```

Use `configure()` to produce an independent Pipe instance with different limits. All options are optional — omitted values fall back to the defaults above.

```js
import { configure } from 'promised-pipes';

const Pipe = configure({
  maxTimeout  : 60_000,  // .timeout(ms) must be ≤ 60 s
  maxAttempts : 5,       // .retryWhen attempts clamped to [1, 5]
  maxDelay    : 5_000,   // .retryWhen backoff capped at 5 s
});

console.log(Pipe.config);
// { maxTimeout: 60000, maxAttempts: 5, maxDelay: 5000 }
```

Bad limit values throw `PipeError` synchronously at `configure()` time — not silently at the first `.timeout()` or `.retryWhen()` call.

```js
configure({ maxTimeout: 0 });   // PipeError: maxTimeout must be a positive integer
configure({ maxDelay: -1 });    // PipeError: maxDelay must be a non-negative integer
configure({ maxDelay: 0 });     // ✓ valid — 0 means no pause between retries
```

Each `configure()` call produces a fully independent instance — its own internal class, its own private bind cache, its own frozen API object. Two configured instances in the same process share no state.

---

## TypeScript

`pipe.d.ts` ships with the package and is wired up automatically via the `"types"` field in `package.json`.

```ts
import Pipe, {
  configure,
  TimeoutError,
  PipeError,
  DEFAULT_MAX_TIMEOUT,
  type Pipe as PipeType,
  type PipeAPI,
  type ConfigureOptions,
  type RetryOptions,
} from 'promised-pipes';

// Full inference
const p: PipeType<number> = Pipe.of(42).map(n => n * 2);

// lift preserves argument types
const double = Pipe.lift((n: number) => n * 2);
const result: PipeType<number> = double(5);

// traverse infers item and result types
const users = await Pipe.traverse([1, 2, 3], (id: number) =>
  Pipe.fromAsync(() => fetchUser(id))
);
// users: User[]

// Error types for instanceof checks
try {
  await Pipe.fromAsync(fetch).timeout(1_000);
} catch (e) {
  if (e instanceof TimeoutError) console.log(e.ms); // number
  if (e instanceof PipeError)    console.log(e.name); // 'PipeError'
}
```

---

## Security model

The library applies defence in depth across three layers:

**Spec-private class fields**
`#__bind_cache_` and `#__make_pipe$` are private static fields on the internal `Proto` class. They are inaccessible outside the class body by language specification — `Object.getOwnPropertyNames`, `Object.getOwnPropertySymbols`, and `Reflect.ownKeys` all return nothing for `#`-prefixed fields.

**Unexported Symbol**
Each Pipe instance stores its underlying Promise under a module-scoped, unexported `Symbol('Pipe.internal')` key rather than a plain string property. This means:
- `pipe.p` is `undefined` — the string key is gone.
- `Object.keys(pipe)` is empty.
- `JSON.stringify(pipe)` serialises nothing.
- No code outside the module can access the raw Promise without deliberate use of `Reflect.ownKeys`.

**Synchronous input validation**
Every public entry point validates its arguments before touching any Promise. Error messages name the method/parameter but never interpolate user-supplied values — preventing data from leaking into structured logs or error reporting systems.

```js
// Safe — message says "map: expected a function", not "map: got [your data]"
Pipe.of(sensitiveData).map(notAFunction);
```

**Foreign thenable isolation**
`Pipe.from()` accepts foreign thenables but wraps them via `Promise.resolve()`. A hostile thenable whose `.then` calls `resolve` multiple times or with injected values cannot influence the Pipe's resolution.

**One-shot callback guard**
`Pipe.fromCallback()` generates a one-shot callback. Buggy or adversarial Node-style callbacks that invoke their continuation more than once are silently ignored after the first call.

**`tapError` isolation**
If the function passed to `.tapError` throws, that secondary exception is discarded and the original error is re-rejected. A crashing logger cannot silently replace an upstream failure.

---

## Known limitations

These are deliberate scope decisions for v0.1.0, not oversights:

**`.retryWhen` re-runs the current Promise, not a factory.** If you need retries to re-execute a network call, the factory must be the upstream: `Pipe.fromAsync(factory).retryWhen(...)`. Chaining `.retryWhen` after `.map` or `.chain` will retry the already-settled value, not re-invoke the original operation.

**No cancellation / AbortController integration.** Promises are not cancellable. Cancellation requires AbortController coordination at the call site — the library deliberately does not bolt this on.

**No `Pipe.memoize`.** Cache invalidation and async deduplication interact in subtle ways (stale entries, concurrent request coalescing). This is out of scope for the core library.

**TypeScript types ship as JSDoc-inferred declarations, not `tsc`-generated.** If you encounter a type gap, please open an issue.

---

## Running the tests

The test suite uses Node.js's built-in `node:test` runner — no install required beyond Node ≥ 18.

```sh
# Run once
npm test

# Watch mode
npm run test:watch
```

```
# tests    161
# suites    30
# pass     161
# fail        0
```

**Coverage by suite:**

| Suite | Tests |
|---|---|
| Module exports & constants | 10 |
| `configure()` validation | 12 |
| Monad laws | 3 |
| `.map` | 6 |
| `.chain` | 4 |
| `.mapTo` | 3 |
| `.tap` | 4 |
| `.orElse` | 5 |
| `.orFail` | 4 |
| `.orRecover` | 3 |
| `.tapError` | 5 |
| `.timeout` | 11 |
| `.retryWhen` | 6 |
| `.merge` | 6 |
| `.sort` | 6 |
| `Pipe.traverse` | 6 |
| `Pipe.of` | 4 |
| `Pipe.reject` | 2 |
| `Pipe.from` | 6 |
| `Pipe.fromAsync` | 3 |
| `Pipe.lift` | 4 |
| `Pipe.all` | 4 |
| `Pipe.race` | 3 |
| `Pipe.allSettled` | 2 |
| `Pipe.fromCallback` | 5 |
| Promise proxy | 9 |
| Security invariants | 6 |
| `configure()` isolation | 2 |
| Fibonacci state machine | 10 |
| Full pipeline integration | 7 |

---

## License

MIT — see `LICENSE`.