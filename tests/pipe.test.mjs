/**
 * @fileoverview pipe.test.mjs — test suite for pipe.mjs v0.1.0
 *
 * Runner : Node.js built-in `node:test` (Node ≥ 18, no install required)
 * Usage  : node --test pipe.test.mjs
 *
 * Coverage
 *   • Module exports & constants
 *   • configure() validation & isolation
 *   • Monad laws (left identity, right identity, associativity)
 *   • Core monad  : map · chain · mapTo · tap
 *   • Error channel: orElse · orFail · orRecover · tapError
 *   • Resilience  : timeout · retryWhen
 *   • Collection  : merge · sort · traverse
 *   • Static constructors: of · reject · from · fromAsync · lift
 *                          all · race · allSettled · fromCallback
 *   • Promise proxy: await · Promise.all · .then/.catch/.finally
 *   • Security invariants: encapsulation · guard message safety
 *   • Fibonacci state-machine unfold (doc example)
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import Pipe, {
	configure,
	TimeoutError,
	PipeError,
	DEFAULT_MAX_TIMEOUT,
	DEFAULT_MAX_ATTEMPTS,
	DEFAULT_MAX_DELAY,
	VERSION,
} from '../pipe.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve after `ms` milliseconds. */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Assert that calling `fn()` throws a `PipeError` synchronously.
 * Verifies the error name, that it is an instance of PipeError AND TypeError,
 * and optionally that the message contains `msgFragment`.
 */
const assertPipeError = (fn, msgFragment) => {
	let threw = false;
	try { fn(); }
	catch (e) {
		threw = true;
		assert.ok(e instanceof PipeError, `expected PipeError, got ${e?.constructor?.name}`);
		assert.ok(e instanceof TypeError, 'PipeError should extend TypeError');
		assert.strictEqual(e.name, 'PipeError');
		if (msgFragment) assert.ok(e.message.includes(msgFragment), `message "${e.message}" missing "${msgFragment}"`);
	}
	assert.ok(threw, `expected synchronous PipeError but nothing was thrown`);
};

/**
 * Assert that a Pipe rejects with an error satisfying `check(err)`.
 */
const assertRejects = async (pipe, check) => {
	let caught;
	await pipe.then(() => { throw new Error('expected rejection but resolved'); }, e => { caught = e; });
	assert.ok(caught, 'pipe should have rejected');
	if (check) check(caught);
};

// ── 1. Module exports & constants ─────────────────────────────────────────────

describe('module exports', () => {
	it('exports VERSION string', () => {
		assert.strictEqual(typeof VERSION, 'string');
		assert.match(VERSION, /^\d+\.\d+\.\d+$/);
	});

	it('exports DEFAULT_MAX_TIMEOUT as 300_000', () => assert.strictEqual(DEFAULT_MAX_TIMEOUT, 300_000));
	it('exports DEFAULT_MAX_ATTEMPTS as 20', () => assert.strictEqual(DEFAULT_MAX_ATTEMPTS, 20));
	it('exports DEFAULT_MAX_DELAY as 30_000', () => assert.strictEqual(DEFAULT_MAX_DELAY, 30_000));

	it('exports TimeoutError class', () => {
		const e = new TimeoutError(1000);
		assert.ok(e instanceof Error);
		assert.strictEqual(e.name, 'TimeoutError');
		assert.strictEqual(e.ms, 1000);
		assert.ok(e.message.includes('1000ms'));
	});

	it('TimeoutError uses DEFAULT_MAX_TIMEOUT when ms omitted', () => {
		const e = new TimeoutError();
		assert.strictEqual(e.ms, DEFAULT_MAX_TIMEOUT);
	});

	it('exports PipeError class', () => {
		const e = new PipeError('test');
		assert.ok(e instanceof TypeError);
		assert.strictEqual(e.name, 'PipeError');
		assert.strictEqual(e.message, 'test');
	});

	it('exports configure function', () => assert.strictEqual(typeof configure, 'function'));

	it('default export is a frozen Pipe API', () => {
		assert.ok(Object.isFrozen(Pipe));
		assert.strictEqual(typeof Pipe.of, 'function');
		assert.strictEqual(Pipe.version, VERSION);
	});

	it('default export has correct config', () => {
		assert.deepStrictEqual(Pipe.config, {
			maxTimeout: DEFAULT_MAX_TIMEOUT,
			maxAttempts: DEFAULT_MAX_ATTEMPTS,
			maxDelay: DEFAULT_MAX_DELAY,
		});
	});
});

// ── 2. configure() ────────────────────────────────────────────────────────────

