import Pipe from '../pipe.mjs';
import { bench, section } from './lib/runner.mjs';

export const ITER = 20_000;
const BATCH_SIZE = 1_000;

export default async function run() {
	section('core');
	const arr = () => Array.from({ length: BATCH_SIZE }, (_, i) => i);

	await bench('Promise.then', async () => {
		let p = Promise.resolve(0);
		for (let i = 0; i < ITER; i++) p = p.then(x => x + 1);
		await p;
	});

	await bench('Pipe.map', async () => {
		let p = Pipe.of(0);
		for (let i = 0; i < ITER; i++) p = p.map(x => x + 1);
		await p;
	});

	await bench('async/await', async () => {
		let x = 0;
		for (let i = 0; i < ITER; i++) x = await Promise.resolve(x + 1);
		return x;
	});

	await bench('Pipe.chain', async () => {
		let p = Pipe.of(0);
		for (let i = 0; i < ITER; i++) p = p.chain(x => x + 1);
		await p;
	});

	await bench('Promise.all', async () => {
		await Promise.all(arr().map(x => Promise.resolve(x * 2)));
	});

	await bench('Pipe.all', async () => {
		await Pipe.all(arr().map(x => Pipe.of(x * 2)));
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run();
}