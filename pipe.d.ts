/**
 * @fileoverview pipe.d.ts — v0.2.0
 *
 * Type declarations for pipe.mjs.
 *
 * @example <caption>Zero-config import</caption>
 * import Pipe from './pipe.mjs';
 * const result = await Pipe.of(42).map(n => n * 2); // 84
 *
 * @example <caption>Custom limits</caption>
 * import { configure } from './pipe.mjs';
 * const Pipe = configure({ maxTimeout: 60_000, maxAttempts: 5, maxDelay: 5_000 });
 */

// ── Operational defaults ───────────────────────────────────────────────────────

/** Default upper bound for `.timeout(ms)` — 5 minutes in ms. */
export declare const DEFAULT_MAX_TIMEOUT: 300_000;

/** Default upper bound for `.retryWhen` attempt count. */
export declare const DEFAULT_MAX_ATTEMPTS: 20;

/** Default upper bound for `.retryWhen` inter-attempt delay in ms. */
export declare const DEFAULT_MAX_DELAY: 30_000;

/** Current library version. */
export declare const VERSION: '0.2.0';

// ── Sentinel error types ───────────────────────────────────────────────────────

/**
 * Thrown (as a rejection) when a `.timeout()` deadline is exceeded.
 *
 * @example
 * import Pipe, { TimeoutError } from './pipe.mjs';
 *
 * await Pipe.fromAsync(slowFetch)
 *   .timeout(2_000)
 *   .orElse(e => e instanceof TimeoutError ? fallback : Promise.reject(e));
 */
export declare class TimeoutError extends Error {
	/** The deadline that was exceeded, in ms. */
	readonly ms: number;
	/** Always `'TimeoutError'` — survives minification. */
	readonly name: 'TimeoutError';
	constructor(ms?: number);
}

/**
 * Thrown synchronously by any Pipe guard when an argument fails validation.
 * Extends `TypeError` because an invalid argument is always a type contract
 * violation — bad ms value, non-function callback, non-array iterable, etc.
 *
 * @example
 * import Pipe, { PipeError } from './pipe.mjs';
 *
 * try {
 *   Pipe.of(1).map('oops'); // throws synchronously
 * } catch (e) {
 *   if (e instanceof PipeError) console.error('bad argument:', e.message);
 * }
 */
export declare class PipeError extends TypeError {
	/** Always `'PipeError'` — survives minification. */
	readonly name: 'PipeError';
	constructor(msg: string);
}

/**
 * Rejection reason used when an abort-aware execution is cancelled.
 */
export declare class AbortError extends Error {
	readonly name: 'AbortError';
	readonly reason: unknown;
	constructor(reason?: unknown);
}

// ── configure() options ────────────────────────────────────────────────────────

/**
 * Options accepted by {@link configure}.
 * All fields are optional — omitted values fall back to the module defaults.
 */
export interface ConfigureOptions {
	/**
	 * Upper bound for `.timeout(ms)` in ms.
	 * Must be a positive integer. Default: `300_000` (5 minutes).
	 */
	maxTimeout?: number;

	/**
	 * Upper bound for `.retryWhen` attempt count.
	 * Must be a positive integer. Default: `20`.
	 */
	maxAttempts?: number;

	/**
	 * Upper bound for `.retryWhen` inter-attempt delay in ms.
	 * Must be a non-negative integer (`0` = no delay between retries).
	 * Default: `30_000` (30 seconds).
	 */
	maxDelay?: number;

	/** Optional abort behavior for fromAsync execution. */
	abort?: AbortConfig;

	/** Optional bounded-concurrency pool for fromAsync execution. */
	pool?: PoolConfig;

	/** Optional in-flight coalescing for keyed fromAsync calls. */
	coalesce?: CoalesceConfig;
}

export interface AbortConfig {
	enabled?: boolean;
}

export interface PoolConfig {
	enabled?: boolean;
	limit?: number;
	maxQueue?: number;
}

export interface CoalesceConfig {
	enabled?: boolean;
	ttl?: number;
	shareErrors?: boolean;
}

