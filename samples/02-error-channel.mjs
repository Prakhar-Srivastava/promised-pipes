/**
 * Error channel: tapError preserves rejection; orElse recovers.
 * Run: node samples/02-error-channel.mjs
 */
import Pipe from '../pipe.mjs';

let logged = false;
const out = await Pipe.reject(new Error('upstream'))
	.tapError(() => {
		logged = true;
	})
	.orElse(() => 'recovered');

if (!logged || out !== 'recovered') {
	console.error('unexpected', { logged, out });
	process.exit(1);
}
console.log('ok', { out });