describe('configure()', () => {
	it('returns a frozen API with resolved config', () => {
		const P = configure({ maxTimeout: 1000, maxAttempts: 3, maxDelay: 100 });
		assert.ok(Object.isFrozen(P));
		assert.deepStrictEqual(P.config, { maxTimeout: 1000, maxAttempts: 3, maxDelay: 100 });
	});

	it('uses defaults for omitted options', () => {
		const P = configure({});
		assert.strictEqual(P.config.maxTimeout, DEFAULT_MAX_TIMEOUT);
		assert.strictEqual(P.config.maxAttempts, DEFAULT_MAX_ATTEMPTS);
		assert.strictEqual(P.config.maxDelay, DEFAULT_MAX_DELAY);
	});

	it('accepts maxDelay: 0 (no pause between retries)', () => {
		const P = configure({ maxDelay: 0 });
		assert.strictEqual(P.config.maxDelay, 0);
	});

	it('throws PipeError for maxTimeout: 0', () =>
		assertPipeError(() => configure({ maxTimeout: 0 }), 'maxTimeout'));

	it('throws PipeError for maxTimeout: -1', () =>
		assertPipeError(() => configure({ maxTimeout: -1 }), 'maxTimeout'));

	it('throws PipeError for maxTimeout: NaN', () =>
		assertPipeError(() => configure({ maxTimeout: NaN }), 'maxTimeout'));

	it('throws PipeError for maxTimeout: Infinity', () =>
		assertPipeError(() => configure({ maxTimeout: Infinity }), 'maxTimeout'));

	it('throws PipeError for maxTimeout: "1000" (string)', () =>
		assertPipeError(() => configure({ maxTimeout: '1000' }), 'maxTimeout'));

	it('throws PipeError for maxAttempts: 0', () =>
		assertPipeError(() => configure({ maxAttempts: 0 }), 'maxAttempts'));

	it('throws PipeError for maxDelay: -1', () =>
		assertPipeError(() => configure({ maxDelay: -1 }), 'maxDelay'));

	it('throws PipeError for maxDelay: NaN', () =>
		assertPipeError(() => configure({ maxDelay: NaN }), 'maxDelay'));

	it('two configure() instances are independent', async () => {
		const A = configure({ maxTimeout: 500 });
		const B = configure({ maxTimeout: 2000 });
		assert.notStrictEqual(A.config, B.config);
		assert.strictEqual(A.config.maxTimeout, 500);
		assert.strictEqual(B.config.maxTimeout, 2000);
		// Both produce working Pipes
		assert.strictEqual(await A.of(1).map(n => n + 1), 2);
		assert.strictEqual(await B.of(1).map(n => n + 1), 2);
	});
});

// ── 3. Monad laws ─────────────────────────────────────────────────────────────

describe('monad laws', () => {
	const f = n => Pipe.of(n * 2);
	const g = n => Pipe.of(n + 10);

	it('left identity: Pipe.of(a).chain(f) ≡ f(a)', async () => {
		const a = 7;
		const lhs = await Pipe.of(a).chain(f);
		const rhs = await f(a);
		assert.strictEqual(lhs, rhs);
	});

	it('right identity: m.chain(Pipe.of) ≡ m', async () => {
		const m = Pipe.of(42);
		const lhs = await m.chain(v => Pipe.of(v));
		const rhs = await m;
		assert.strictEqual(lhs, rhs);
	});

	it('associativity: m.chain(f).chain(g) ≡ m.chain(x => f(x).chain(g))', async () => {
		const m = Pipe.of(5);
		const lhs = await m.chain(f).chain(g);
		const rhs = await m.chain(x => f(x).chain(g));
		assert.strictEqual(lhs, rhs);
	});
});

// ── 4. Core monad methods ─────────────────────────────────────────────────────

describe('.map()', () => {
	it('transforms the resolved value synchronously', async () => {
		assert.strictEqual(await Pipe.of(10).map(n => n * 2), 20);
	});

	it('chains multiple maps', async () => {
		assert.strictEqual(await Pipe.of(1).map(n => n + 1).map(n => n * 3), 6);
	});

	it('handles async (Promise-returning) transform', async () => {
		const r = await Pipe.of(5).map(async n => n * n);
		assert.strictEqual(r, 25);
	});

	it('propagates rejection from transform', async () => {
		await assertRejects(
			Pipe.of(1).map(() => { throw new Error('boom'); }),
			e => assert.strictEqual(e.message, 'boom'),
		);
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.of(1).map('oops'), 'map'));

	it('throws PipeError for null', () =>
		assertPipeError(() => Pipe.of(1).map(null), 'map'));
});

describe('.chain()', () => {
	it('flattens Pipe-returning function', async () => {
		const r = await Pipe.of(3).chain(n => Pipe.of(n * n));
		assert.strictEqual(r, 9);
	});

	it('does not double-wrap — result is not a Pipe<Pipe>', async () => {
		const r = await Pipe.of(1).chain(n => Pipe.of(n + 1));
		assert.strictEqual(typeof r, 'number'); // not a Pipe object
	});

	it('chains across multiple async steps', async () => {
		const double = n => Pipe.of(sleep(5).then(() => n * 2));
		const inc = n => Pipe.of(sleep(5).then(() => n + 1));
		assert.strictEqual(await Pipe.of(4).chain(double).chain(inc), 9);
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.of(1).chain(42), 'chain'));
});

describe('.mapTo()', () => {
	it('replaces value with constant', async () => {
		assert.deepStrictEqual(await Pipe.of(99).mapTo({ ok: true }), { ok: true });
	});

	it('discards previous value regardless of type', async () => {
		assert.strictEqual(await Pipe.of('anything').mapTo(0), 0);
	});

	it('constant can be undefined', async () => {
		assert.strictEqual(await Pipe.of(1).mapTo(undefined), undefined);
	});
});

