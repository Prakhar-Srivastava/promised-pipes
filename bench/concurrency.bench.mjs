import { configure } from '../pipe.mjs';
import { bench, section } from './lib/runner.mjs';

const TASKS = 200;
const DELAY = 3;
const PooledPipe = configure({ pool: { enabled: true, limit: 8 } });

const task = () => new Promise(resolve => setTimeout(resolve, DELAY));

export default async function run() {
	section('concurrency');

	await bench('Promise.all unbounded', async () => {
		await Promise.all(Array.from({ length: TASKS }, () => task()));
	});

	await bench('Pipe pooled(limit=8)', async () => {
		await Promise.all(Array.from(
			{ length: TASKS },
			() => PooledPipe.fromAsync(task),
		));
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run();
}