/** Resolved, frozen configuration snapshot returned on `Pipe.config`. */
export interface ResolvedConfig {
	readonly maxTimeout: number;
	readonly maxAttempts: number;
	readonly maxDelay: number;
	readonly abort: Readonly<Required<AbortConfig>>;
	readonly pool: Readonly<{ enabled: boolean; limit: number; maxQueue: number }>;
	readonly coalesce: Readonly<{ enabled: boolean; ttl: number; shareErrors: boolean }>;
}

export interface FromAsyncOptions {
	signal?: AbortSignal;
	key?: unknown;
}

// ── retryWhen options ──────────────────────────────────────────────────────────

/** Options accepted by {@link Pipe.retryWhen}. */
export interface RetryOptions {
	/**
	 * Maximum number of retry attempts.
	 * Clamped to `[1, maxAttempts]`. Default: `3`.
	 */
	attempts?: number;

	/**
	 * Initial delay between retries in ms.
	 * Clamped to `[0, maxDelay]`. Default: `200`.
	 */
	delay?: number;

	/**
	 * Whether to apply ±25% jitter to each wait to prevent thundering-herd.
	 * Default: `true`.
	 */
	jitter?: boolean;
}

// ── Pipe instance ──────────────────────────────────────────────────────────────

/**
 * A chainable, fully thenable async pipeline.
 *
 * `Pipe<A>` proxies an underlying `Promise<A>` — it is `await`-able,
 * compatible with `Promise.all`, `Promise.race`, and `Promise.allSettled`
 * without any adapter. All methods return a new `Pipe` and never mutate
 * the current one.
 *
 * @template A The type of the resolved value.
 */
export interface Pipe<A> extends PromiseLike<A> {

	// ── Core monad ──────────────────────────────────────────────────────────

	/**
	 * Transform the resolved value. `fn` may be sync or async.
	 * Equivalent to `Promise.then` but stays in Pipe-land.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * await Pipe.of(10).map(n => n * 2); // 20
	 */
	map<B>(fn: (value: A) => B | Promise<B>): Pipe<B>;

	/**
	 * Sequence an async step. `fn` should return a `Pipe` or `Promise` —
	 * `.then` flattens it automatically, preventing `Pipe<Pipe<B>>` nesting.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * const fetchUser   = (id: number) => Pipe.fromAsync(() => fetch(`/users/${id}`).then(r => r.json()));
	 * const fetchOrders = (user: User) => Pipe.fromAsync(() => fetch(`/orders/${user.id}`).then(r => r.json()));
	 *
	 * await fetchUser(1).chain(fetchOrders); // Pipe<Order[]>
	 */
	chain<B>(fn: (value: A) => Pipe<B> | Promise<B>): Pipe<B>;

	/**
	 * Replace the current value with a constant.
	 * Equivalent to `.map(() => v)` — communicates "I care about sequencing,
	 * not the value."
	 *
	 * @example
	 * await Pipe.of(userId)
	 *   .chain(db.deleteUser)     // returns { affected: 1 }
	 *   .mapTo({ success: true }); // discard db result
	 */
	mapTo<B>(value: B): Pipe<B>;

	/**
	 * Run a side-effect on the resolved value without transforming it.
	 * Value passes through unchanged. If `fn` throws, the Pipe rejects.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * await Pipe.of(orders)
	 *   .tap(o => metrics.count(o.length))
	 *   .map(summarise);
	 */
	tap(fn: (value: A) => void): Pipe<A>;

	// ── Error channel ────────────────────────────────────────────────────────

	/**
	 * Recover from any rejection by providing a fallback value or async
	 * computation. Re-enters the success channel.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * await Pipe.fromAsync(fetchUser).orElse(() => guestUser);
	 */
	orElse<B>(fn: (error: unknown) => B | Promise<B>): Pipe<A | B>;