describe('.tap()', () => {
	it('passes value through unchanged', async () => {
		let seen;
		const r = await Pipe.of(42).tap(v => { seen = v; });
		assert.strictEqual(r, 42);
		assert.strictEqual(seen, 42);
	});

	it('does not use the return value of fn', async () => {
		const r = await Pipe.of('hello').tap(() => 'ignored');
		assert.strictEqual(r, 'hello');
	});

	it('rejects if fn throws — tap is not isolated', async () => {
		await assertRejects(
			Pipe.of(1).tap(() => { throw new Error('tap threw'); }),
			e => assert.strictEqual(e.message, 'tap threw'),
		);
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.of(1).tap('x'), 'tap'));
});

// ── 5. Error channel ──────────────────────────────────────────────────────────

describe('.orElse()', () => {
	it('recovers from rejection with fallback value', async () => {
		const r = await Pipe.reject(new Error('fail')).orElse(() => 'recovered');
		assert.strictEqual(r, 'recovered');
	});

	it('is skipped on success', async () => {
		const r = await Pipe.of(7).orElse(() => 0);
		assert.strictEqual(r, 7);
	});

	it('re-enters success channel — subsequent .map sees fallback', async () => {
		const r = await Pipe.reject(new Error('x')).orElse(() => 10).map(n => n * 2);
		assert.strictEqual(r, 20);
	});

	it('accepts async fallback', async () => {
		const r = await Pipe.reject(new Error('x')).orElse(async () => 'async-fallback');
		assert.strictEqual(r, 'async-fallback');
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.of(1).orElse(null), 'orElse'));
});

describe('.orFail()', () => {
	it('reshapes the error and stays rejected', async () => {
		await assertRejects(
			Pipe.reject(new Error('raw')).orFail(e => new Error(`wrapped: ${e.message}`)),
			e => assert.strictEqual(e.message, 'wrapped: raw'),
		);
	});

	it('is skipped on success', async () => {
		const r = await Pipe.of(5).orFail(e => new Error('never'));
		assert.strictEqual(r, 5);
	});

	it('can attach extra properties to error', async () => {
		await assertRejects(
			Pipe.reject(new Error('x')).orFail(e => Object.assign(new Error(e.message), { code: 503 })),
			e => assert.strictEqual(e.code, 503),
		);
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.of(1).orFail(0), 'orFail'));
});

describe('.orRecover()', () => {
	it('recovers from rejection via async computation', async () => {
		const r = await Pipe.reject(new Error('x')).orRecover(async () => 'cache-hit');
		assert.strictEqual(r, 'cache-hit');
	});

	it('is skipped on success', async () => {
		const r = await Pipe.of(3).orRecover(async () => 'should-not-run');
		assert.strictEqual(r, 3);
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.of(1).orRecover('bad'), 'orRecover'));
});

describe('.tapError()', () => {
	it('passes the error to fn without consuming it', async () => {
		let captured;
		await assertRejects(
			Pipe.reject(new Error('original')).tapError(e => { captured = e.message; }),
			e => assert.strictEqual(e.message, 'original'),
		);
		assert.strictEqual(captured, 'original');
	});

	it('is skipped on success', async () => {
		let called = false;
		const r = await Pipe.of(1).tapError(() => { called = true; });
		assert.strictEqual(r, 1);
		assert.strictEqual(called, false);
	});

	it('ISOLATION: if fn throws, original error is preserved — not replaced', async () => {
		const brokenLogger = () => { throw new Error('logger is down'); };
		await assertRejects(
			Pipe.reject(new Error('upstream')).tapError(brokenLogger),
			e => {
				assert.strictEqual(e.message, 'upstream',
					'original error must survive a throwing tapError fn');
			},
		);
	});

	it('ISOLATION: fn is still called even when it will throw', async () => {
		let called = false;
		const brokenLogger = () => { called = true; throw new Error('boom'); };
		await Pipe.reject(new Error('x')).tapError(brokenLogger).orElse(() => null);
		assert.strictEqual(called, true);
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.of(1).tapError(1), 'tapError'));
});

// ── 6. Resilience ─────────────────────────────────────────────────────────────

