/**
 * v0.2 coalesce: same key shares one in-flight promise.
 * Run: node samples/07-coalesce-by-key.mjs
 */
import { configure } from '../pipe.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Pipe = configure({ coalesce: { enabled: true } });

let calls = 0;
const work = () =>
	Pipe.fromAsync(async () => {
		calls++;
		await sleep(8);
		return 'one-shot';
	}, { key: 'shared-key' });

const [a, b, c] = await Promise.all([work(), work(), work()]);
if (a !== 'one-shot' || b !== 'one-shot' || c !== 'one-shot' || calls !== 1) {
	console.error('unexpected', { a, b, c, calls });
	process.exit(1);
}
console.log('ok', { calls });