	/**
	 * Reshape or enrich a rejection while staying in the error channel.
	 * The Pipe remains rejected — only the error object changes.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * Pipe.fromAsync(fetchOrders)
	 *   .orFail(e => Object.assign(new Error(`orders: ${e.message}`), { code: 'ORDERS_ERR' }))
	 *   .orElse(() => []);
	 */
	orFail(fn: (error: unknown) => unknown): Pipe<never>;

	/**
	 * Recover from a rejection via an async computation.
	 * Semantically identical to `.orElse` but signals async intent at the call site.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * Pipe.fromAsync(fetchUser)
	 *   .orRecover(async () => cache.get('user:latest'));
	 */
	orRecover<B>(fn: (error: unknown) => Promise<B>): Pipe<A | B>;

	/**
	 * Run a side-effect on the rejection reason without consuming it.
	 * The Pipe stays rejected with the original error.
	 *
	 * **Isolation guarantee:** if `fn` itself throws, that exception is
	 * silently discarded and the original error is re-rejected.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * Pipe.fromAsync(fetchData)
	 *   .tapError(e => logger.error('fetch failed', e))
	 *   .orElse(() => []);
	 */
	tapError(fn: (error: unknown) => void): Pipe<A>;

	// ── Resilience ───────────────────────────────────────────────────────────

	/**
	 * Race the pipeline against a hard deadline.
	 *
	 * Without `fallback`: rejects with {@link TimeoutError} on deadline.
	 * With `fallback`: intercepts only `TimeoutError` and re-enters success.
	 *
	 * @param ms - Deadline in ms. Must be a positive integer in `(0, maxTimeout]`.
	 * @param fallback - Optional inline recovery for timeout only.
	 *
	 * @throws {PipeError} Synchronously, if `ms` is invalid or `fallback` is
	 *   provided but is not a function.
	 *
	 * @example <caption>Reject on timeout</caption>
	 * await Pipe.fromAsync(heavyReport).timeout(3_000).orElse(() => cachedReport);
	 *
	 * @example <caption>Inline fallback</caption>
	 * await Pipe.fromAsync(fetchUser).timeout(2_000, () => guestUser);
	 */
	timeout(ms: number, fallback?: (error: TimeoutError) => A): Pipe<A>;

	/**
	 * Retry the upstream on transient failure with exponential backoff and
	 * optional jitter.
	 *
	 * The `predicate` receives `(error, attemptNumber)`. Return `true` to
	 * retry, `false` or throw to propagate immediately.
	 *
	 * **Note:** retries re-run the current Promise value. Use
	 * `Pipe.fromAsync(factory).retryWhen(...)` so the factory is re-executed
	 * on each attempt.
	 *
	 * @throws {PipeError} Synchronously, if `predicate` is not a function.
	 *
	 * @example
	 * await Pipe.fromAsync(fetchOrders)
	 *   .retryWhen(e => e.status === 503, { attempts: 4, delay: 300 })
	 *   .orElse(() => []);
	 */
	retryWhen(
		predicate: (error: unknown, attempt: number) => boolean,
		opts?: RetryOptions,
	): Pipe<A>;

	// ── Collection ───────────────────────────────────────────────────────────

	/**
	 * Merge this Pipe with additional Pipes, Promises, or plain values,
	 * resolving all concurrently via `Promise.allSettled`.
	 *
	 * Failures become error values in the result array — nothing is lost.
	 * Result order: `[this, ...others]`.
	 *
	 * @throws {PipeError} Synchronously, if `others` is not an Array.
	 *
	 * @example
	 * const [primary, backup] = await Pipe.fromAsync(fetchPrimary)
	 *   .merge([Pipe.fromAsync(fetchBackup)]);
	 */
	merge<B>(others: Array<Pipe<B> | Promise<B> | B>): Pipe<Array<A | B | unknown>>;

	/**
	 * Sort an array value carried by the Pipe.
	 * Always copies — never mutates the upstream array.
	 *
	 * @param comparator - Standard Array comparator. Omit for lexicographic sort.
	 *
	 * @throws {PipeError} Synchronously, if `comparator` is provided but is
	 *   not a function. Rejects if the pipe value is not an Array.
	 *
	 * @example
	 * await Pipe.of([3, 1, 4]).sort((a, b) => b - a); // [4, 3, 1]
	 */
	sort(comparator?: (a: A extends Array<infer T> ? T : never,
		b: A extends Array<infer T> ? T : never) => number): Pipe<A>;