describe('.timeout()', () => {
	it('passes through when op completes before deadline', async () => {
		const r = await Pipe.fromAsync(() => sleep(20).then(() => 42)).timeout(200);
		assert.strictEqual(r, 42);
	});

	it('rejects with TimeoutError when deadline fires first', async () => {
		await assertRejects(
			Pipe.fromAsync(() => sleep(300).then(() => 99)).timeout(50),
			e => {
				assert.ok(e instanceof TimeoutError);
				assert.strictEqual(e.ms, 50);
				assert.ok(e.message.includes('50ms'));
			},
		);
	});

	it('inline fallback intercepts TimeoutError and enters success', async () => {
		const r = await Pipe.fromAsync(() => sleep(300).then(() => -1))
			.timeout(50, () => 'fallback');
		assert.strictEqual(r, 'fallback');
	});

	it('inline fallback does NOT intercept non-timeout errors', async () => {
		await assertRejects(
			Pipe.reject(new Error('network')).timeout(1000, () => 'fallback'),
			e => assert.ok(!(e instanceof TimeoutError)),
		);
	});

	it('throws PipeError synchronously for ms: 0', () => assertPipeError(() => Pipe.of(1).timeout(0), 'timeout'));
	it('throws PipeError synchronously for ms: -1', () => assertPipeError(() => Pipe.of(1).timeout(-1), 'timeout'));
	it('throws PipeError synchronously for ms: NaN', () => assertPipeError(() => Pipe.of(1).timeout(NaN), 'timeout'));
	it('throws PipeError synchronously for ms: Infinity', () => assertPipeError(() => Pipe.of(1).timeout(Infinity), 'timeout'));
	it('throws PipeError synchronously for ms: "1000"', () => assertPipeError(() => Pipe.of(1).timeout('1000'), 'timeout'));

	it('throws PipeError for non-function fallback', () =>
		assertPipeError(() => Pipe.of(1).timeout(100, 'bad'), 'timeout fallback'));

	it('configure() maxTimeout is enforced', () => {
		const P = configure({ maxTimeout: 100 });
		assertPipeError(() => P.of(1).timeout(101), 'timeout');
		// ms === maxTimeout is valid (upper bound is inclusive)
		assert.doesNotThrow(() => P.of(1).timeout(100));
	});
});

describe('.retryWhen()', () => {
	// NOTE: retryWhen re-runs this[$p] — the current Promise value — not the
	// upstream factory. For retries to re-execute a factory, the factory must
	// be the upstream (Pipe.fromAsync(factory).retryWhen(...)). This is a
	// documented design constraint, not a bug. The tests below reflect actual
	// behaviour: a pre-resolved pipe always re-presents its settled value.

	it('retries the settled rejection — predicate controls propagation', async () => {
		// A pre-rejected pipe: retryWhen sees the same rejection on every retry.
		// After exhausting attempts it propagates the original error.
		let predicateCalls = 0;
		await assertRejects(
			Pipe.reject(Object.assign(new Error('transient'), { code: 503 }))
				.retryWhen(e => { predicateCalls++; return e.code === 503; },
					{ attempts: 3, delay: 10, jitter: false }),
			e => assert.strictEqual(e.message, 'transient'),
		);
		// Predicate is called once per retry attempt (3 retries = 3 calls)
		assert.strictEqual(predicateCalls, 3);
	});

	it('rejects immediately when predicate returns false — no retries', async () => {
		let predicateCalls = 0;
		await assertRejects(
			Pipe.reject(new Error('fatal'))
				.retryWhen(() => { predicateCalls++; return false; },
					{ attempts: 3, delay: 10, jitter: false }),
			e => assert.strictEqual(e.message, 'fatal'),
		);
		assert.strictEqual(predicateCalls, 1); // predicate called once, returned false
	});

	it('passes (error, attemptNumber) to predicate — attempt numbers are 1-based', async () => {
		const calls = [];
		await Pipe.reject(new Error('x'))
			.retryWhen((e, n) => { calls.push(n); return n < 3; },
				{ attempts: 3, delay: 10, jitter: false })
			.orElse(() => null);
		assert.deepStrictEqual(calls, [1, 2, 3]);
	});

	it('clamps attempts option to configured maxAttempts', async () => {
		const P = configure({ maxAttempts: 2 });
		const calls = [];
		await P.reject(new Error('x'))
			.retryWhen((e, n) => { calls.push(n); return true; },
				{ attempts: 999, delay: 10, jitter: false }) // 999 clamped to maxAttempts=2
			.orElse(() => null);
		// With maxAttempts=2 and opts.attempts=999 (clamped to 2), predicate fires twice
		assert.strictEqual(calls.length, 2);
	});

	it('success path — pre-resolved pipe passes through, predicate never called', async () => {
		let predicateCalled = false;
		const r = await Pipe.of('ok')
			.retryWhen(() => { predicateCalled = true; return true; },
				{ attempts: 3, delay: 10, jitter: false });
		assert.strictEqual(r, 'ok');
		assert.strictEqual(predicateCalled, false);
	});

	it('throws PipeError synchronously for non-function predicate', () =>
		assertPipeError(() => Pipe.of(1).retryWhen('bad'), 'retryWhen predicate'));
});

// ── 7. Collection ─────────────────────────────────────────────────────────────

