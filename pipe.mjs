/**
 * @fileoverview pipe.mjs — v0.2.0
 *
 * Elegant async pipelines that flow, transform, and recover without the noise.
 *
 * A monadic Promise proxy for vanilla JS. Wraps async values in a chainable,
 * fully thenable interface without abandoning the native Promise ecosystem.
 * Every entry point is input-validated with synchronous guards that throw
 * before entering the Promise chain — clean stack traces, not buried TypeErrors.
 *
 * @module pipe
 * @version 0.2.0
 *
 * @example <caption>Zero-config import</caption>
 * import Pipe from './pipe.mjs';
 * const result = await Pipe.of(42).map(n => n * 2); // 84
 *
 * @example <caption>Custom operational limits</caption>
 * import { configure } from './pipe.mjs';
 * const Pipe = configure({ maxTimeout: 60_000, maxAttempts: 5, maxDelay: 5_000 });
 *
 * @example <caption>Full pipeline</caption>
 * const data = await Pipe.fromAsync(fetchOrders)
 *   .retryWhen(e => e.status === 503, { attempts: 3, delay: 150 })
 *   .timeout(5_000)
 *   .tap(d => metrics.count(d.length))
 *   .tapError(e => logger.error('pipeline', e))
 *   .orFail(e => new AppError('orders.fetch', e))
 *   .orRecover(async () => cache.get('orders:latest'))
 *   .orElse(() => []);
 */

// ── Operational defaults ───────────────────────────────────────────────────────
// Exported so consumers can read them without having to hardcode magic numbers.
// Pass overrides to configure() to produce an instance with different limits.

/** @type {number} Default upper bound for `.timeout(ms)` — 5 minutes in ms. */
export const DEFAULT_MAX_TIMEOUT = 300_000;

/** @type {number} Default upper bound for `.retryWhen` attempt count. */
export const DEFAULT_MAX_ATTEMPTS = 20;

/** @type {number} Default upper bound for `.retryWhen` inter-attempt delay in ms. */
export const DEFAULT_MAX_DELAY = 30_000;

/** @type {string} Current library version. */
export const VERSION = '0.2.0';

// ── Internal Symbol ────────────────────────────────────────────────────────────
// $$p_ is the key under which each Pipe instance stores its underlying Promise.
//
// Using a module-scoped, unexported Symbol rather than the plain string 'p'
// gives three concrete guarantees:
//
//   1. Unguessable from outside — no consumer can do `pipe[$$p_]` without having
//      imported $$p_, which we never export.
//   2. Collision-free — even if a pipeline value happens to have a `.p` property,
//      the Symbol key never conflicts with it.
//   3. Invisible to reflection — Symbol keys are excluded from Object.keys(),
//      JSON.stringify(), and for...in enumeration. Only Reflect.ownKeys() and
//      Object.getOwnPropertySymbols() surface them, and neither is called on a
//      Pipe instance by any standard library code.
//
// This completes the encapsulation picture:
//   * #__bind_cache_  — spec-private static  (inaccessible by syntax)
//   * #__make_pipe$   — spec-private static  (inaccessible by syntax)
//   * $$p_            — unexported Symbol     (inaccessible without the key)
//   * Proto           — module-scoped closure (never exported)

/**
 * Module-private Symbol used as the property key for the underlying Promise
 * on every Pipe instance. Never exported — callers cannot access it.
 *
 * @type {symbol}
 */
const $$p_ = Symbol('Pipe.internal');

/**
 * Thrown (as a rejection) when a `.timeout()` deadline is exceeded.
 * Extends `Error` directly so `instanceof TimeoutError` is always reliable
 * across module realms when the same pipe.mjs copy is used.
 *
 * @extends {Error}
 *
 * @example
 * import Pipe, { TimeoutError } from './pipe.mjs';
 *
 * await Pipe.fromAsync(slowFetch)
 *   .timeout(2_000)
 *   .orElse(e => e instanceof TimeoutError ? fallback : Promise.reject(e));
 */
export class TimeoutError extends Error {
	/**
	 * @param {number} [ms=DEFAULT_MAX_TIMEOUT] The deadline that was exceeded, in ms.
	 */
	constructor(ms = DEFAULT_MAX_TIMEOUT) {
		super(`Pipe timed out after ${ms}ms`);
		/** @type {string} Always `'TimeoutError'` — survives minification. */
		this.name = 'TimeoutError';
		/** @type {number} The deadline that was exceeded, in ms. */
		this.ms = ms;
	}
}

/**
 * Thrown synchronously by any Pipe guard when an argument fails validation.
 * Extends `TypeError` because an invalid argument is always a type contract
 * violation — bad ms value, non-function callback, non-array iterable, etc.
 *
 * Catching `PipeError` at startup is a signal that the call site is wrong,
 * not that the runtime environment is flaky.
 *
 * @extends {TypeError}
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
export class PipeError extends TypeError {
	/**
	 * @param {string} msg Human-readable description of the violation.
	 *   Never includes the user-supplied value — avoids log injection.
	 */
	constructor(msg) {
		super(msg);
		/** @type {string} Always `'PipeError'` — survives minification. */
		this.name = 'PipeError';
	}
}

/**
 * Rejection reason used when an abort-aware execution is cancelled.
 *
 * @extends {Error}
 */
export class AbortError extends Error {
	/**
	 * @param {unknown} [reason]
	 */
	constructor(reason) {
		super('Pipe execution aborted');
		this.name = 'AbortError';
		this.reason = reason;
	}
}

/**
 * Internal throw helper. Unified entry point so every guard produces a
 * `PipeError` and nothing else escapes as a raw `Error` or `TypeError`.
 *
 * @param {string} msg
 * @returns {never}
 */
const __throw$ = (msg) => { throw new PipeError(msg); };

