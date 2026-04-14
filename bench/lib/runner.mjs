import { performance } from 'node:perf_hooks';

export const WARMUP_RUNS = 1;
export const SAMPLE_RUNS = 5;

const round = (n) => Number(n.toFixed(2));

const summarize = (samples) => {
	const sorted = [...samples].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	const min = sorted[0];
	const max = sorted[sorted.length - 1];
	const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
	return {
		median: round(median),
		min: round(min),
		max: round(max),
		p95: round(p95),
	};
};

/**
 * Run a benchmark with warmup + repeated samples.
 *
 * @param {string} name
 * @param {Function} fn
 * @param {{ warmups?: number, runs?: number }} [opts]
 * @returns {Promise<{name: string, samples: number[], stats: object}>}
 */
export const bench = async (name, fn, opts = {}) => {
	const warmups = Number.isInteger(opts.warmups) ? opts.warmups : WARMUP_RUNS;
	const runs = Number.isInteger(opts.runs) ? opts.runs : SAMPLE_RUNS;
	for (let i = 0; i < warmups; i++) await fn();
	const samples = [];
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		await fn();
		samples.push(performance.now() - start);
	}
	const stats = summarize(samples);
	console.log(
		`${name.padEnd(28)} median=${stats.median}ms min=${stats.min}ms max=${stats.max}ms p95=${stats.p95}ms`,
	);
	return { name, samples, stats };
};

export const section = (name) => {
	console.log(`\n# ${name}`);
};