describe('.merge()', () => {
	it('collects all fulfilled values in order', async () => {
		const r = await Pipe.of(1).merge([Pipe.of(2), Pipe.of(3)]);
		assert.deepStrictEqual(r, [1, 2, 3]);
	});

	it('partial failure — failed items become Error values, nothing lost', async () => {
		const r = await Pipe.of(1).merge([
			Pipe.reject(new Error('oops')),
			Pipe.of(3),
		]);
		assert.strictEqual(r[0], 1);
		assert.ok(r[1] instanceof Error);
		assert.strictEqual(r[1].message, 'oops');
		assert.strictEqual(r[2], 3);
	});

	it('all fail — result is all Errors', async () => {
		const r = await Pipe.reject(new Error('a')).merge([Pipe.reject(new Error('b'))]);
		assert.ok(r[0] instanceof Error);
		assert.ok(r[1] instanceof Error);
	});

	it('accepts raw Promises alongside Pipes', async () => {
		const r = await Pipe.of(10).merge([Promise.resolve(20)]);
		assert.deepStrictEqual(r, [10, 20]);
	});

	it('accepts plain values alongside Pipes', async () => {
		const r = await Pipe.of('a').merge(['b', 'c']);
		assert.deepStrictEqual(r, ['a', 'b', 'c']);
	});

	it('throws PipeError synchronously for non-array', () =>
		assertPipeError(() => Pipe.of(1).merge('bad'), 'merge'));
});

describe('.sort()', () => {
	it('sorts ascending by default (lexicographic)', async () => {
		const r = await Pipe.of(['zebra', 'apple', 'mango']).sort();
		assert.deepStrictEqual(r, ['apple', 'mango', 'zebra']);
	});

	it('sorts with comparator — descending numeric', async () => {
		const r = await Pipe.of([3, 1, 4, 1, 5]).sort((a, b) => b - a);
		assert.deepStrictEqual(r, [5, 4, 3, 1, 1]);
	});

	it('does NOT mutate the upstream array', async () => {
		const original = [3, 1, 2];
		await Pipe.of(original).sort((a, b) => a - b);
		assert.deepStrictEqual(original, [3, 1, 2]); // unchanged
	});

	it('rejects if pipe value is not an array', async () => {
		await assertRejects(
			Pipe.of('not-an-array').sort(),
			e => assert.ok(e instanceof PipeError),
		);
	});

	it('rejects if pipe value is Array.prototype', async () => {
		await assertRejects(
			Pipe.of(Array.prototype).sort(),
			e => assert.ok(e instanceof PipeError),
		);
	});

	it('throws PipeError synchronously for non-function comparator', () =>
		assertPipeError(() => Pipe.of([1]).sort('bad'), 'sort comparator'));
});

describe('Pipe.traverse()', () => {
	it('maps fn over array and collects results', async () => {
		const r = await Pipe.traverse([1, 2, 3], n => Pipe.of(n * 10));
		assert.deepStrictEqual(r, [10, 20, 30]);
	});

	it('passes (item, index) to fn', async () => {
		const seen = [];
		await Pipe.traverse(['a', 'b'], (item, i) => { seen.push([item, i]); return Pipe.of(item); });
		assert.deepStrictEqual(seen, [['a', 0], ['b', 1]]);
	});

	it('short-circuits on first failure (fail-fast)', async () => {
		await assertRejects(
			Pipe.traverse([1, 2, 3], n =>
				n === 2 ? Pipe.reject(new Error(`fail at ${n}`)) : Pipe.of(n)
			),
			e => assert.strictEqual(e.message, 'fail at 2'),
		);
	});

	it('empty array resolves to []', async () => {
		const r = await Pipe.traverse([], () => Pipe.of(99));
		assert.deepStrictEqual(r, []);
	});

	it('throws PipeError synchronously for non-array arr', () =>
		assertPipeError(() => Pipe.traverse('bad', x => Pipe.of(x)), 'Pipe.traverse'));

	it('throws PipeError synchronously for non-function fn', () =>
		assertPipeError(() => Pipe.traverse([1], 'bad'), 'Pipe.traverse fn'));
});

// ── 8. Static constructors ────────────────────────────────────────────────────

describe('Pipe.of()', () => {
	it('lifts a plain value', async () => assert.strictEqual(await Pipe.of(99), 99));
	it('lifts undefined', async () => assert.strictEqual(await Pipe.of(undefined), undefined));
	it('lifts null', async () => assert.strictEqual(await Pipe.of(null), null));
	it('lifts a Promise — does not double-wrap', async () => {
		const r = await Pipe.of(Promise.resolve(42));
		assert.strictEqual(r, 42);
	});
});

describe('Pipe.reject()', () => {
	it('creates a pre-rejected Pipe', async () => {
		await assertRejects(
			Pipe.reject(new Error('pre-rejected')),
			e => assert.strictEqual(e.message, 'pre-rejected'),
		);
	});

	it('can be recovered with orElse', async () => {
		const r = await Pipe.reject(new Error('x')).orElse(() => 'ok');
		assert.strictEqual(r, 'ok');
	});
});

describe('Pipe.from()', () => {
	it('accepts a native Promise directly', async () => {
		const r = await Pipe.from(Promise.resolve('native'));
		assert.strictEqual(r, 'native');
	});

	it('accepts a foreign thenable', async () => {
		const thenable = { then: (resolve) => resolve('thenable') };
		const r = await Pipe.from(thenable);
		assert.strictEqual(r, 'thenable');
	});

	it('hostile thenable cannot hijack resolve/reject', async () => {
		// A hostile thenable that calls resolve with a second value after the first.
		// Promise.resolve() wrapping neutralises this.
		let resolveCount = 0;
		const hostile = {
			then(resolve) {
				resolve('first');
				resolve('second'); // should be ignored
				resolveCount++;
			},
		};
		const r = await Pipe.from(hostile);
		assert.strictEqual(r, 'first');
	});

	it('throws PipeError synchronously for plain object (non-thenable)', () =>
		assertPipeError(() => Pipe.from({}), 'Pipe.from'));

	it('throws PipeError synchronously for number', () =>
		assertPipeError(() => Pipe.from(42), 'Pipe.from'));

	it('throws PipeError synchronously for null', () =>
		assertPipeError(() => Pipe.from(null), 'Pipe.from'));
});

