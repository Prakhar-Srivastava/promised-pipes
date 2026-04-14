/**
 * v0.2 pool: bounded in-flight fromAsync tasks.
 * Run: node samples/06-concurrency-pool.mjs
 */
import { configure } from '../pipe.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Pipe = configure({ pool: { enabled: true, limit: 2 } });

let inFlight = 0;
let maxSeen = 0;

const task = () =>
	Pipe.fromAsync(async () => {
		inFlight++;
		maxSeen = Math.max(maxSeen, inFlight);
		await sleep(5);
		inFlight--;
		return 1;
	});

await Promise.all([task(), task(), task(), task()]);

if (maxSeen !== 2) {
	console.error('expected max in-flight 2', { maxSeen });
	process.exit(1);
}
console.log('ok', { maxSeen });