	// ── Promise interop ──────────────────────────────────────────────────────
	// These are forwarded transparently by the Proxy to the underlying Promise,
	// making every Pipe instance fully thenable and await-able.

	/** Attaches fulfilment and rejection handlers. Forwarded to the underlying Promise. */
	then<TResult1 = A, TResult2 = never>(
		onfulfilled?: ((value: A) => TResult1 | PromiseLike<TResult1>) | null | undefined,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
	): Promise<TResult1 | TResult2>;

	/** Attaches a rejection handler. Forwarded to the underlying Promise. */
	catch<TResult = never>(
		onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null | undefined,
	): Promise<A | TResult>;

	/** Attaches a finally handler. Forwarded to the underlying Promise. */
	finally(onfinally?: (() => void) | null | undefined): Promise<A>;
}

// ── Pipe API (returned by configure()) ────────────────────────────────────────

/**
 * The frozen API object returned by {@link configure} and the default export.
 * Every method is a pure constructor — no shared mutable state.
 */
export interface PipeAPI {
	/** Library version string. */
	readonly version: string;

	/** Resolved operational limits for this configured instance. */
	readonly config: Readonly<ResolvedConfig>;

	/**
	 * Lift any value into the Pipe monad.
	 * Non-Promise values are wrapped via `Promise.resolve()`.
	 *
	 * @example
	 * await Pipe.of(42).map(n => n * 2); // 84
	 */
	of<A>(value: A): Pipe<Awaited<A>>;

	/**
	 * Create a pre-rejected Pipe. Useful for tests or lifting existing errors.
	 *
	 * @example
	 * const pipe = Pipe.reject(new Error('oops'));
	 */
	reject(reason?: unknown): Pipe<never>;

	/**
	 * Lift an existing Promise or thenable into the Pipe monad.
	 *
	 * - Native Promise → zero overhead, no extra microtask.
	 * - Foreign thenable → safely wrapped via `Promise.resolve()`.
	 * - Non-thenable → throws `PipeError` synchronously.
	 *
	 * @throws {PipeError} If `p` is not a Promise or thenable.
	 *
	 * @example
	 * const pipe = Pipe.from(fetch('/api/data').then(r => r.json()));
	 */
	from<A>(p: Promise<A> | PromiseLike<A>): Pipe<A>;

	/**
	 * Construct a Pipe from a zero-argument async factory.
	 * Use this as the entry point for `.retryWhen()`.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * Pipe.fromAsync(() => fetch('/api/orders').then(r => r.json()))
	 *   .retryWhen(e => e.status === 503, { attempts: 3 });
	 */
	fromAsync<A>(fn: (signal?: AbortSignal) => Promise<A>, opts?: FromAsyncOptions): Pipe<A>;

	/**
	 * Lift a plain function into a Pipe-returning form.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * const double = Pipe.lift((n: number) => n * 2);
	 * const inc    = Pipe.lift((n: number) => n + 1);
	 * await double(10).chain(inc); // 21
	 */
	lift<A extends unknown[], B>(fn: (...args: A) => B): (...args: A) => Pipe<Awaited<B>>;

	/**
	 * Resolve all Pipes/Promises concurrently. Rejects on first failure (fail-fast).
	 *
	 * @throws {PipeError} Synchronously, if `ps` is not an Array.
	 */
	all<A>(ps: Array<Pipe<A> | Promise<A> | A>): Pipe<Awaited<A>[]>;

	/**
	 * Race all Pipes/Promises — the first to settle wins.
	 *
	 * @throws {PipeError} Synchronously, if `ps` is not an Array.
	 */
	race<A>(ps: Array<Pipe<A> | Promise<A> | A>): Pipe<Awaited<A>>;