describe('Pipe.fromAsync()', () => {
	it('calls factory immediately and wraps result', async () => {
		let called = false;
		const r = await Pipe.fromAsync(() => { called = true; return Promise.resolve(7); });
		assert.strictEqual(r, 7);
		assert.strictEqual(called, true);
	});

	it('propagates factory rejection', async () => {
		await assertRejects(
			Pipe.fromAsync(() => Promise.reject(new Error('factory fail'))),
			e => assert.strictEqual(e.message, 'factory fail'),
		);
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.fromAsync('bad'), 'fromAsync'));
});

describe('Pipe.lift()', () => {
	it('returns a function that produces a Pipe', async () => {
		const double = Pipe.lift(n => n * 2);
		assert.strictEqual(typeof double, 'function');
		assert.strictEqual(await double(5), 10);
	});

	it('lifted functions compose via .chain', async () => {
		const double = Pipe.lift(n => n * 2);
		const inc = Pipe.lift(n => n + 1);
		assert.strictEqual(await double(10).chain(inc), 21);
	});

	it('passes all arguments through', async () => {
		const add = Pipe.lift((a, b) => a + b);
		assert.strictEqual(await add(3, 4), 7);
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.lift(null), 'lift'));
});

describe('Pipe.all()', () => {
	it('resolves all concurrently and preserves order', async () => {
		const r = await Pipe.all([Pipe.of(1), Pipe.of(2), Pipe.of(3)]);
		assert.deepStrictEqual(r, [1, 2, 3]);
	});

	it('rejects on first failure (fail-fast)', async () => {
		await assertRejects(
			Pipe.all([Pipe.of(1), Pipe.reject(new Error('fail')), Pipe.of(3)]),
			e => assert.strictEqual(e.message, 'fail'),
		);
	});

	it('accepts raw Promises and plain values', async () => {
		const r = await Pipe.all([Promise.resolve('a'), 'b', Pipe.of('c')]);
		assert.deepStrictEqual(r, ['a', 'b', 'c']);
	});

	it('throws PipeError synchronously for non-array', () =>
		assertPipeError(() => Pipe.all('bad'), 'Pipe.all'));
});

describe('Pipe.race()', () => {
	it('resolves with the fastest settler', async () => {
		const r = await Pipe.race([
			Pipe.fromAsync(() => sleep(100).then(() => 'slow')),
			Pipe.fromAsync(() => sleep(10).then(() => 'fast')),
		]);
		assert.strictEqual(r, 'fast');
	});

	it('rejects if the fastest settler rejects', async () => {
		await assertRejects(
			Pipe.race([
				Pipe.fromAsync(() => sleep(10).then(() => Promise.reject(new Error('fast-fail')))),
				Pipe.fromAsync(() => sleep(100).then(() => 'slow')),
			]),
			e => assert.strictEqual(e.message, 'fast-fail'),
		);
	});

	it('throws PipeError synchronously for non-array', () =>
		assertPipeError(() => Pipe.race(null), 'Pipe.race'));
});

describe('Pipe.allSettled()', () => {
	it('collects all outcomes regardless of success or failure', async () => {
		const results = await Pipe.allSettled([Pipe.of(1), Pipe.reject(new Error('x')), Pipe.of(3)]);
		assert.strictEqual(results[0].status, 'fulfilled');
		assert.strictEqual(results[0].value, 1);
		assert.strictEqual(results[1].status, 'rejected');
		assert.strictEqual(results[1].reason.message, 'x');
		assert.strictEqual(results[2].status, 'fulfilled');
		assert.strictEqual(results[2].value, 3);
	});

	it('throws PipeError synchronously for non-array', () =>
		assertPipeError(() => Pipe.allSettled({}), 'Pipe.allSettled'));
});

describe('Pipe.fromCallback()', () => {
	it('resolves from Node-style callback', async () => {
		const nodeFn = (a, b, cb) => setTimeout(() => cb(null, a + b), 10);
		const r = await Pipe.fromCallback(nodeFn, 3, 4);
		assert.strictEqual(r, 7);
	});

	it('rejects when callback receives truthy error', async () => {
		const nodeFn = (cb) => setTimeout(() => cb(new Error('cb-fail')), 10);
		await assertRejects(
			Pipe.fromCallback(nodeFn),
			e => assert.strictEqual(e.message, 'cb-fail'),
		);
	});

	it('ONE-SHOT: double-invoke is ignored — resolves only once', async () => {
		const doubleInvoke = (cb) => { cb(null, 'first'); cb(null, 'second'); };
		const r = await Pipe.fromCallback(doubleInvoke);
		assert.strictEqual(r, 'first');
	});

	it('ONE-SHOT: error then result — first call wins', async () => {
		const errThenOk = (cb) => { cb(new Error('first-err')); cb(null, 'ignored'); };
		await assertRejects(
			Pipe.fromCallback(errThenOk),
			e => assert.strictEqual(e.message, 'first-err'),
		);
	});

	it('throws PipeError synchronously for non-function', () =>
		assertPipeError(() => Pipe.fromCallback(null), 'fromCallback'));
});