/**
 * Assert that `v` is callable. Returns `v` unchanged so it can be used
 * inline as an expression: `this[$p].then(assertFn(fn, 'map'))`.
 *
 * @template {Function} T
 * @param {T} v - Value to check.
 * @param {string} n - Method/parameter name for the error message.
 * @returns {T} `v` if it is a function.
 * @throws {PipeError} If `v` is not a function.
 */
const assertFn = (v, n) =>
	typeof v === 'function' ? v : __throw$(`${n}: expected a function`);

/**
 * Assert plain object-ish value (non-null object).
 *
 * @param {unknown} v
 * @param {string} n
 * @returns {object}
 */
const assertObject = (v, n) =>
	v && typeof v === 'object' ? v : __throw$(`${n}: expected an object`);

/**
 * Assert boolean when provided.
 *
 * @param {unknown} v
 * @param {string} n
 * @returns {boolean}
 */
const assertBoolean = (v, n) =>
	typeof v === 'boolean' ? v : __throw$(`${n}: expected a boolean`);

/**
 * Assert that `v` is a finite positive integer within the configured timeout
 * bound. Blocks `setTimeout(fn, NaN)` (fires immediately) and
 * `setTimeout(fn, Infinity)` (never fires).
 *
 * @param {unknown} v - Value to check.
 * @param {string} n - Method/parameter name for the error message.
 * @param {number} [maxTimeout=DEFAULT_MAX_TIMEOUT] - Upper bound (inclusive).
 * @returns {number} `v` if it is a valid ms value.
 * @throws {PipeError} If `v` is not a positive integer in `(0, maxTimeout]`.
 */
const assertMs = (v, n, maxTimeout = DEFAULT_MAX_TIMEOUT) =>
	Number.isInteger(v) && v > 0 && v <= maxTimeout
		? v
		: __throw$(`${n}: ms must be an integer in (0, ${maxTimeout}]`);

/**
 * Assert that `v` is a true Array instance.
 *
 * Two noteworthy cases this guard blocks:
 * - Strings: `Array.isArray('abc')` is `false`, but iteration still works —
 *   a string passed to `.merge()` would silently spread as characters.
 * - `Array.prototype`: `Array.isArray(Array.prototype)` is `true` (it is an
 *   exotic Array object) but using it as an iterable is a footgun because it
 *   carries prototype methods as enumerable items in some engines.
 *
 * @param {unknown} v - Value to check.
 * @param {string} n - Method/parameter name for the error message.
 * @returns {Array} `v` if it is a valid Array.
 * @throws {PipeError} If `v` is not an Array, or is `Array.prototype`.
 */
const assertArray = (v, n) =>
	Array.isArray(v) && v !== Array.prototype
		? v
		: __throw$(`${n}: expected an Array`);

/**
 * Assert AbortSignal-ish value.
 *
 * @param {unknown} signal
 * @returns {AbortSignal}
 */
const assertAbortSignal = (signal) =>
	(signal && typeof signal === 'object'
		&& typeof signal.aborted === 'boolean'
		&& typeof signal.addEventListener === 'function'
		&& typeof signal.removeEventListener === 'function')
		? signal
		: __throw$('fromAsync signal: expected an AbortSignal');

// ── Proto factory ──────────────────────────────────────────────────────────────

/**
 * Build a frozen class whose prototype carries all Pipe instance methods,
 * closing over the resolved `cfg` limits for `.timeout()` and `.retryWhen()`.
 *
 * Called exactly once per {@link configure} invocation. Each call produces an
 * independent class with its own private `#__bind_cache_` and `#__make_pipe$`,
 * so two configured Pipe instances never share internal state.
 *
 * ### Key invariants
 * | Invariant | Mechanism |
 * |---|---|
 * | Instance methods inherited correctly | `Object.create(Proto.prototype)` |
 * | Proxy trap never matches Object.prototype methods | `Object.hasOwn(Proto.prototype, prop)` |
 * | Bind cache inaccessible outside class body | `static #__bind_cache_` (spec-private) |
 * | Factory inaccessible outside class body | `static #__make_pipe$` (spec-private) |
 * | Underlying Promise inaccessible without key | `instance[$p]` (unexported Symbol) |
 * | Single external entry point | `static makePipe` (public accessor) |
 * | Methods immutable after construction | `Object.freeze(Proto.prototype)` |
 * | Static fields immutable after construction | `Object.freeze(Proto)` |
 *
 * @param {object} cfg - Resolved, validated configuration from {@link configure}.
 * @param {number} cfg.maxTimeout
 * @param {number} cfg.maxAttempts
 * @param {number} cfg.maxDelay
 * @returns {typeof Proto} The frozen class constructor.
 */