	/**
	 * Settle all Pipes/Promises concurrently, collecting every outcome.
	 *
	 * @throws {PipeError} Synchronously, if `ps` is not an Array.
	 */
	allSettled<A>(ps: Array<Pipe<A> | Promise<A> | A>): Pipe<PromiseSettledResult<Awaited<A>>[]>;

	/**
	 * Bridge a Node.js-style `(err, result)` callback into the Pipe monad.
	 * One-shot guard prevents double-invoke from buggy callbacks.
	 *
	 * @throws {PipeError} Synchronously, if `fn` is not a function.
	 *
	 * @example
	 * import { readFile } from 'node:fs';
	 *
	 * await Pipe.fromCallback(readFile, 'config.json', 'utf8')
	 *   .map(JSON.parse)
	 *   .orElse(() => defaultConfig);
	 */
	// Overloads for common arities. The trailing callback is always
	// `(err: unknown, result: A) => void` — the one-shot guard in the
	// implementation prevents double-invoke regardless of arity.
	fromCallback<A>(fn: (cb: (err: unknown, result: A) => void) => void): Pipe<A>;
	fromCallback<A, T1>(fn: (a1: T1, cb: (err: unknown, result: A) => void) => void, a1: T1): Pipe<A>;
	fromCallback<A, T1, T2>(fn: (a1: T1, a2: T2, cb: (err: unknown, result: A) => void) => void, a1: T1, a2: T2): Pipe<A>;
	fromCallback<A, T1, T2, T3>(fn: (a1: T1, a2: T2, a3: T3, cb: (err: unknown, result: A) => void) => void, a1: T1, a2: T2, a3: T3): Pipe<A>;
	fromCallback<A, T1, T2, T3, T4>(fn: (a1: T1, a2: T2, a3: T3, a4: T4, cb: (err: unknown, result: A) => void) => void, a1: T1, a2: T2, a3: T3, a4: T4): Pipe<A>;

	/**
	 * Map `fn` over `arr` where `fn` returns a `Pipe` per element, then
	 * collect all results concurrently.
	 *
	 * Semantics: all succeed → `Pipe<B[]>`, first failure → `Pipe<never>`.
	 *
	 * @throws {PipeError} Synchronously, if `arr` is not an Array or `fn` is
	 *   not a function.
	 *
	 * @example
	 * const users = await Pipe.traverse([1, 2, 3], id =>
	 *   Pipe.fromAsync(() => fetchUser(id))
	 *     .orFail(e => new Error(`user ${id}: ${e.message}`))
	 * ).orElse(() => []);
	 */
	traverse<A, B>(arr: A[], fn: (item: A, index: number) => Pipe<B> | Promise<B>): Pipe<B[]>;
}

// ── Public exports ─────────────────────────────────────────────────────────────

/**
 * Build a Pipe API with custom operational limits.
 *
 * All options are optional — omitted values fall back to module defaults.
 * Each `configure()` call produces a fully independent `PipeAPI` instance
 * with its own internal state. Two configured instances never share state.
 *
 * Validation is eager: bad limit values throw `PipeError` synchronously at
 * setup time, not at the first `.timeout()` or `.retryWhen()` call.
 *
 * @throws {PipeError} If any limit value is out of range.
 *
 * @example
 * import { configure } from './pipe.mjs';
 *
 * const Pipe = configure({ maxTimeout: 60_000, maxAttempts: 5, maxDelay: 5_000 });
 * console.log(Pipe.config); // { maxTimeout: 60000, maxAttempts: 5, maxDelay: 5000 }
 */
export declare function configure(opts?: ConfigureOptions): Readonly<PipeAPI>;

/**
 * Pre-configured Pipe API with default operational limits:
 *
 * ```
 * maxTimeout  = 300_000 ms  (5 minutes)
 * maxAttempts = 20
 * maxDelay    = 30_000 ms   (30 seconds)
 * ```
 *
 * For most applications this is the only import needed.
 *
 * @example
 * import Pipe from './pipe.mjs';
 * const result = await Pipe.of(42).map(n => n * 2); // 84
 */
declare const Pipe: Readonly<PipeAPI>;
export default Pipe;