/**
 * Retry: factory must be upstream to `retryWhen` so each attempt re-runs work.
 * Run: node samples/03-retry-factory.mjs
 */
import { configure } from '../pipe.mjs';

const Pipe = configure({ maxAttempts: 5, maxDelay: 0 });
let calls = 0;

const value = await Pipe.fromAsync(async () => {
	calls++;
	if (calls < 3) throw new Error('transient');
	return 'success';
})
	.retryWhen(() => true, { attempts: 4, delay: 0, jitter: false });

if (value !== 'success' || calls !== 3) {
	console.error('unexpected', { value, calls });
	process.exit(1);
}
console.log('ok', { value, calls });