const __define_proto$ = (cfg = {}) => {
	const {
		maxTimeout = DEFAULT_MAX_TIMEOUT,
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		maxDelay = DEFAULT_MAX_DELAY,
	} = cfg;

	class Proto {
		/**
		 * Bind cache: maps each underlying Promise to a null-prototype object
		 * whose keys are property names and values are pre-bound Promise methods.
		 *
		 * Without this, the Proxy `get` trap would call `p[prop].bind(p)` on every
		 * property read, creating a new function object each time. The WeakMap keyed
		 * on `p` ensures the cache is GC'd when the Promise itself is collected.
		 *
		 * Hard private — `Object.getOwnPropertyNames`, `Object.getOwnPropertySymbols`,
		 * and `Reflect.ownKeys` all return nothing for `#`-prefixed fields.
		 *
		 * @type {WeakMap<Promise, Record<string, Function>>}
		 */
		static #__bind_cache_ = new WeakMap();
		/** @type {WeakMap<Promise, Function>} Replay source for retry-capable pipes. */
		static #__retry_source_ = new WeakMap();

		/**
		 * The real factory. Private so that no external code can construct a Pipe
		 * instance or invoke the factory on an arbitrary Promise without going
		 * through the validated public API surface.
		 *
		 * Stores the underlying Promise under the module-private Symbol key `$p`
		 * rather than a plain string property. This prevents consumers from
		 * accessing the raw Promise via `pipe[$p]` (they don't have `$p`) and
		 * eliminates any collision with a pipeline value that has its own `.p`.
		 *
		 * Wraps `promise` in a `Proxy` that intercepts property reads with the
		 * following priority:
		 * 1. Own method on `Proto.prototype` → dispatch to the Pipe method.
		 * 2. The sentinel Symbol `$p` → return the underlying Promise directly.
		 * 3. Non-function on the Promise → return it as-is (e.g. `Symbol.toStringTag`).
		 * 4. Function on the Promise → return a bound copy, cached in `#__bind_cache_`.
		 *
		 * This makes every Pipe instance fully thenable and `await`-able without
		 * manual forwarding of `.then`, `.catch`, or `.finally`.
		 *
		 * @param {Promise|*} promise - Value to wrap. Non-Promises are lifted via
		 *   `Promise.resolve()`. Native Promises bypass the extra microtask tick.
		 * @returns {Proxy} A Pipe instance proxying the resolved Promise.
		 */
		static #__make_pipe$(promise, retrySource) {
			const p = promise?.constructor === Promise ? promise : Promise.resolve(promise);
			typeof retrySource === 'function' && Proto.#__retry_source_.set(p, retrySource);
			const instance = Object.create(Proto.prototype);
			instance[$$p_] = p;   // Symbol key — unguessable, collision-free

			return new Proxy(instance, {
				/**
				 * Property read interceptor.
				 *
				 * `Object.hasOwn` (not `in`) is critical here: `in` walks the prototype
				 * chain of `Proto.prototype`, which ultimately includes `Object.prototype`.
				 * That means `'toString' in Proto.prototype` is `true`, so `.toString`
				 * would be served as a Pipe method instead of being forwarded to the
				 * Promise — silently breaking `Object.prototype.toString.call(pipe)`.
				 */
				get(target, prop, receiver) {
					return Object.hasOwn(Proto.prototype, prop)
						? Reflect.get(target, prop, receiver)
						: prop === $$p_
							? p
							: typeof p[prop] !== 'function'
								? p[prop]
								: (Proto.#__bind_cache_.get(p)
									?? (Proto.#__bind_cache_.set(p, Object.create(null)),
										Proto.#__bind_cache_.get(p)))
								[prop] ??= p[prop].bind(p);
				},
			});
		}

		/**
		 * Public static accessor — the only surface of `#__make_pipe$` that escapes
		 * the class body. Exists solely so {@link configure} can do
		 * `Proto.makePipe.bind(Proto)` without touching the private field.
		 *
		 * All internal method calls bypass this wrapper and call `#__make_pipe$`
		 * directly for zero overhead.
		 *
		 * @param {Promise|*} promise
		 * @returns {Proxy} A Pipe instance.
		 */
		static makePipe(promise, retrySource) { return Proto.#__make_pipe$(promise, retrySource); }

		// ── Core monad ────────────────────────────────────────────────────────
		// These four methods form the functor/monad core.
		// `.chain` is identical to `.map` at the implementation level — `.then`
		// already flattens thenables, so no extra `Promise.resolve()` wrap is needed.
		// The distinction is semantic: `.map` signals sync transform, `.chain` signals
		// "this returns a Pipe/Promise and I want it flat".

		/**
		 * Transform the resolved value. The function may be sync or async.
		 * Equivalent to `Promise.then` but stays in Pipe-land.
		 *
		 * @template A, B
		 * @param {function(A): B | Promise<B>} fn - Transform function.
		 * @returns {Proto} A new Pipe wrapping the transformed value.
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * await Pipe.of(10).map(n => n * 2); // 20
		 */
		map(fn) { return Proto.#__make_pipe$(this[$$p_].then(assertFn(fn, 'map'))) }

		/**
		 * Sequence an async step. `fn` should return a Pipe or Promise — `.then`
		 * flattens it automatically, preventing `Pipe<Pipe<B>>` nesting.
		 *
		 * @template A, B
		 * @param {function(A): Proto | Promise<B>} fn - Factory returning a Pipe or Promise.
		 * @returns {Proto} A new flat Pipe — never nested.
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * const fetchUser   = id   => Pipe.fromAsync(() => fetch(`/users/${id}`).then(r => r.json()));
		 * const fetchOrders = user => Pipe.fromAsync(() => fetch(`/orders/${user.id}`).then(r => r.json()));
		 *
		 * await fetchUser(1).chain(fetchOrders); // flat Pipe<Order[]>
		 */
		chain(fn) { return Proto.#__make_pipe$(this[$$p_].then(assertFn(fn, 'chain'))) }

		/**
		 * Replace the current value with a constant. Equivalent to `.map(() => v)`
		 * but communicates intent clearly: "I care about sequencing, not the value."
		 *
		 * @template B
		 * @param {B} v - Replacement value.
		 * @returns {Proto} A new Pipe resolving to `v`.
		 *
		 * @example
		 * await Pipe.of(userId)
		 *   .chain(db.deleteUser)     // returns { affected: 1 }
		 *   .mapTo({ success: true }); // discard db result
		 */
		mapTo(v) { return Proto.#__make_pipe$(this[$$p_].then(() => v)) }

		/**
		 * Run a side-effect on the resolved value without transforming it.
		 * The value passes through unchanged. If `fn` throws, the Pipe becomes
		 * rejected — use `.tapError` for error-channel side effects.
		 *
		 * @template A
		 * @param {function(A): void} fn - Side-effect function (return value ignored).
		 * @returns {Proto} A new Pipe resolving to the same value.
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * await Pipe.of(orders)
		 *   .tap(o => metrics.count(o.length))
		 *   .map(summarise);
		 */
		tap(fn) {
			assertFn(fn, 'tap');
			const next = this[$$p_].then(v => (fn(v), v));
			const retrySource = Proto.#__retry_source_.get(this[$$p_]);
			return retrySource
				? Proto.#__make_pipe$(next, retrySource)
				: Proto.#__make_pipe$(next);
		}

		// ── Error channel ──────────────────────────────────────────────────────
		// Three distinct error-channel operations covering the three meaningful
		// things you can do with a failure: recover from it, reshape it, or
		// observe it without consuming it.

		/**
		 * Recover from any rejection by providing a fallback value (or async
		 * computation). Re-enters the success channel — subsequent `.map` / `.chain`
		 * calls will see the fallback value.
		 *
		 * @template A
		 * @param {function(Error): A | Promise<A>} fn - Fallback producer.
		 * @returns {Proto} A new Pipe on the success channel.
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * await Pipe.fromAsync(fetchUser).orElse(() => guestUser);
		 */
		orElse(fn) { return Proto.#__make_pipe$(this[$$p_].catch(assertFn(fn, 'orElse'))) }

		/**
		 * Reshape or enrich a rejection while staying in the error channel.
		 * The Pipe remains rejected — only the error object changes.
		 * Use this to add context, normalise error types, or attach error codes
		 * before the error surfaces to a caller.
		 *
		 * @param {function(Error): Error} fn - Error transformer. Must return an Error.
		 * @returns {Proto} A new Pipe, still rejected, with the transformed error.
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * Pipe.fromAsync(fetchOrders)
		 *   .orFail(e => Object.assign(new Error(`orders: ${e.message}`), { code: 'ORDERS_ERR' }))
		 *   .orElse(() => []);
		 */
		orFail(fn) {
			assertFn(fn, 'orFail');
			return Proto.#__make_pipe$(this[$$p_].catch(e => Promise.reject(fn(e))));
		}

		/**
		 * Recover from a rejection via an async computation — hit a cache,
		 * call a fallback API, or compute a replacement value asynchronously.
		 * Semantically identical to `.orElse` but signals async intent at the
		 * call site. Re-enters the success channel on resolution.
		 *
		 * @template A
		 * @param {function(Error): Promise<A>} fn - Async fallback producer.
		 * @returns {Proto} A new Pipe on the success channel.
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * Pipe.fromAsync(fetchUser)
		 *   .orRecover(async () => cache.get('user:latest'));
		 */
		orRecover(fn) { return Proto.#__make_pipe$(this[$$p_].catch(assertFn(fn, 'orRecover'))) }

		/**
		 * Run a side-effect on the rejection reason without consuming it.
		 * The Pipe stays rejected — the error propagates to the next handler unchanged.
		 * Use for logging, metrics, or alerting in the failure path.
		 *
		 * **Isolation guarantee:** if `fn` itself throws, that secondary exception is
		 * silently discarded and the *original* error is re-rejected. A crashing
		 * logger must never replace the upstream failure.
		 *
		 * @param {function(Error): void} fn - Side-effect (return value ignored).
		 * @returns {Proto} A new Pipe, still rejected with the original error.
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * Pipe.fromAsync(fetchData)
		 *   .tapError(e => logger.error('fetch failed', e))  // logs, stays rejected
		 *   .orElse(() => []);                               // then recovers
		 */
		tapError(fn) {
			assertFn(fn, 'tapError');
			const next = this[$$p_].catch(e => {
				try { fn(e); } catch (_) { /* fn threw — discard, preserve original */ }
				return Promise.reject(e);
			});
			const retrySource = Proto.#__retry_source_.get(this[$$p_]);
			return retrySource
				? Proto.#__make_pipe$(next, retrySource)
				: Proto.#__make_pipe$(next);
		}

		// ── Resilience ────────────────────────────────────────────────────────

		/**
		 * Race the pipeline against a hard deadline.
		 *
		 * If the Pipe resolves before `ms` elapses, it passes through unchanged.
		 * If the deadline fires first, the Pipe rejects with a {@link TimeoutError}.
		 * An optional `fallback` function intercepts only `TimeoutError` rejections
		 * and re-enters the success channel — non-timeout errors still propagate.
		 *
		 * @param {number} ms - Deadline in milliseconds. Must be a positive integer
		 *   in `(0, maxTimeout]`. Blocks `NaN` (fires immediately) and `Infinity`
		 *   (never fires).
		 * @param {function(TimeoutError): *} [fallback] - Optional inline recovery.
		 *   If omitted, timeout rejects with `TimeoutError`.
		 * @returns {Proto} A new Pipe resolving to the original value, the fallback,
		 *   or rejecting with `TimeoutError`.
		 * @throws {PipeError} Synchronously, if `ms` is invalid or `fallback` is
		 *   provided but is not a function.
		 *
		 * @example <caption>Reject on timeout</caption>
		 * await Pipe.fromAsync(heavyReport)
		 *   .timeout(3_000)
		 *   .orElse(() => cachedReport);
		 *
		 * @example <caption>Inline fallback</caption>
		 * await Pipe.fromAsync(fetchUser).timeout(2_000, () => guestUser);
		 */
		timeout(ms, fallback) {
			assertMs(ms, 'timeout', maxTimeout);
			fallback !== undefined && assertFn(fallback, 'timeout fallback');
			const timer = new Promise((_, rej) =>
				setTimeout(() => rej(new TimeoutError(ms)), ms));
			const race = Promise.race([this[$$p_], timer]);
			return Proto.#__make_pipe$(
				fallback
					? race.catch(e =>
						e instanceof TimeoutError ? fallback(e) : Promise.reject(e))
					: race
			);
		}

		/**
		 * Retry the upstream on transient failure, with exponential backoff and
		 * optional jitter.
		 *
		 * The `predicate` receives the error and the 1-based attempt number.
		 * Return `true` to retry, `false` (or throw) to propagate immediately.
		 * If the predicate throws, that exception becomes the new rejection —
		 * this is intentional: throw = "don't retry, fail with this error".
		 *
		 * Backoff: each wait is `lastDelay * 2`, capped at `maxDelay`.
		 * Jitter: ±25% randomisation prevents thundering-herd on shared upstreams.
		 *
		 * **Note:** retries re-run `this[$p]`, the current Promise value. For retry
		 * to re-execute a network call, the factory must be the upstream:
		 * `Pipe.fromAsync(factory).retryWhen(...)`, not `.map(fetch).retryWhen(...)`.
		 *
		 * @param {function(Error, number): boolean} predicate - Controls which errors
		 *   are retried. Receives `(error, attemptNumber)`.
		 * @param {object}  [opts={}]
		 * @param {number}  [opts.attempts=3]    Max retry count, clamped to `[1, maxAttempts]`.
		 * @param {number}  [opts.delay=200]     Initial delay in ms, clamped to `[0, maxDelay]`.
		 * @param {boolean} [opts.jitter=true]   Add ±25% randomisation to each wait.
		 * @returns {Proto} A new Pipe resolving on success or rejecting after exhaustion.
		 * @throws {PipeError} Synchronously, if `predicate` is not a function.
		 *
		 * @example
		 * const isTransient = (e, attempt) => e.status === 503 && attempt < 4;
		 *
		 * await Pipe.fromAsync(fetchOrders)
		 *   .retryWhen(isTransient, { attempts: 4, delay: 300 })
		 *   .orElse(() => []);
		 */
		retryWhen(predicate, opts = {}) {
			assertFn(predicate, 'retryWhen predicate');
			const attempts = Math.min(maxAttempts, Math.max(1,
				Number.isInteger(opts.attempts) ? opts.attempts : 3));
			const delay = Math.min(maxDelay, Math.max(0,
				Number.isFinite(opts.delay) ? opts.delay : 200));
			const jitter = opts.jitter !== false;
			const retrySource = Proto.#__retry_source_.get(this[$$p_]);

			const __make_retry_promise$ = () => {
				if (typeof retrySource !== 'function') return this[$$p_];
				try { return Promise.resolve(retrySource()); }
				catch (err) { return Promise.reject(err); }
			};

			const run = (remaining, lastDelay, currentPromise) =>
				Proto.#__make_pipe$(currentPromise.catch(e =>
					((() => {
						const attemptNumber = attempts - remaining + 1;
						const shouldRetry = !(remaining <= 0) && !!predicate(e, attemptNumber);
						return shouldRetry;
					})())
						? new Promise(res => setTimeout(res,
							jitter
								? lastDelay * (0.75 + Math.random() * 0.5)
								: lastDelay))
							.then(() => run(
								remaining - 1,
								Math.min(lastDelay * 2, maxDelay),
								__make_retry_promise$(),
							)[$$p_])
						: Promise.reject(e)
				));

			return run(attempts, delay, this[$$p_]);
		}

		// ── Collection ────────────────────────────────────────────────────────

		/**
		 * Merge this Pipe with additional Pipes, Promises, or plain values,
		 * resolving all concurrently.
		 *
		 * Uses `Promise.allSettled` semantics: failures become `Error` values in
		 * the result array rather than short-circuiting the whole merge. Nothing
		 * is lost — callers can inspect each element with `instanceof Error`.
		 *
		 * The result array preserves insertion order: `[this, ...others]`.
		 *
		 * @param {Array<Proto|Promise|*>} others - Additional values to merge.
		 *   Each item is wrapped with `Promise.resolve()` — Pipes, Promises, and
		 *   plain values all work.
		 * @returns {Proto} A new Pipe resolving to `(a | Error)[]`.
		 * @throws {PipeError} Synchronously, if `others` is not an Array.
		 *
		 * @example
		 * const [primary, backup] = await Pipe.fromAsync(fetchPrimary)
		 *   .merge([Pipe.fromAsync(fetchBackup)]);
		 *
		 * // backup may be an Error if fetchBackup rejected — check before use
		 * const data = backup instanceof Error ? [] : backup;
		 */
		merge(others) {
			assertArray(others, 'merge');
			const all = [this[$$p_], ...others.map(o => Promise.resolve(o))];
			return Proto.#__make_pipe$(
				Promise.allSettled(all).then(results =>
					results.map(r => r.status === 'fulfilled' ? r.value : r.reason)
				)
			);
		}

		/**
		 * Sort an array value carried by the Pipe.
		 *
		 * Always operates on a shallow copy (`[...arr]`) — the upstream array is
		 * never mutated. If the Pipe value is not an Array, rejects with a
		 * `PipeError` (catchable via `.orElse`).
		 *
		 * @param {function(*, *): number} [comparator] - Standard Array comparator.
		 *   Optional — omitting it uses JS default lexicographic sort.
		 *   Must be a function if provided.
		 * @returns {Proto} A new Pipe resolving to the sorted copy.
		 * @throws {PipeError} Synchronously, if `comparator` is provided but is
		 *   not a function. Also rejects if the pipe value is not an Array.
		 *
		 * @example <caption>Descending numeric sort</caption>
		 * await Pipe.of([3, 1, 4, 1, 5]).sort((a, b) => b - a); // [5, 4, 3, 1, 1]
		 *
		 * @example <caption>Natural lexicographic sort</caption>
		 * await Pipe.of(['zebra', 'apple', 'mango']).sort(); // ['apple', 'mango', 'zebra']
		 */
		sort(comparator) {
			comparator !== undefined && assertFn(comparator, 'sort comparator');
			return Proto.#__make_pipe$(this[$$p_].then(arr => {
				assertArray(arr, 'sort: pipe value');
				return comparator ? [...arr].sort(comparator) : [...arr].sort();
			}));
		}
	}

	// Freeze after the class body closes — `Object.freeze` cannot be called
	// inside a class declaration. Freezing the prototype makes all instance
	// methods immutable; freezing the constructor locks static fields too.
	Object.freeze(Proto.prototype);
	Object.freeze(Proto);

	return Proto;
};

