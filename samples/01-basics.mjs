/**
 * Basics: lift, map, chain, await.
 * Run: node samples/01-basics.mjs
 */
import Pipe from '../pipe.mjs';

const doubled = await Pipe.of(21).map((n) => n * 2);
const chained = await Pipe.of(1).chain((n) => Pipe.of(n + 1));

if (doubled !== 42 || chained !== 2) {
	console.error('unexpected', { doubled, chained });
	process.exit(1);
}
console.log('ok', { doubled, chained });