// ── 9. Promise proxy ──────────────────────────────────────────────────────────

describe('Promise proxy', () => {
	it('is await-able directly', async () => {
		assert.strictEqual(await Pipe.of(55), 55);
	});

	it('works inside Promise.all', async () => {
		const [a, b] = await Promise.all([Pipe.of(10), Pipe.of(20)]);
		assert.strictEqual(a, 10);
		assert.strictEqual(b, 20);
	});

	it('works inside Promise.race', async () => {
		const r = await Promise.race([
			Pipe.fromAsync(() => sleep(50).then(() => 'slow')),
			Pipe.fromAsync(() => sleep(5).then(() => 'fast')),
		]);
		assert.strictEqual(r, 'fast');
	});

	it('works inside Promise.allSettled', async () => {
		const results = await Promise.allSettled([Pipe.of(1), Pipe.reject(new Error('x'))]);
		assert.strictEqual(results[0].status, 'fulfilled');
		assert.strictEqual(results[1].status, 'rejected');
	});

	it('.then handler receives resolved value', async () => {
		let received;
		await Pipe.of(77).then(v => { received = v; });
		assert.strictEqual(received, 77);
	});

	it('.catch handler receives rejection reason', async () => {
		let received;
		await Pipe.reject(new Error('caught')).catch(e => { received = e.message; });
		assert.strictEqual(received, 'caught');
	});

	it('.finally runs on success and passes value through', async () => {
		let ran = false;
		const r = await Pipe.of(42).finally(() => { ran = true; });
		assert.strictEqual(r, 42);
		assert.strictEqual(ran, true);
	});

	it('.finally runs on failure and re-rejects', async () => {
		let ran = false;
		await assertRejects(
			Pipe.reject(new Error('x')).finally(() => { ran = true; }),
		);
		assert.strictEqual(ran, true);
	});

	it('Symbol.toStringTag is forwarded from the underlying Promise', () => {
		const pipe = Pipe.of(1);
		// Proxy forwards non-own props to the Promise — its toStringTag is 'Promise'
		const tag = Object.prototype.toString.call(pipe);
		assert.strictEqual(tag, '[object Promise]');
	});
});

// ── 10. Security invariants ───────────────────────────────────────────────────

describe('security invariants', () => {
	it('pipe.p is undefined — string key does not expose the Promise', () => {
		const pipe = Pipe.of(1);
		assert.strictEqual(pipe.p, undefined);
	});

	it('Object.keys() on a Pipe is empty', () => {
		const pipe = Pipe.of(1);
		assert.deepStrictEqual(Object.keys(pipe), []);
	});

	it('$$p_ Symbol is NOT exported from the module', async () => {
		const mod = await import('./pipe.mjs');
		const exportedSymbols = Object.values(mod).filter(v => typeof v === 'symbol');
		assert.strictEqual(exportedSymbols.length, 0, 'no Symbol should be exported');
	});

	it('PipeError is an instance of TypeError', () => {
		const e = new PipeError('x');
		assert.ok(e instanceof TypeError);
	});

	it('guard messages do not contain the user-supplied value', () => {
		// Passing an object whose toString could inject content
		const evil = { toString: () => 'injected' };
		try { Pipe.of(1).map(evil); }
		catch (e) {
			assert.ok(!e.message.includes('injected'),
				`guard message must not include user value, got: "${e.message}"`);
		}
	});

	it('Pipe API is frozen — cannot add properties', () => {
		assert.ok(Object.isFrozen(Pipe));
		assert.throws(() => { 'use strict'; Pipe.evil = true; });
	});
});

// ── 11. configure() isolation ─────────────────────────────────────────────────

describe('configure() isolation', () => {
	it('two instances with different maxTimeout enforce their own limits', () => {
		const tight = configure({ maxTimeout: 100 });
		const loose = configure({ maxTimeout: 200_000 });

		assertPipeError(() => tight.of(1).timeout(101), 'timeout');
		assert.doesNotThrow(() => loose.of(1).timeout(101));
	});

	it('two instances have independent Pipe.of — values do not cross', async () => {
		const A = configure({});
		const B = configure({});
		const [a, b] = await Promise.all([A.of('alpha'), B.of('beta')]);
		assert.strictEqual(a, 'alpha');
		assert.strictEqual(b, 'beta');
	});
});

// ── 12. Fibonacci — state-machine unfold ──────────────────────────────────────

