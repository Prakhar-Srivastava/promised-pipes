import assert from 'node:assert/strict';
import { configure } from '../../pipe.mjs';

const RETRY_ITER = 2_500;
const POOL_TASKS = 40;
const COALESCE_ITER = 1_800;
const COALESCE_TTL_ITER = 700;
const RETRY_DELAYED_ITER = 500;

const RetryPipe = configure({ maxAttempts: 8, maxDelay: 0 });
const RetryPipeDelayed = configure({ maxAttempts: 8, maxDelay: 4 });
const PooledPipe = configure({ pool: { enabled: true, limit: 4, maxQueue: 128 } });
const CoalescePipeInFlight = configure({ coalesce: { enabled: true, ttl: 0, shareErrors: true } });
const CoalescePipeTtl = configure({ coalesce: { enabled: true, ttl: 3, shareErrors: true } });
const CoalescePipeNoShareErrors = configure({ coalesce: { enabled: true, ttl: 3, shareErrors: false } });
const PooledPipeTinyQueue = configure({ pool: { enabled: true, limit: 1, maxQueue: 2 } });

const verifyContracts = async () => {
	let attempts = 0;
	const result = await RetryPipe.fromAsync(() => {
		if (attempts < 2) {
			attempts++;
			return Promise.reject(new Error('retry'));
		}
		return Promise.resolve(7);
	}).retryWhen(() => true, { attempts: 3, delay: 0, jitter: false });
	assert.equal(result, 7);
	assert.equal(attempts, 2);

	const ttlKey = 'ttl-contract';
	let ttlCalls = 0;
	const ttlWork = () => Promise.resolve(++ttlCalls);
	const first = await CoalescePipeTtl.fromAsync(ttlWork, { key: ttlKey });
	const second = await CoalescePipeTtl.fromAsync(ttlWork, { key: ttlKey });
	assert.equal(first, second);
};

export default async function run(runner) {
	const { bench, section } = runner;
	section('ci:execution');
	await verifyContracts();

	await bench('retryWhen deterministic delay=0', async () => {
		let total = 0;
		for (let i = 0; i < RETRY_ITER; i++) {
			let attempts = 0;
			const value = await RetryPipe.fromAsync(() => {
				if (attempts < 2) {
					attempts++;
					return Promise.reject(new Error('retry'));
				}
				return Promise.resolve(i + 1);
			}).retryWhen(() => true, { attempts: 3, delay: 0, jitter: false });
			total += value;
		}
		return total;
	}, { operations: RETRY_ITER, category: 'timerSensitive', tags: ['retry', 'delay=0'] });

	await bench('pool queue pressure', async () => {
		await Promise.all(Array.from(
			{ length: POOL_TASKS },
			(_, i) => PooledPipe.fromAsync(() => Promise.resolve(i + 1)),
		));
	}, { operations: POOL_TASKS, category: 'timerSensitive', tags: ['pool', 'queue-pressure'] });

	await bench('pool queue overflow behavior', async () => {
		await Promise.allSettled(Array.from(
			{ length: 6 },
			(_, i) => PooledPipeTinyQueue.fromAsync(
				() => new Promise(resolve => setTimeout(() => resolve(i + 1), 1)),
			),
		));
	}, { operations: 6, category: 'featureSemantics', tags: ['pool', 'overflow'] });

	await bench('coalesce in-flight dedupe ttl=0', async () => {
		let sourceCalls = 0;
		for (let i = 0; i < COALESCE_ITER; i++) {
			const key = `same-${i}`;
			const work = () => Promise.resolve().then(() => {
				sourceCalls++;
				return key;
			});
			await Promise.all([
				CoalescePipeInFlight.fromAsync(work, { key }),
				CoalescePipeInFlight.fromAsync(work, { key }),
				CoalescePipeInFlight.fromAsync(work, { key }),
			]);
		}
		return sourceCalls;
	}, { operations: COALESCE_ITER * 3, category: 'featureSemantics', tags: ['coalesce', 'in-flight'] });

	await bench('coalesce settled reuse ttl>0', async () => {
		let sourceCalls = 0;
		for (let i = 0; i < COALESCE_TTL_ITER; i++) {
			const key = `ttl-${i}`;
			const work = () => Promise.resolve(++sourceCalls);
			const first = await CoalescePipeTtl.fromAsync(work, { key });
			const second = await CoalescePipeTtl.fromAsync(work, { key });
			if (first !== second) throw new Error('ttl reuse behavior failed');
		}
		return sourceCalls;
	}, { operations: COALESCE_TTL_ITER * 2, category: 'featureSemantics', tags: ['coalesce', 'ttl'] });

	await bench('coalesce shareErrors=false', async () => {
		for (let i = 0; i < COALESCE_TTL_ITER; i++) {
			const key = `error-${i}`;
			let calls = 0;
			const rejectWork = () => Promise.resolve().then(() => {
				calls++;
				throw new Error('boom');
			});
			await CoalescePipeNoShareErrors.fromAsync(rejectWork, { key }).orElse(() => null);
			await CoalescePipeNoShareErrors.fromAsync(rejectWork, { key }).orElse(() => null);
			if (calls !== 2) throw new Error('shareErrors=false behavior failed');
		}
	}, { operations: COALESCE_TTL_ITER * 2, category: 'featureSemantics', tags: ['coalesce', 'shareErrors=false'] });

	await bench('coalesce ttl expiry immediate', async () => {
		let sourceCalls = 0;
		const key = 'ttl-expiry';
		const work = () => Promise.resolve(++sourceCalls);
		const first = await CoalescePipeInFlight.fromAsync(work, { key });
		const second = await CoalescePipeInFlight.fromAsync(work, { key });
		if (first === second || sourceCalls !== 2) throw new Error('ttl immediate expiry behavior failed');
	}, { operations: 2, category: 'timerSensitive', tags: ['coalesce', 'ttl=0'] });

	await bench('retryWhen deterministic delay=2ms', async () => {
		let total = 0;
		for (let i = 0; i < RETRY_DELAYED_ITER; i++) {
			let attempts = 0;
			const value = await RetryPipeDelayed.fromAsync(() => {
				if (attempts < 2) {
					attempts++;
					return Promise.reject(new Error('retry'));
				}
				return Promise.resolve(i + 1);
			}).retryWhen(() => true, { attempts: 3, delay: 2, jitter: false });
			total += value;
		}
		return total;
	}, { operations: RETRY_DELAYED_ITER, category: 'timerSensitive', tags: ['retry', 'delay=2ms', 'informational'] });
}
