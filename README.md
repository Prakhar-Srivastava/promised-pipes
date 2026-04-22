<div align="center">

<h1>promised-pipes</h1>

<p><strong>Unix pipes. For async JavaScript.</strong></p>

<p>Chain promises like <code>ls | grep | sort | head</code> — data flows through, each stage transforms it,<br/>errors are handled inline, the whole thing is composable and <code>await</code>-able.</p>

<br/>

[![npm](https://img.shields.io/npm/v/promised-pipes?color=6ee7b7&labelColor=0b0c0f&label=npm)](https://www.npmjs.com/package/promised-pipes)
[![npm downloads](https://img.shields.io/npm/dw/promised-pipes?color=38bdf8&labelColor=0b0c0f&label=downloads%2Fweek)](https://www.npmjs.com/package/promised-pipes)
[![bundle size](https://img.shields.io/bundlephobia/minzip/promised-pipes?color=f472b6&labelColor=0b0c0f&label=minzipped)](https://bundlephobia.com/package/promised-pipes@0.2.1)
[![license](https://img.shields.io/npm/l/promised-pipes?color=fbbf24&labelColor=0b0c0f)](./LICENSE)
[![jsdelivr](https://img.shields.io/jsdelivr/npm/hw/promised-pipes?color=a78bfa&labelColor=0b0c0f&label=jsdelivr)](https://www.jsdelivr.com/package/npm/promised-pipes)

**[npm](https://www.npmjs.com/package/promised-pipes)** · **[Yarn](https://classic.yarnpkg.com/en/package/promised-pipes)** · **[jsDelivr](https://www.jsdelivr.com/package/npm/promised-pipes)** · **[Bundlephobia](https://bundlephobia.com/package/promised-pipes@0.2.1)** · **[GitHub](https://github.com/Prakhar-Srivastava/promised-pipes)**

</div>


```js
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

## Why

You've written this before:

```js
// The usual chaos
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
          logger.error('pipeline', retryErr);
          try {
            data = await cache.get('orders:latest');
          } catch {
            data = [];
          }
        }
      }
    }
  }
}
```

That is 25 lines of nested try/catch for one fetch with retry and fallback. It has no timeout. The logger can crash silently and replace your real error. The retry doesn't backoff. The cache fallback swallows its own errors.

promised-pipes collapses it to a readable pipeline where every concern has a named home:

```js
const data = await Pipe.fromAsync(fetchOrders)
  .retryWhen(e => e.status === 503, { attempts: 3, delay: 150 })
  .timeout(5_000)
  .tapError(e => logger.error('pipeline', e))  // isolated — logger crash never replaces real error
  .orRecover(async () => cache.get('orders:latest'))
  .orElse(() => []);
```

---

## At a glance

| | |
|---|---|
| **Size** | [3.2KB minified + gzip](https://bundlephobia.com/package/promised-pipes@0.2.1) |
| **Dependencies** | Zero |
| **Node** | ≥ 18 |
| **Runtimes** | Node · Browser · Cloudflare Workers · Deno · Bun |
| **TypeScript** | Full declarations included |
| **Formats** | ESM · IIFE · neutral/edge |

**Compare to doing it yourself with individual packages:**

| Package | Size | Does |
|---|---|---|
| `p-retry` | 1.8KB | retry only |
| `p-timeout` | 0.6KB | timeout only |
| `p-queue` | 4.1KB | concurrency only |
| **`promised-pipes`** | **3.2KB** | **retry + timeout + abort + pool + coalescing + full pipeline** |

---

## Install

```sh
# npm
npm install promised-pipes

# yarn
yarn add promised-pipes

# CDN — ESM
import Pipe from 'https://cdn.jsdelivr.net/npm/promised-pipes@0.2.1/+esm'

# CDN — Vanilla JS (exposes global Pipe object)
<script src="https://cdn.jsdelivr.net/npm/promised-pipes@0.2.1/dist/pipe.global.min.js"></script>
```

---

## The mental model

Think of it like Unix pipes — data flows left to right, each operator handles one concern, errors have their own channel:

```
                    ┌─ success channel ──────────────────────────────────┐
Pipe.fromAsync(fn)  │  .map()  .chain()  .mapTo()  .tap()               │  await
                    └─ error channel ────────────────────────────────────┘
                       .tapError()  .orFail()  .orRecover()  .orElse()
```

Methods on the wrong channel are **silently skipped** — `.map` never runs on a rejected pipe, `.tapError` never runs on a resolved one. No guard clauses, no early returns.

Every Pipe is a **native Promise proxy** — fully `await`-able, compatible with `Promise.all`, `Promise.race`, `.then`, `.catch`, `.finally`. No escape hatch, no `.toPromise()`.

---

## Core API

### Lift a value

```js
import Pipe from 'promised-pipes';

await Pipe.of(42);                                      // 42
await Pipe.of(Promise.resolve('hello'));                // 'hello' — no double-wrap
await Pipe.from(fetch('/api').then(r => r.json()));     // from existing Promise
await Pipe.fromAsync(() => fetchUser(id));              // from async factory
```

### Transform

```js
await Pipe.of(10)
  .map(n => n * 2)           // sync transform → 20
  .map(async n => n + 1)     // async transform — both work → 21
  .mapTo('done')             // replace value entirely
  .tap(v => console.log(v))  // side-effect, value passes through unchanged
```

### Handle errors

```js
// Three distinct things you can do with a failure:

// 1. Recover — re-enter the success channel
Pipe.reject(new Error('x')).orElse(() => defaultValue);
Pipe.reject(new Error('x')).orRecover(async () => cache.get('key'));

// 2. Reshape — stay rejected, change the error
Pipe.reject(new Error('raw'))
  .orFail(e => Object.assign(new Error(`shaped: ${e.message}`), { code: 503 }));

// 3. Observe — side-effect, stay rejected
Pipe.reject(new Error('x'))
  .tapError(e => logger.error(e))  // if logger throws, original error still propagates
  .orElse(() => fallback);
```

### Retry

```js
// Factory MUST be the upstream — retries re-execute the factory
await Pipe.fromAsync(() => fetch('/api/orders').then(r => r.json()))
  .retryWhen(
    (error, attempt) => error.status === 503 && attempt <= 3,
    { attempts: 4, delay: 300, jitter: true }  // exponential backoff + ±25% jitter
  );
```

### Timeout

```js
import { TimeoutError } from 'promised-pipes';

await Pipe.fromAsync(heavyQuery)
  .timeout(5_000)
  .orElse(e => e instanceof TimeoutError ? cachedResult : Promise.reject(e));

// Inline fallback — intercepts TimeoutError only, not other errors
await Pipe.fromAsync(fetchUser).timeout(2_000, () => guestUser);
```

### Concurrent work

```js
// All must succeed — fail-fast
const [user, orders] = await Pipe.all([fetchUser(id), fetchOrders(id)]);

// Collect all outcomes — nothing lost
const results = await Pipe.allSettled([Pipe.of(1), Pipe.reject(new Error('x'))]);

// Map async over array — concurrent, fail-fast
const users = await Pipe.traverse([1, 2, 3], id =>
  Pipe.fromAsync(() => fetchUser(id))
    .orFail(e => new Error(`user ${id}: ${e.message}`))
).orElse(() => []);

// Merge sources — failures become Error values in-place, nothing lost
const [primary, backup] = await Pipe.fromAsync(fetchPrimary)
  .merge([Pipe.fromAsync(fetchBackup)]);
```

---

## v0.2 — Execution policies

Configure execution behaviour per instance. All opt-in, all backward compatible.

```js
import { configure } from 'promised-pipes';

const Pipe = configure({
  maxTimeout  : 10_000,                                  // upper bound for .timeout(ms)
  maxAttempts : 5,                                       // upper bound for .retryWhen attempts
  maxDelay    : 2_000,                                   // upper bound for .retryWhen backoff
  abort       : { enabled: true },                       // AbortSignal support
  pool        : { enabled: true, limit: 8, maxQueue: 100 }, // bounded concurrency
  coalesce    : { enabled: true, ttl: 500 },             // in-flight deduplication
});
```

### Abort signals

```js
import { configure, AbortError } from 'promised-pipes';

const Pipe = configure({ abort: { enabled: true } });
const ctrl = new AbortController();

const result = await Pipe.fromAsync(
  signal => fetch('/api/data', { signal }).then(r => r.json()),
  { signal: ctrl.signal }
).orElse(e => e instanceof AbortError ? null : Promise.reject(e));

ctrl.abort('user-navigated-away');
```

### Concurrency pool

```js
const Pipe = configure({ pool: { enabled: true, limit: 4 } });

// At most 4 fromAsync tasks run simultaneously regardless of how many you launch
await Promise.all(
  urls.map(url => Pipe.fromAsync(() => fetch(url).then(r => r.text())))
);
```

### Request coalescing

```js
const Pipe = configure({ coalesce: { enabled: true, ttl: 500 } });

// Three concurrent calls with the same key share one in-flight Promise
const [a, b, c] = await Promise.all([
  Pipe.fromAsync(() => fetchUser(1), { key: 'user:1' }),
  Pipe.fromAsync(() => fetchUser(1), { key: 'user:1' }), // shares with above
  Pipe.fromAsync(() => fetchUser(1), { key: 'user:1' }), // shares with above
]);
// fetchUser called exactly once
```

---

## Cloudflare Workers

promised-pipes runs on Workers today without modification. The neutral ESM build targets ES2022 — current across all edge runtimes.

```js
import Pipe from 'promised-pipes';

export default {
  fetch(request, env) {
    return Pipe.fromAsync(() => env.KV.get('config'))
      .map(JSON.parse)
      .chain(cfg =>
        Pipe.fromAsync(() => fetch(cfg.upstream + new URL(request.url).pathname))
      )
      .retryWhen(e => e.status === 503, { attempts: 3, delay: 50 })
      .timeout(5_000)
      .map(r => r.json())
      .map(data => Response.json(data))
      .tapError(e => console.error('worker failed', e))
      .orElse(() => new Response('unavailable', { status: 503 }));
  }
};
```

Pass `request.signal` through for automatic cancellation on client disconnect:

```js
const Pipe = configure({ abort: { enabled: true } });

export default {
  fetch(request, env) {
    return Pipe.fromAsync(
      signal => fetch(upstreamUrl, { signal }).then(r => r.json()),
      { signal: request.signal }
    )
    .map(data => Response.json(data))
    .orElse(() => new Response('unavailable', { status: 503 }));
  }
};
```

---

## TypeScript

Full declarations ship with the package. No `@types/` install needed.

```ts
import Pipe, {
  configure,
  TimeoutError,
  AbortError,
  PipeError,
  type Pipe as PipeType,
  type PipeAPI,
  type ConfigureOptions,
} from 'promised-pipes';

// Full inference across the pipeline
const result: string = await Pipe.of(42)
  .map(n => n * 2)        // Pipe<number>
  .map(n => `val:${n}`);  // Pipe<string>

// lift preserves argument types
const double = Pipe.lift((n: number) => n * 2);
const r: PipeType<number> = double(5);

// Error types for instanceof checks
try {
  await Pipe.fromAsync(fetch).timeout(1_000);
} catch (e) {
  if (e instanceof TimeoutError) console.log(e.ms);    // number
  if (e instanceof PipeError)    console.log(e.name);  // 'PipeError'
  if (e instanceof AbortError)   console.log(e.reason);
}
```

---

## Security

Three encapsulation layers ensure no consumer can access or manipulate internal state:

**Spec-private fields** — `#__bind_cache_` and `#__make_pipe$` are hard-private class fields. `Object.getOwnPropertyNames`, `Reflect.ownKeys`, and every reflection API return nothing for them.

**Unexported Symbol** — the underlying Promise is stored under a module-scoped `Symbol('Pipe.internal')` that is never exported. `pipe.p` is `undefined`. `Object.keys(pipe)` is empty. `JSON.stringify(pipe)` serialises nothing.

**Guard message safety** — error messages name the parameter but never interpolate user-supplied values, preventing data from leaking into structured logs.

```js
// Safe — message is "map: expected a function", never "map: got [your data]"
Pipe.of(sensitivePayload).map(notAFunction);
```

**tapError isolation** — if your logger throws, that exception is discarded and the original error re-rejects. A crashing logger cannot silently replace an upstream failure.

**Hostile thenable isolation** — `Pipe.from()` wraps foreign thenables via `Promise.resolve()`. A `.then` callback that calls resolve multiple times cannot influence the Pipe's resolution.

---

## Known limitations

**`.retryWhen` re-runs the current Promise, not the upstream factory.** Use `Pipe.fromAsync(factory).retryWhen(...)` — the factory must be upstream for retries to re-execute the operation.

**Abort only cooperates with abort-aware code.** The library rejects early with `AbortError`, but underlying IO must honour the `AbortSignal` to actually stop.

**Coalescing is per-instance, key-based, and opt-in.** `fromAsync` deduplicates only when `{ key }` is provided and coalescing is enabled in `configure`.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Run `npm test` before opening a PR.

```sh
npm test             # node:test suite — 161 tests, zero external dependencies
npm run bench        # performance benchmarks
npm run samples      # runnable use-case scripts
npm run check:types  # tsc declaration check
```

---

## License

MIT © [Prakhar Srivastava](https://github.com/Prakhar-Srivastava)
