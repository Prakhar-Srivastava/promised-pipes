/**
 * configure(): custom limits reflected on Pipe.config.
 * Run: node samples/04-configure-limits.mjs
 */
import { configure } from '../pipe.mjs';

const Pipe = configure({
	maxTimeout: 60_000,
	maxAttempts: 5,
	maxDelay: 2_000,
});

if (
	Pipe.config.maxTimeout !== 60_000
	|| Pipe.config.maxAttempts !== 5
	|| Pipe.config.maxDelay !== 2_000
) {
	console.error('unexpected config', Pipe.config);
	process.exit(1);
}

const ok = await Pipe.of(1).timeout(1_000).map((n) => n + 1);
if (ok !== 2) {
	console.error('unexpected', ok);
	process.exit(1);
}
console.log('ok', Pipe.config);
