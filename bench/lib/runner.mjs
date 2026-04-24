import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const WARMUP_RUNS = 1;
export const SAMPLE_RUNS = 5;

const roundMs = (n) => Number(n.toFixed(4));
const roundPerOp = (n) => Number(n.toFixed(8));
const roundOps = (n) => Number(n.toFixed(4));

const percentile = (sorted, p) => {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
	return sorted[idx];
};

const summarize = (samplesMs, operations) => {
	const sortedMs = [...samplesMs].sort((a, b) => a - b);
	const perOp = sortedMs.map(v => v / operations);
	const sortedPerOp = [...perOp].sort((a, b) => a - b);
	const medianMs = percentile(sortedMs, 0.5);
	const minMs = sortedMs[0];
	const maxMs = sortedMs[sortedMs.length - 1];
	const p95Ms = percentile(sortedMs, 0.95);
	const medianMsPerOp = percentile(sortedPerOp, 0.5);
	return {
		operations,
		medianMs: roundMs(medianMs),
		minMs: roundMs(minMs),
		maxMs: roundMs(maxMs),
		p95Ms: roundMs(p95Ms),
		medianMsPerOp: roundPerOp(medianMsPerOp),
		opsPerSec: roundOps(1000 / Math.max(medianMsPerOp, Number.EPSILON)),
	};
};

const toInt = (value, fallback) => {
	if (!Number.isInteger(value) || value < 0) return fallback;
	return value;
};

const toMeta = (track, warmups, runs) => ({
	track,
	node: process.version,
	platform: process.platform,
	arch: process.arch,
	warmups,
	runs,
	timestamp: new Date().toISOString(),
});

/**
 * @param {{
 *   track?: string,
 *   warmups?: number,
 *   runs?: number,
 *   outputFile?: string | null,
 *   quiet?: boolean,
 *   profile?: { id?: string, intent?: string } | null
 * }} [opts]
 */
export const createRunner = (opts = {}) => {
	const track = typeof opts.track === 'string' ? opts.track : 'default';
	const warmups = toInt(opts.warmups, WARMUP_RUNS);
	const runs = toInt(opts.runs, SAMPLE_RUNS);
	const outputFile = typeof opts.outputFile === 'string' ? opts.outputFile : null;
	const quiet = opts.quiet === true;
	const profile = opts.profile && typeof opts.profile === 'object'
		? {
			id: typeof opts.profile.id === 'string' ? opts.profile.id : 'custom',
			intent: typeof opts.profile.intent === 'string' ? opts.profile.intent : 'custom',
		}
		: { id: 'default', intent: 'custom' };
	const rows = [];
	let currentSection = 'general';

	const log = (...args) => {
		if (!quiet) console.log(...args);
	};

	const section = (name) => {
		currentSection = name;
		log(`\n# ${name}`);
	};

	/**
	 * @param {string} name
	 * @param {() => Promise<unknown>} fn
	 * @param {{
	 *   warmups?: number,
	 *   runs?: number,
	 *   operations?: number,
	 *   category?: 'cpuBound'|'timerSensitive'|'featureSemantics',
	 *   tags?: string[]
	 * }} [benchOpts]
	 */
	const bench = async (name, fn, benchOpts = {}) => {
		const benchWarmups = toInt(benchOpts.warmups, warmups);
		const benchRuns = toInt(benchOpts.runs, runs);
		const operations = Math.max(1, toInt(benchOpts.operations, 1));
		for (let i = 0; i < benchWarmups; i++) await fn();
		const samplesMs = [];
		for (let i = 0; i < benchRuns; i++) {
			const start = performance.now();
			await fn();
			samplesMs.push(performance.now() - start);
		}
		const stats = summarize(samplesMs, operations);
		const id = `${currentSection}/${name}`;
		const row = {
			id,
			section: currentSection,
			name,
			category: typeof benchOpts.category === 'string' ? benchOpts.category : 'featureSemantics',
			tags: Array.isArray(benchOpts.tags) ? benchOpts.tags.filter(tag => typeof tag === 'string') : [],
			samplesMs: samplesMs.map(roundMs),
			stats,
		};
		rows.push(row);
		log(
			`${id.padEnd(38)} median=${stats.medianMs}ms p95=${stats.p95Ms}ms median/op=${stats.medianMsPerOp}ms ops/s=${stats.opsPerSec}`,
		);
		return row;
	};

	const finalize = async () => {
		const sortedRows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
		const suiteHash = createHash('sha256')
			.update(JSON.stringify(sortedRows.map(row => ({
				id: row.id,
				operations: row.stats.operations,
				category: row.category,
				tags: row.tags,
			}))))
			.digest('hex');
		const report = {
			meta: {
				...toMeta(track, warmups, runs),
				profile,
				suiteHash,
			},
			results: sortedRows,
		};
		if (outputFile) {
			await mkdir(dirname(outputFile), { recursive: true });
			await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
			log(`\nWrote benchmark report: ${outputFile}`);
		}
		return report;
	};

	return { section, bench, finalize };
};

const __defaultRunner = createRunner();

/**
 * Backward compatible exports for existing suites.
 */
export const bench = (...args) => __defaultRunner.bench(...args);
export const section = (...args) => __defaultRunner.section(...args);
