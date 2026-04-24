import assert from 'node:assert/strict';
import Pipe, { TimeoutError } from '../../pipe.mjs';

const CHAIN_ITER = 12_000;
const ERROR_ITER = 6_000;
const TIMEOUT_OK_ITER = 2_000;
const TIMEOUT_ERR_ITER = 180;
const CALLBACK_ITER = 4_000;
const TRAVERSE_SIZE = 48;

const verifyContracts = async () => {
	const recovered = await Pipe.reject(new Error('x')).orElse(() => 1);
	assert.equal(recovered, 1);

	const reshaped = await Pipe.reject(new Error('old'))
		.orFail(err => new Error(`new:${err.message}`))
		.orElse(err => err.message);
	assert.equal(reshaped, 'new:old');

	const timeoutFallback = await Pipe.fromAsync(() => new Promise(() => {}))
		.timeout(1, () => 'fallback');
	assert.equal(timeoutFallback, 'fallback');
};

export default async function run(runner) {
	const { bench, section } = runner;
	section('ci:core');
	await verifyContracts();

	await bench('map chain depth', async () => {
		let pipe = Pipe.of(0);
		for (let i = 0; i < CHAIN_ITER; i++) {
			pipe = pipe.map(v => v + 1);
		}
		await pipe;
	}, { operations: CHAIN_ITER, category: 'cpuBound', tags: ['core', 'map'] });

	await bench('chain depth', async () => {
		let pipe = Pipe.of(0);
		for (let i = 0; i < CHAIN_ITER; i++) {
			pipe = pipe.chain(v => v + 1);
		}
		await pipe;
	}, { operations: CHAIN_ITER, category: 'cpuBound', tags: ['core', 'chain'] });

	await bench('error channel orElse', async () => {
		for (let i = 0; i < ERROR_ITER; i++) {
			await Pipe.reject(new Error('boom')).orElse(() => i);
		}
	}, { operations: ERROR_ITER, category: 'featureSemantics', tags: ['error-channel'] });

	await bench('error channel orFail', async () => {
		for (let i = 0; i < ERROR_ITER; i++) {
			await Pipe.reject(new Error('boom'))
				.orFail(err => new Error(`${err.message}:${i}`))
				.orElse(() => null);
		}
	}, { operations: ERROR_ITER, category: 'featureSemantics', tags: ['error-channel'] });

	await bench('error channel tapError isolated', async () => {
		for (let i = 0; i < ERROR_ITER; i++) {
			await Pipe.reject(new Error('original'))
				.tapError(() => {
					throw new Error('logger failed');
				})
				.orElse(err => err.message);
		}
	}, { operations: ERROR_ITER, category: 'featureSemantics', tags: ['error-channel', 'isolation'] });

	await bench('timeout success path', async () => {
		for (let i = 0; i < TIMEOUT_OK_ITER; i++) {
			await Pipe.of(i).timeout(25);
		}
	}, { operations: TIMEOUT_OK_ITER, category: 'timerSensitive', tags: ['timeout', 'success-path'] });

	await bench('timeout error path', async () => {
		for (let i = 0; i < TIMEOUT_ERR_ITER; i++) {
			await Pipe.fromAsync(() => new Promise(() => {}))
				.timeout(1)
				.orElse(err => err instanceof TimeoutError ? null : Promise.reject(err));
		}
	}, { operations: TIMEOUT_ERR_ITER, category: 'timerSensitive', tags: ['timeout', 'error-path'] });

	await bench('fromCallback bridge', async () => {
		for (let i = 0; i < CALLBACK_ITER; i++) {
			await Pipe.fromCallback((v, done) => done(null, v + 1), i);
		}
	}, { operations: CALLBACK_ITER, category: 'featureSemantics', tags: ['callback-bridge'] });

	await bench('traverse array', async () => {
		await Pipe.traverse(
			Array.from({ length: TRAVERSE_SIZE }, (_, idx) => idx),
			(v) => Pipe.of(v + 2),
		);
	}, { operations: TRAVERSE_SIZE, category: 'featureSemantics', tags: ['traverse'] });

	await bench('race first result', async () => {
		await Pipe.race([Pipe.of(1), Pipe.of(2), Pipe.of(3)]);
	}, { operations: 3, category: 'timerSensitive', tags: ['race'] });
}
