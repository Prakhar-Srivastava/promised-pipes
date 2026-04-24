import Pipe, { configure, AbortError } from '../../pipe.mjs';

const ShowcasePipe = configure({
	abort: { enabled: true },
	coalesce: { enabled: true, ttl: 0 },
	maxAttempts: 6,
	maxDelay: 0,
});
const ShowcaseCoalesceTtlPipe = configure({
	coalesce: { enabled: true, ttl: 50, shareErrors: true },
});
const ShowcaseCoalesceNoSharePipe = configure({
	coalesce: { enabled: true, ttl: 50, shareErrors: false },
});
const ShowcasePoolPipe = configure({
	pool: { enabled: true, limit: 4, maxQueue: 1000 },
});

const TRANSFORM_ITER = 14_000;
const RETRY_ITER = 2_000;
const TIMEOUT_ITER = 1_800;
const FANOUT_ITER = 2_000;
const ABORT_ITER = 4_000;
const COALESCE_ITER = 1_700;
const COALESCE_TTL_ITER = 700;
const POOL_ITER = 700;
const FLOW_TIMEOUT_MS = 500;
const SLOW_TIMEOUT_MS = 3;

const withTimeout = (promise, ms, fallback) => Promise.race([
	promise,
	new Promise((_, reject) => {
		setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms);
	}),
]).catch(err => err?.code === 'ETIMEDOUT' && typeof fallback === 'function' ? fallback(err) : Promise.reject(err));

const manualCoalesce = (cache, key, load) => {
	if (cache.has(key)) return cache.get(key);
	const pending = load().finally(() => {
		cache.delete(key);
	});
	cache.set(key, pending);
	return pending;
};

const manualCoalesceWithTtl = (cache, key, ttl, load) => {
	const now = Date.now();
	const current = cache.get(key);
	if (current && current.expiresAt > now) return current.promise;
	const promise = Promise.resolve().then(load);
	cache.set(key, {
		promise,
		expiresAt: now + ttl,
	});
	return promise;
};

const withManualPool = async (tasks, limit) => {
	let active = 0;
	const queue = [...tasks];
	const results = [];
	const workers = Array.from({ length: limit }, async () => {
		while (queue.length > 0) {
			const task = queue.shift();
			if (!task) continue;
			active++;
			results.push(await task());
			active--;
		}
	});
	await Promise.all(workers);
	if (active !== 0) throw new Error('manual pool active count mismatch');
	return results;
};

const withManualAbortSignal = (signal, work) => new Promise((resolve, reject) => {
	if (signal?.aborted) {
		reject(new Error(signal.reason || 'aborted'));
		return;
	}
	const onAbort = () => reject(new Error(signal.reason || 'aborted'));
	signal?.addEventListener('abort', onAbort, { once: true });
	Promise.resolve()
		.then(work)
		.then(resolve, reject)
		.finally(() => signal?.removeEventListener('abort', onAbort));
});

const verifyContracts = async () => {
	const retryManual = async () => {
		let step = 0;
		const fetchLike = () => Promise.resolve().then(() => {
			if (step < 2) {
				step++;
				throw Object.assign(new Error('retry'), { status: 503 });
			}
			return 42;
		});
		let attempt = 0;
		while (attempt < 4) {
			try {
				return await fetchLike();
			} catch (err) {
				if (err?.status !== 503 || attempt === 3) throw err;
				attempt++;
			}
		}
		throw new Error('manual contract failed');
	};
	const retryPipe = () => {
		let step = 0;
		const fetchLike = () => Promise.resolve().then(() => {
			if (step < 2) {
				step++;
				throw Object.assign(new Error('retry'), { status: 503 });
			}
			return 42;
		});
		return Pipe.fromAsync(fetchLike)
			.retryWhen(err => err.status === 503, { attempts: 4, delay: 0, jitter: false });
	};
	const [manualResult, pipeResult] = await Promise.all([retryManual(), retryPipe()]);
	if (manualResult !== pipeResult) throw new Error('retry contract mismatch');
};