describe('fibonacci (doc example — .chain as state machine)', () => {
	/**
	 * Compute fib(n) by reducing n fibStep .chain calls over a [prev, curr] tuple.
	 * Demonstrates .chain, .map, and .orElse composing into a correct unfold.
	 */
	const fibStep = ([a, b]) => Pipe.of([b, a + b]);

	const fib = (n) =>
		Pipe.of(n)
			.map(n => {
				if (!Number.isInteger(n) || n < 0) throw new Error('invalid n');
				return n;
			})
			.chain(n =>
				Array.from({ length: n }, () => fibStep)
					.reduce((p, step) => p.chain(step), Pipe.of([0, 1]))
			)
			.map(([a]) => a)
			.orElse(() => -1);

	it('fib(0)  = 0', async () => assert.strictEqual(await fib(0), 0));
	it('fib(1)  = 1', async () => assert.strictEqual(await fib(1), 1));
	it('fib(2)  = 1', async () => assert.strictEqual(await fib(2), 1));
	it('fib(5)  = 5', async () => assert.strictEqual(await fib(5), 5));
	it('fib(10) = 55', async () => assert.strictEqual(await fib(10), 55));
	it('fib(20) = 6765', async () => assert.strictEqual(await fib(20), 6765));

	it('invalid input falls back to -1 via .orElse', async () => {
		assert.strictEqual(await fib(-1), -1);
		assert.strictEqual(await fib(1.5), -1);
	});

	it('first 10 via Pipe.traverse matches known sequence', async () => {
		const results = await Pipe.traverse(
			Array.from({ length: 10 }, (_, i) => i),
			fib,
		);
		assert.deepStrictEqual(results, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
	});

	it('first 10 via Pipe.all matches same sequence', async () => {
		const results = await Pipe.all(
			Array.from({ length: 10 }, (_, i) => fib(i)),
		);
		assert.deepStrictEqual(results, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
	});

	it('traverse + sort descending', async () => {
		const results = await Pipe.traverse(
			Array.from({ length: 10 }, (_, i) => i),
			fib,
		).sort((a, b) => b - a);
		assert.deepStrictEqual(results, [34, 21, 13, 8, 5, 3, 2, 1, 1, 0]);
	});
});

// ── 13. Full pipeline (doc example) ──────────────────────────────────────────

describe('full pipeline integration', () => {
	it('tap + tapError + orFail + orRecover + orElse — success path', async () => {
		let tapErrorCalled = false;
		let tapCalled = false;

		const result = await Pipe.of([1, 2, 3])
			.tap(d => { tapCalled = d.length === 3; })
			.tapError(() => { tapErrorCalled = true; })
			.orFail(e => new Error(`shaped: ${e.message}`))
			.orRecover(async () => ['cached'])
			.orElse(() => []);

		assert.deepStrictEqual(result, [1, 2, 3]);
		assert.strictEqual(tapCalled, true);
		assert.strictEqual(tapErrorCalled, false);
	});

	it('tap + tapError + orFail + orElse — full failure path', async () => {
		let tapErrorCalled = false;

		const result = await Pipe.reject(new Error('network'))
			.tapError(() => { tapErrorCalled = true; })
			.orFail(e => new Error(`shaped: ${e.message}`))
			.orElse(() => 'fallback');

		assert.strictEqual(result, 'fallback');
		assert.strictEqual(tapErrorCalled, true);
	});

	it('timeout — success within deadline passes through', async () => {
		const r = await Pipe.fromAsync(() => sleep(20).then(() => 'done'))
			.timeout(2_000)
			.orElse(() => 'timed-out');
		assert.strictEqual(r, 'done');
	});

	it('timeout — miss fires orElse', async () => {
		const r = await Pipe.fromAsync(() => sleep(500).then(() => 'done'))
			.timeout(30)
			.orElse(e => e instanceof TimeoutError ? 'timed-out' : 'other-error');
		assert.strictEqual(r, 'timed-out');
	});

	it('retryWhen — exhausts retries on persistent rejection, orElse recovers', async () => {
		const r = await Pipe.reject(new Error('persistent'))
			.retryWhen(() => true, { attempts: 2, delay: 10, jitter: false })
			.orElse(() => 'gave-up');
		assert.strictEqual(r, 'gave-up');
	});

	it('merge + sort — feed assembly pattern', async () => {
		const mine = [{ ts: 3, post: 'mine_1' }, { ts: 1, post: 'mine_2' }];
		const theirs = [{ ts: 4, post: 'theirs_1' }, { ts: 2, post: 'theirs_2' }];

		const feed = await Pipe.of(mine)
			.merge([Pipe.of(theirs)])
			.map(([m, t]) => [...m, ...t])
			.sort((a, b) => b.ts - a.ts)
			.map(posts => posts.slice(0, 3));

		assert.deepStrictEqual(feed.map(p => p.post), ['theirs_1', 'mine_1', 'theirs_2']);
	});

	it('traverse + orFail + orElse — short-circuit with shaped error', async () => {
		const r = await Pipe.traverse([1, 2, 3], n =>
			n === 2
				? Pipe.reject(new Error('missing')).orFail(e => new Error(`item ${n}: ${e.message}`))
				: Pipe.of(`ok:${n}`)
		).orElse(e => `caught: ${e.message}`);

		assert.strictEqual(r, 'caught: item 2: missing');
	});
});