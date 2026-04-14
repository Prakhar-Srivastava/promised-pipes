import { configure } from '../pipe.mjs';
import { bench, section } from './lib/runner.mjs';

const ITER = 3_000;
const AbortPipe = configure({ abort: { enabled: true } });
const BasePipe = configure({});

export default async function run() {
	section('abort');

	await bench('manual abort race', async () => {
		for (let i = 0; i < ITER; i++) {
			const ctrl = new AbortController();
			ctrl.abort('bench');
			await Promise.race([
				Promise.resolve().then(() => 1),
				new Promise((_, reject) => reject(new Error(ctrl.signal.reason))),
			]).catch(() => null);
		}
	});

	await bench('pipe abort enabled', async () => {
		for (let i = 0; i < ITER; i++) {
			const ctrl = new AbortController();
			ctrl.abort('bench');
			await AbortPipe.fromAsync(() => Promise.resolve(1), { signal: ctrl.signal })
				.orElse(() => null);
		}
	});

	await bench('pipe baseline (no abort)', async () => {
		for (let i = 0; i < ITER; i++) {
			await BasePipe.fromAsync(() => Promise.resolve(1));
		}
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run();
}