export default async function run(runner) {
	const { bench, section } = runner;
	section('showcase');
	await verifyContracts();

	await bench('transform chain manual Promise', async () => {
		for (let i = 0; i < TRANSFORM_ITER; i++) {
			await Promise.resolve(i)
				.then(v => v + 1)
				.then(v => v * 2)
				.then(v => `${v}:ok`);
		}
	}, { operations: TRANSFORM_ITER, category: 'cpuBound', tags: ['transform'] });

	await bench('transform chain promised-pipes', async () => {
		for (let i = 0; i < TRANSFORM_ITER; i++) {
			await Pipe.of(i)
				.map(v => v + 1)
				.map(v => v * 2)
				.map(v => `${v}:ok`);
		}
	}, { operations: TRANSFORM_ITER, category: 'cpuBound', tags: ['transform'] });

	await bench('retry only manual Promise', async () => {
		for (let i = 0; i < RETRY_ITER; i++) {
			let step = 0;
			const fetchLike = () => Promise.resolve().then(() => {
				if (step < 2) {
					step++;
					throw Object.assign(new Error('retry'), { status: 503 });
				}
				return 42;
			});
			let attempt = 0;
			let value = null;
			while (attempt < 4) {
				try {
					value = await fetchLike();
					break;
				} catch (err) {
					if (err?.status !== 503 || attempt === 3) throw err;
					attempt++;
				}
			}
			if (value === null) throw new Error('unexpected null');
		}
	}, { operations: RETRY_ITER, category: 'timerSensitive', tags: ['retry-only', 'manual'] });

	await bench('retry only promised-pipes', async () => {
		for (let i = 0; i < RETRY_ITER; i++) {
			let step = 0;
			const fetchLike = () => Promise.resolve().then(() => {
				if (step < 2) {
					step++;
					throw Object.assign(new Error('retry'), { status: 503 });
				}
				return 42;
			});
			const value = await Pipe.fromAsync(fetchLike)
				.retryWhen(err => err.status === 503, { attempts: 4, delay: 0, jitter: false });
			if (value !== 42) throw new Error('unexpected value');
		}
	}, { operations: RETRY_ITER, category: 'timerSensitive', tags: ['retry-only', 'pipe'] });

	await bench('timeout only manual Promise', async () => {
		for (let i = 0; i < TIMEOUT_ITER; i++) {
			const value = await withTimeout(
				new Promise(resolve => setTimeout(() => resolve(i), 1)),
				SLOW_TIMEOUT_MS,
				() => -1,
			);
			if (typeof value !== 'number') throw new Error('timeout manual contract failed');
		}
	}, { operations: TIMEOUT_ITER, category: 'timerSensitive', tags: ['timeout-only', 'manual'] });

	await bench('timeout only promised-pipes', async () => {
		for (let i = 0; i < TIMEOUT_ITER; i++) {
			const value = await Pipe.fromAsync(() => new Promise(resolve => setTimeout(() => resolve(i), 1)))
				.timeout(SLOW_TIMEOUT_MS, () => -1);
			if (typeof value !== 'number') throw new Error('timeout pipe contract failed');
		}
	}, { operations: TIMEOUT_ITER, category: 'timerSensitive', tags: ['timeout-only', 'pipe'] });

	await bench('retry+timeout manual Promise', async () => {
		for (let i = 0; i < RETRY_ITER; i++) {
			let step = 0;
			const fetchLike = () => Promise.resolve().then(() => {
				if (step < 2) {
					step++;
					throw Object.assign(new Error('retry'), { status: 503 });
				}
				return 42;
			});
			let attempt = 0;
			let value = null;
			while (attempt < 4) {
				try {
					value = await withTimeout(fetchLike(), FLOW_TIMEOUT_MS);
					break;
				} catch (err) {
					if (err?.code === 'ETIMEDOUT') throw err;
					if (err?.status !== 503 || attempt === 3) throw err;
					attempt++;
				}
			}
			if (value === null) throw new Error('unexpected null');
		}
	}, { operations: RETRY_ITER, category: 'timerSensitive', tags: ['retry+timeout', 'manual'] });

	await bench('retry+timeout promised-pipes', async () => {
		for (let i = 0; i < RETRY_ITER; i++) {
			let step = 0;
			const fetchLike = () => Promise.resolve().then(() => {
				if (step < 2) {
					step++;
					throw Object.assign(new Error('retry'), { status: 503 });
				}
				return 42;
			});
			const value = await Pipe.fromAsync(fetchLike)
				.retryWhen(err => err.status === 503, { attempts: 4, delay: 0, jitter: false })
				.timeout(FLOW_TIMEOUT_MS);
			if (value !== 42) throw new Error('unexpected value');
		}
	}, { operations: RETRY_ITER, category: 'timerSensitive', tags: ['retry+timeout', 'pipe'] });

	await bench('fan-out aggregation Promise.all', async () => {
		for (let i = 0; i < FANOUT_ITER; i++) {
			await Promise.all(
				Array.from({ length: 10 }, (_, idx) => Promise.resolve(i + idx)),
			);
		}
	}, { operations: FANOUT_ITER * 10, category: 'cpuBound', tags: ['fan-out', 'manual'] });

	await bench('fan-out aggregation Pipe.all', async () => {
		for (let i = 0; i < FANOUT_ITER; i++) {
			await Pipe.all(
				Array.from({ length: 10 }, (_, idx) => Pipe.of(i + idx)),
			);
		}
	}, { operations: FANOUT_ITER * 10, category: 'cpuBound', tags: ['fan-out', 'pipe'] });

	await bench('abort-aware manual Promise', async () => {
		for (let i = 0; i < ABORT_ITER; i++) {
			const ctrl = new AbortController();
			ctrl.abort('stop');
			await withManualAbortSignal(ctrl.signal, () => Promise.resolve(1)).catch(() => null);
		}
	}, { operations: ABORT_ITER, category: 'featureSemantics', tags: ['abort', 'manual-equivalent'] });

	await bench('abort-aware promised-pipes', async () => {
		for (let i = 0; i < ABORT_ITER; i++) {
			const ctrl = new AbortController();
			ctrl.abort('stop');
			await ShowcasePipe.fromAsync(() => Promise.resolve(1), { signal: ctrl.signal })
				.orElse(err => err instanceof AbortError ? null : Promise.reject(err));
		}
	}, { operations: ABORT_ITER, category: 'featureSemantics', tags: ['abort', 'pipe'] });

	await bench('coalescing manual dedupe', async () => {
		const inflight = new Map();
		for (let i = 0; i < COALESCE_ITER; i++) {
			const key = `item-${i}`;
			let sourceCalls = 0;
			const load = () => Promise.resolve().then(() => {
				sourceCalls++;
				return 7;
			});
			await Promise.all([
				manualCoalesce(inflight, key, load),
				manualCoalesce(inflight, key, load),
				manualCoalesce(inflight, key, load),
			]);
			if (sourceCalls !== 1) throw new Error('manual dedupe broken');
		}
	}, { operations: COALESCE_ITER * 3, category: 'featureSemantics', tags: ['coalesce', 'manual'] });

	await bench('coalescing promised-pipes', async () => {
		for (let i = 0; i < COALESCE_ITER; i++) {
			const key = `item-${i}`;
			let sourceCalls = 0;
			const load = () => Promise.resolve().then(() => {
				sourceCalls++;
				return 7;
			});
			await Promise.all([
				ShowcasePipe.fromAsync(load, { key }),
				ShowcasePipe.fromAsync(load, { key }),
				ShowcasePipe.fromAsync(load, { key }),
			]);
			if (sourceCalls !== 1) throw new Error('pipe coalescing broken');
		}
	}, { operations: COALESCE_ITER * 3, category: 'featureSemantics', tags: ['coalesce', 'pipe'] });

	await bench('coalescing settled reuse ttl>0 manual', async () => {
		const cache = new Map();
		for (let i = 0; i < COALESCE_TTL_ITER; i++) {
			const key = `ttl-${i}`;
			let sourceCalls = 0;
			const load = () => Promise.resolve().then(() => {
				sourceCalls++;
				return 8;
			});
			const first = await manualCoalesceWithTtl(cache, key, 50, load);
			const second = await manualCoalesceWithTtl(cache, key, 50, load);
			if (first !== second || sourceCalls !== 1) throw new Error('manual ttl coalesce broken');
		}
	}, { operations: COALESCE_TTL_ITER * 2, category: 'featureSemantics', tags: ['coalesce', 'ttl', 'manual'] });

	await bench('coalescing settled reuse ttl>0 promised-pipes', async () => {
		for (let i = 0; i < COALESCE_TTL_ITER; i++) {
			const key = `ttl-${i}`;
			const load = () => Promise.resolve(8);
			const first = await ShowcaseCoalesceTtlPipe.fromAsync(load, { key });
			const second = await ShowcaseCoalesceTtlPipe.fromAsync(load, { key });
			if (first !== second) throw new Error('pipe ttl coalesce value mismatch');
		}
	}, { operations: COALESCE_TTL_ITER * 2, category: 'featureSemantics', tags: ['coalesce', 'ttl', 'pipe'] });

	await bench('coalescing shareErrors=false manual', async () => {
		for (let i = 0; i < COALESCE_TTL_ITER; i++) {
			const cache = new Map();
			let calls = 0;
			const rejectLoad = () => Promise.resolve().then(() => {
				calls++;
				throw new Error('boom');
			});
			await manualCoalesce(cache, `err-${i}`, rejectLoad).catch(() => null);
			await manualCoalesce(cache, `err-${i}`, rejectLoad).catch(() => null);
			if (calls !== 2) throw new Error('manual shareErrors=false mismatch');
		}
	}, { operations: COALESCE_TTL_ITER * 2, category: 'featureSemantics', tags: ['coalesce', 'shareErrors=false', 'manual'] });

	await bench('coalescing shareErrors=false promised-pipes', async () => {
		for (let i = 0; i < COALESCE_TTL_ITER; i++) {
			let calls = 0;
			const rejectLoad = () => Promise.resolve().then(() => {
				calls++;
				throw new Error('boom');
			});
			await ShowcaseCoalesceNoSharePipe.fromAsync(rejectLoad, { key: `err-${i}` }).orElse(() => null);
			await ShowcaseCoalesceNoSharePipe.fromAsync(rejectLoad, { key: `err-${i}` }).orElse(() => null);
			if (calls !== 2) throw new Error('pipe shareErrors=false mismatch');
		}
	}, { operations: COALESCE_TTL_ITER * 2, category: 'featureSemantics', tags: ['coalesce', 'shareErrors=false', 'pipe'] });

	await bench('pool manual limiter', async () => {
		const tasks = Array.from(
			{ length: POOL_ITER },
			(_, i) => () => Promise.resolve(i + 1),
		);
		await withManualPool(tasks, 4);
	}, { operations: POOL_ITER, category: 'featureSemantics', tags: ['pool', 'manual'] });

	await bench('pool promised-pipes limiter', async () => {
		await Promise.all(Array.from(
			{ length: POOL_ITER },
			(_, i) => ShowcasePoolPipe.fromAsync(() => Promise.resolve(i + 1)),
		));
	}, { operations: POOL_ITER, category: 'featureSemantics', tags: ['pool', 'pipe'] });
}