// ── Public factory ─────────────────────────────────────────────────────────────

/**
 * Build a Pipe API with custom operational limits.
 *
 * All options are optional — omitted values fall back to the module defaults.
 * Each `configure()` call produces a fully independent Pipe instance with its
 * own `Proto` class, its own private `#__bind_cache_`, and its own frozen API
 * object. Two configured instances in the same app share no internal state.
 *
 * Validation is eager: bad limit values throw a `PipeError` synchronously at
 * setup time, not silently at the first `.timeout()` or `.retryWhen()` call.
 *
 * @param {object}  [opts={}]
 * @param {number}  [opts.maxTimeout=300_000]
 *   Upper bound for `.timeout(ms)` in ms. Must be a positive integer.
 * @param {number}  [opts.maxAttempts=20]
 *   Upper bound for `.retryWhen` attempt count. Must be a positive integer.
 * @param {number}  [opts.maxDelay=30_000]
 *   Upper bound for `.retryWhen` inter-attempt delay in ms.
 *   Must be a non-negative integer (`0` = no delay between retries).
 * @returns {Readonly<object>} A frozen Pipe API object.
 * @throws {PipeError} If any limit value is out of range.
 *
 * @example
 * import { configure } from './pipe.mjs';
 *
 * const Pipe = configure({ maxTimeout: 60_000, maxAttempts: 5, maxDelay: 5_000 });
 * console.log(Pipe.config); // { maxTimeout: 60000, maxAttempts: 5, maxDelay: 5000 }
 */
