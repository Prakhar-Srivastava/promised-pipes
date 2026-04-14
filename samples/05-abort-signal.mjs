/**
 * v0.2 abort: fromAsync with AbortSignal; pre-aborted rejects with AbortError.
 * Run: node samples/05-abort-signal.mjs
 */
import { configure, AbortError } from '../pipe.mjs';

const Pipe = configure({ abort: { enabled: true } });

const ctrl = new AbortController();
ctrl.abort('user-cancel');

try {
	await Pipe.fromAsync(async () => 'never', { signal: ctrl.signal });
	console.error('expected rejection');
	process.exit(1);
} catch (e) {
	if (!(e instanceof AbortError) || e.reason !== 'user-cancel') {
		console.error('unexpected error', e);
		process.exit(1);
	}
}

const live = new AbortController();
const result = await Pipe.fromAsync(
	async (signal) => (signal === live.signal ? 'bound' : 'wrong'),
	{ signal: live.signal },
);
if (result !== 'bound') {
	console.error('unexpected', result);
	process.exit(1);
}
console.log('ok');
