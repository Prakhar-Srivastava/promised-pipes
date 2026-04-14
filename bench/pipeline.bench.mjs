import { configure } from '../pipe.mjs';
import { bench, section } from './lib/runner.mjs';

const ITER = 5_000;
const tries = 5;
const Pipe = configure({ maxAttempts: tries, maxDelay: 0 });

const fakeFetch = () =>
	new Promise((resolve, reject) => {
		if (10 * Math.random() < 10 * Math.random()) reject(new Error('transient'));
		else resolve(10.0 * Math.random());
	});

export default async function run() {
	section('pipeline');

	await bench('Manual retry', async () => {
		let nulls = 0;
		for (let i = 0; i < ITER; i++) {
			let attempts = 0;
			let value = null;
			while (attempts < tries) {
				try {
					value = await fakeFetch();
					break;
				} catch {
					attempts++;
				}
			}
			nulls += value === null ? 1 : 0;
		}
		return nulls;
	});

	await bench('Pipe retryWhen', async () => {
		let nulls = 0;
		for (let i = 0; i < ITER; i++) {
			const value = await Pipe.fromAsync(fakeFetch)
				.retryWhen(() => true, { attempts: tries - 1, delay: 0, jitter: false })
				.orElse(() => null);
			nulls += value === null ? 1 : 0;
		}
		return nulls;
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run();
}