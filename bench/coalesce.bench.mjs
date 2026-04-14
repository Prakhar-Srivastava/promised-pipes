import { configure } from '../pipe.mjs';
import { bench, section } from './lib/runner.mjs';

const ITER = 1_500;
const CoalescedPipe = configure({ coalesce: { enabled: true, ttl: 0 } });
const PlainPipe = configure({});

const makeWork = () => new Promise(resolve => setTimeout(() => resolve(42), 2));

export default async function run() {
	section('coalescing');

	await bench('Pipe no coalescing', async () => {
		for (let i = 0; i < ITER; i++) {
			await Promise.all([
				PlainPipe.fromAsync(makeWork),
				PlainPipe.fromAsync(makeWork),
				PlainPipe.fromAsync(makeWork),
			]);
		}
	});

	await bench('Pipe coalescing by key', async () => {
		for (let i = 0; i < ITER; i++) {
			await Promise.all([
				CoalescedPipe.fromAsync(makeWork, { key: `item-${i}` }),
				CoalescedPipe.fromAsync(makeWork, { key: `item-${i}` }),
				CoalescedPipe.fromAsync(makeWork, { key: `item-${i}` }),
			]);
		}
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run();
}