export const configure = (opts = {}) => {
	const {
		maxTimeout = DEFAULT_MAX_TIMEOUT,
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		maxDelay = DEFAULT_MAX_DELAY,
		abort: abortCfgRaw = {},
		pool: poolCfgRaw = {},
		coalesce: coalesceCfgRaw = {},
	} = opts;

	// maxDelay may legitimately be 0 (no pause between retries), so its check
	// uses `isNonNeg`. maxTimeout and maxAttempts must be strictly positive.
	const isNatural = v => Number.isSafeInteger(v) && v > 0;
	const isNonNeg = v => Number.isSafeInteger(v) && v >= 0;

	// Group the two strictly-positive checks — same rule, same error shape.
	// maxDelay is separate because its rule differs (>= 0, not > 0).
	for (
		const [key, value] of Object.entries({ maxAttempts, maxTimeout })
	) if (!isNatural(value)) __throw$(`configure: ${key} must be a positive integer`);

	if (!isNonNeg(maxDelay)) __throw$('configure: maxDelay must be a non-negative integer');
	assertObject(abortCfgRaw, 'configure: abort');
	assertObject(poolCfgRaw, 'configure: pool');
	assertObject(coalesceCfgRaw, 'configure: coalesce');

	const abortEnabled = abortCfgRaw.enabled === undefined
		? false
		: assertBoolean(abortCfgRaw.enabled, 'configure: abort.enabled');
	const poolEnabled = poolCfgRaw.enabled === undefined
		? false
		: assertBoolean(poolCfgRaw.enabled, 'configure: pool.enabled');
	const poolLimit = poolCfgRaw.limit === undefined
		? 8
		: (isNatural(poolCfgRaw.limit)
			? poolCfgRaw.limit
			: __throw$('configure: pool.limit must be a positive integer'));
	const poolMaxQueue = poolCfgRaw.maxQueue === undefined
		? Infinity
		: ((poolCfgRaw.maxQueue === Infinity || isNonNeg(poolCfgRaw.maxQueue))
			? poolCfgRaw.maxQueue
			: __throw$('configure: pool.maxQueue must be a non-negative integer or Infinity'));

	const coalesceEnabled = coalesceCfgRaw.enabled === undefined
		? false
		: assertBoolean(coalesceCfgRaw.enabled, 'configure: coalesce.enabled');
	const coalesceTtl = coalesceCfgRaw.ttl === undefined
		? 0
		: (isNonNeg(coalesceCfgRaw.ttl)
			? coalesceCfgRaw.ttl
			: __throw$('configure: coalesce.ttl must be a non-negative integer'));
	const coalesceShareErrors = coalesceCfgRaw.shareErrors === undefined
		? false
		: assertBoolean(coalesceCfgRaw.shareErrors, 'configure: coalesce.shareErrors');

	const cfg = Object.freeze({
		maxTimeout,
		maxAttempts,
		maxDelay,
		abort: Object.freeze({ enabled: abortEnabled }),
		pool: Object.freeze({
			enabled: poolEnabled,
			limit: poolLimit,
			maxQueue: poolMaxQueue,
		}),
		coalesce: Object.freeze({
			enabled: coalesceEnabled,
			ttl: coalesceTtl,
			shareErrors: coalesceShareErrors,
		}),
	});
	const Proto = __define_proto$(cfg);
	const makePipe = Proto.makePipe.bind(Proto);
	const coalesced = new Map();

	/**
	 * Run task under optional AbortSignal.
	 *
	 * @param {AbortSignal|undefined} signal
	 * @param {function(): Promise<*>} task
	 * @returns {Promise<*>}
	 */
	const withAbort = (signal, task) => {
		if (!signal) return Promise.resolve().then(task);
		if (signal.aborted) return Promise.reject(new AbortError(signal.reason));
		return new Promise((resolve, reject) => {
			let settled = false;
			const cleanup = () => signal.removeEventListener('abort', onAbort);
			const onAbort = () => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(new AbortError(signal.reason));
			};
			signal.addEventListener('abort', onAbort, { once: true });
			Promise.resolve()
				.then(task)
				.then(
					v => {
						if (settled) return;
						settled = true;
						cleanup();
						resolve(v);
					},
					e => {
						if (settled) return;
						settled = true;
						cleanup();
						reject(e);
					},
				);
		});
	};

	/**
	 * Build a bounded pool scheduler.
	 *
	 * @param {number} limit
	 * @param {number} maxQueue
	 * @returns {(task: Function, signal?: AbortSignal) => Promise<*>}
	 */
	const __make_pool_scheduler$ = (limit, maxQueue) => {
		if (!poolEnabled) return (task, signal) => withAbort(signal, task);
		let active = 0;
		const queue = [];
		const dequeue = () => {
			while (active < limit && queue.length) {
				const entry = queue.shift();
				if (entry.cancelled) continue;
				active++;
				entry.cleanup?.();
				withAbort(entry.signal, entry.task)
					.then(entry.resolve, entry.reject)
					.finally(() => {
						active--;
						dequeue();
					});
			}
		};
		return (task, signal) => new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(new AbortError(signal.reason));
			if (active < limit) {
				active++;
				return withAbort(signal, task)
					.then(resolve, reject)
					.finally(() => {
						active--;
						dequeue();
					});
			}
			if (maxQueue !== Infinity && queue.length >= maxQueue) {
				return reject(new PipeError('pool: queue limit exceeded'));
			}
			const entry = {
				task,
				signal,
				resolve,
				reject,
				cancelled: false,
				cleanup: null,
			};
			if (signal) {
				const onAbort = () => {
					entry.cancelled = true;
					signal.removeEventListener('abort', onAbort);
					reject(new AbortError(signal.reason));
				};
				entry.cleanup = () => signal.removeEventListener('abort', onAbort);
				signal.addEventListener('abort', onAbort, { once: true });
			}
			queue.push(entry);
		});
	};

	const runPooled = __make_pool_scheduler$(poolLimit, poolMaxQueue);

	const trackCoalesced = (key, promise, keepOnReject) => {
		const deleteIfCurrent = () => {
			const current = coalesced.get(key);
			if (current?.promise === promise) coalesced.delete(key);
		};
		const keepForTtl = () => {
			if (coalesceTtl <= 0) return deleteIfCurrent();
			const timer = setTimeout(deleteIfCurrent, coalesceTtl);
			typeof timer.unref === 'function' && timer.unref();
			const current = coalesced.get(key);
			current?.promise === promise && (current.timer = timer);
		};
		promise.then(
			() => keepForTtl(),
			() => keepOnReject ? keepForTtl() : deleteIfCurrent(),
		);
	};

	const runWithCoalescing = (key, task) => {
		const existing = coalesced.get(key);
		if (existing) return existing.promise;
		const promise = Promise.resolve().then(task);
		coalesced.set(key, { promise, timer: null });
		trackCoalesced(key, promise, coalesceShareErrors);
		return promise;
	};

	const makeFromAsync = (source, runOpts = {}) => {
		const optsObj = runOpts === undefined ? {} : assertObject(runOpts, 'fromAsync options');
		const signal = optsObj.signal === undefined ? undefined : assertAbortSignal(optsObj.signal);
		if (signal && !abortEnabled) {
			__throw$('fromAsync: signal requires configure({ abort: { enabled: true } })');
		}
		if (optsObj.key !== undefined && !coalesceEnabled) {
			__throw$('fromAsync: key requires configure({ coalesce: { enabled: true } })');
		}
		const runOnce = () => {
			const task = () => Promise.resolve(source(signal));
			const execute = () => (poolEnabled ? runPooled(task, signal) : withAbort(signal, task));
			if (coalesceEnabled && optsObj.key !== undefined) {
				return runWithCoalescing(optsObj.key, execute);
			}
			return execute();
		};
		return makePipe(runOnce(), runOnce);
	};

	return Object.freeze({
		/** @type {string} Library version. */
		version: VERSION,

		/**
		 * Resolved operational limits for this instance.
		 * Inspect after construction to verify what you got.
		 *
		 * @type {{ maxTimeout: number, maxAttempts: number, maxDelay: number, abort: object, pool: object, coalesce: object }}
		 */
		config: cfg,

		/**
		 * Lift any value into the Pipe monad.
		 * Non-Promise values are wrapped via `Promise.resolve()`.
		 *
		 * @template A
		 * @param {A} v
		 * @returns {Proto}
		 */
		of: (v) => makePipe(Promise.resolve(v)),

		/**
		 * Create a pre-rejected Pipe. Useful for constructing failure cases
		 * in tests or for lifting existing errors into the pipeline.
		 *
		 * @param {Error} e
		 * @returns {Proto}
		 */
		reject: (e) => makePipe(Promise.reject(e)),

		/**
		 * Lift an existing Promise or thenable into the Pipe monad.
		 *
		 * - Native Promise: passes through with zero overhead (no extra microtask).
		 * - Foreign thenable: safely wrapped via `Promise.resolve()` so it cannot
		 *   hijack the internal `resolve`/`reject` callbacks.
		 * - Non-thenable: throws `PipeError` synchronously.
		 *
		 * @param {Promise|{ then: Function }|*} p
		 * @returns {Proto}
		 * @throws {PipeError} If `p` is not a Promise or thenable.
		 *
		 * @example
		 * const pipe = Pipe.from(fetch('/api/data').then(r => r.json()));
		 */
		from: (p) => {
			if (p?.constructor === Promise) return makePipe(p);
			if (typeof p?.then === 'function') return makePipe(Promise.resolve(p));
			throw new PipeError('Pipe.from: expected a Promise or thenable');
		},

		/**
		 * Construct a Pipe from an async factory function.
		 * The factory is called immediately and its return value is wrapped.
		 * Use this (not `.map`) as the entry point for `.retryWhen` — retries
		 * re-run the upstream Promise, so the factory must be the upstream.
		 *
		 * @param {function((AbortSignal|undefined)?): Promise<*>} fn - Async factory.
		 *   Receives `signal` when `configure({ abort: { enabled: true } })` and
		 *   `fromAsync(fn, { signal })` are used; otherwise `undefined`.
		 * @param {object} [runOpts={}] - Optional `{ signal, key }` (see configure()).
		 * @returns {Proto}
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * Pipe.fromAsync(() => fetch('/api/orders').then(r => r.json()))
		 *   .retryWhen(e => e.status === 503, { attempts: 3 });
		 */
		fromAsync: (fn, runOpts = {}) => {
			const source = assertFn(fn, 'fromAsync');
			return makeFromAsync(source, runOpts);
		},

		/**
		 * Lift a plain function into a Pipe-returning form.
		 * The lifted function accepts the same arguments as `fn` and returns a Pipe
		 * wrapping `fn`'s return value. Useful for composing synchronous transforms
		 * into a pipeline via `.chain`.
		 *
		 * @template A, B
		 * @param {function(...A): B} fn - Function to lift.
		 * @returns {function(...A): Proto} Lifted function.
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * const double = Pipe.lift(n => n * 2);
		 * const inc    = Pipe.lift(n => n + 1);
		 * await double(10).chain(inc); // 21
		 */
		lift: (fn) => {
			assertFn(fn, 'lift');
			return (...args) => makePipe(Promise.resolve(fn(...args)));
		},

		/**
		 * Resolve all Pipes/Promises in `ps` concurrently.
		 * Rejects immediately on the first rejection (fail-fast).
		 * Returns a Pipe wrapping the array of resolved values.
		 *
		 * @param {Array<Proto|Promise|*>} ps
		 * @returns {Proto}
		 * @throws {PipeError} Synchronously, if `ps` is not an Array.
		 */
		all: (ps) => makePipe(Promise.all(assertArray(ps, 'Pipe.all'))),

		/**
		 * Race all Pipes/Promises in `ps` — the first to settle wins.
		 *
		 * @param {Array<Proto|Promise|*>} ps
		 * @returns {Proto}
		 * @throws {PipeError} Synchronously, if `ps` is not an Array.
		 */
		race: (ps) => makePipe(Promise.race(assertArray(ps, 'Pipe.race'))),

		/**
		 * Settle all Pipes/Promises in `ps` concurrently, collecting every
		 * outcome regardless of success or failure.
		 *
		 * @param {Array<Proto|Promise|*>} ps
		 * @returns {Proto<Array<{status: string, value?: *, reason?: Error}>>}
		 * @throws {PipeError} Synchronously, if `ps` is not an Array.
		 */
		allSettled: (ps) => makePipe(Promise.allSettled(assertArray(ps, 'Pipe.allSettled'))),

		/**
		 * Bridge a Node.js-style `(err, result)` callback API into the Pipe monad.
		 *
		 * Passes `...args` followed by a generated callback to `fn`. The callback
		 * rejects on a truthy first argument and resolves on the second.
		 *
		 * **One-shot guard:** the generated callback ignores all invocations after
		 * the first. Buggy or adversarial callbacks that call back multiple times
		 * cannot resolve or reject the Pipe more than once.
		 *
		 * @param {function(...*, function(Error|null, *)): void} fn - Node-callback function.
		 * @param {...*} args - Arguments forwarded to `fn` before the callback.
		 * @returns {Proto}
		 * @throws {PipeError} Synchronously, if `fn` is not a function.
		 *
		 * @example
		 * import { readFile } from 'node:fs';
		 *
		 * await Pipe.fromCallback(readFile, 'config.json', 'utf8')
		 *   .map(JSON.parse)
		 *   .orElse(() => defaultConfig);
		 */
		fromCallback: (fn, ...args) => {
			assertFn(fn, 'fromCallback');
			return makePipe(new Promise((res, rej) => {
				let called = false;
				fn(...args, (err, val) => {
					if (called) return;
					called = true;
					err ? rej(err) : res(val);
				});
			}));
		},

		/**
		 * Map `fn` over `arr` where `fn` returns a Pipe per element, then collect
		 * all results concurrently into `Pipe<U[]>`.
		 *
		 * Semantics: all succeed → `Pipe<U[]>`, first failure → `Pipe<never>`.
		 * This is the monadic generalisation of `Promise.all(arr.map(fn))` — it
		 * keeps the result in Pipe-land and validates both arguments up front.
		 *
		 * @template T, U
		 * @param {T[]} arr - Input array.
		 * @param {function(T, number): Proto | Promise<U>} fn - Per-element factory.
		 *   Receives `(item, index)`.
		 * @returns {Proto<U[]>}
		 * @throws {PipeError} Synchronously, if `arr` is not an Array or `fn` is
		 *   not a function.
		 *
		 * @example
		 * const users = await Pipe.traverse([1, 2, 3], id =>
		 *   Pipe.fromAsync(() => fetchUser(id))
		 *     .orFail(e => new Error(`user ${id}: ${e.message}`))
		 * ).orElse(() => []);
		 */
		traverse: (arr, fn) => {
			assertArray(arr, 'Pipe.traverse');
			assertFn(fn, 'Pipe.traverse fn');
			return makePipe(Promise.all(arr.map((item, i) => Promise.resolve(fn(item, i)))));
		},
	});
};

// ── Default export ─────────────────────────────────────────────────────────────

/**
 * Pre-configured Pipe with default operational limits.
 *
 * ```
 * maxTimeout  = 300_000 ms  (5 minutes)
 * maxAttempts = 20
 * maxDelay    = 30_000 ms   (30 seconds)
 * ```
 *
 * For most applications this is the only import needed. Use the named
 * {@link configure} export only when the defaults need adjusting.
 *
 * @type {Readonly<object>}
 *
 * @example
 * import Pipe from './pipe.mjs';
 * const result = await Pipe.of(42).map(n => n * 2); // 84
 */
export default configure();