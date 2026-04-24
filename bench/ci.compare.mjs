import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseBenchArgs } from './lib/cli.mjs';

const pct = (n) => `${(n * 100).toFixed(2)}%`;

const readJson = async (path) => {
	const raw = await readFile(path, 'utf8');
	return JSON.parse(raw);
};

const toMap = (report) => new Map(report.results.map(row => [row.id, row]));

const pickMeta = (meta = {}) => ({
	node: meta.node,
	platform: meta.platform,
	arch: meta.arch,
	profileId: meta?.profile?.id,
	profileIntent: meta?.profile?.intent,
});

const parseThresholds = (rawThresholds, cliThreshold) => {
	if (!rawThresholds) {
		return {
			defaultThreshold: typeof cliThreshold === 'number' ? cliThreshold : 0.2,
			overrides: {},
		};
	}
	if (typeof rawThresholds.defaultThreshold === 'number' && rawThresholds.overrides) {
		return {
			defaultThreshold: typeof cliThreshold === 'number' ? cliThreshold : rawThresholds.defaultThreshold,
			overrides: rawThresholds.overrides,
		};
	}
	// Backward compatibility: id->number map
	return {
		defaultThreshold: typeof cliThreshold === 'number' ? cliThreshold : 0.2,
		overrides: Object.fromEntries(
			Object.entries(rawThresholds)
				.filter(([, value]) => typeof value === 'number')
				.map(([id, threshold]) => [id, { threshold, reason: 'legacy override map' }]),
		),
	};
};

const summarizeMarkdown = ({
	baselinePath,
	currentPath,
	threshold,
	regressions,
	comparisons,
	missingInCurrent,
	newInCurrent,
	metaMismatch,
}) => {
	const lines = [
		'# CI Benchmark Comparison',
		'',
		`- Baseline: \`${baselinePath}\``,
		`- Current: \`${currentPath}\``,
		`- Default threshold: ${pct(threshold)}`,
		`- Compared benchmarks: ${comparisons}`,
		`- Regressions: ${regressions.length}`,
		'',
	];

	if (metaMismatch.length > 0) {
		lines.push('## Metadata Mismatch', '');
		for (const mismatch of metaMismatch) {
			lines.push(`- \`${mismatch.field}\`: baseline=\`${mismatch.baseline}\`, current=\`${mismatch.current}\``);
		}
		lines.push('');
	}

	if (missingInCurrent.length > 0) {
		lines.push('## Missing Benchmarks (Current)', '');
		for (const id of missingInCurrent) lines.push(`- \`${id}\``);
		lines.push('');
	}

	if (newInCurrent.length > 0) {
		lines.push('## New Benchmarks (Current)', '');
		for (const id of newInCurrent) lines.push(`- \`${id}\``);
		lines.push('');
	}

	if (regressions.length > 0) {
		lines.push('## Regressions', '');
		for (const regression of regressions) {
			lines.push(
				`- \`${regression.id}\`: ${pct(regression.delta)} slower (${regression.baselineMsPerOp.toFixed(6)}ms/op -> ${regression.currentMsPerOp.toFixed(6)}ms/op, threshold ${pct(regression.threshold)})`,
			);
		}
		lines.push('');
	} else {
		lines.push('No regressions above threshold were detected.');
		lines.push('');
	}

	return `${lines.join('\n')}\n`;
};

export default async function run(argv = process.argv.slice(2)) {
	const args = parseBenchArgs(argv);
	const baselinePath = args.baselinePath || 'bench/baselines/ci-baseline.json';
	const currentPath = args.currentPath || 'bench/out/ci-current.json';
	const defaultThreshold = typeof args.threshold === 'number' ? args.threshold : 0.2;

	const baselineReport = await readJson(baselinePath);
	const currentReport = await readJson(currentPath);
	const thresholdsRaw = args.thresholdsPath ? await readJson(args.thresholdsPath) : null;
	const thresholds = parseThresholds(thresholdsRaw, defaultThreshold);
	const baselineMeta = pickMeta(baselineReport.meta);
	const currentMeta = pickMeta(currentReport.meta);

	const baselineById = toMap(baselineReport);
	const currentById = toMap(currentReport);

	const regressions = [];
	const missingInCurrent = [];
	const newInCurrent = [];
	const metaMismatch = [];
	let comparisons = 0;

	for (const field of ['node', 'platform', 'arch', 'profileId', 'profileIntent']) {
		if (baselineMeta[field] !== currentMeta[field]) {
			metaMismatch.push({
				field,
				baseline: baselineMeta[field],
				current: currentMeta[field],
			});
		}
	}

	if (metaMismatch.length > 0 && !args.allowMetaMismatch) {
		console.log('Baseline/current metadata mismatch detected:');
		for (const mismatch of metaMismatch) {
			console.log(`- ${mismatch.field}: baseline=${mismatch.baseline}, current=${mismatch.current}`);
		}
		console.log('Use --allow-meta-mismatch only for local, informational comparisons.');
		process.exitCode = 1;
	}

	for (const [id, baselineRow] of baselineById.entries()) {
		const currentRow = currentById.get(id);
		if (!currentRow) {
			missingInCurrent.push(id);
			continue;
		}
		const baselineMsPerOp = baselineRow.stats.medianMsPerOp;
		const currentMsPerOp = currentRow.stats.medianMsPerOp;
		const delta = (currentMsPerOp - baselineMsPerOp) / Math.max(baselineMsPerOp, Number.EPSILON);
		const threshold = typeof thresholds.overrides?.[id]?.threshold === 'number'
			? thresholds.overrides[id].threshold
			: thresholds.defaultThreshold;
		comparisons++;

		if (delta > threshold) {
			regressions.push({
				id,
				delta,
				baselineMsPerOp,
				currentMsPerOp,
				threshold,
			});
		}
	}

	for (const id of currentById.keys()) {
		if (!baselineById.has(id)) newInCurrent.push(id);
	}

	console.log(`Compared ${comparisons} benchmark rows.`);
	if (missingInCurrent.length > 0) {
		console.log(`Missing in current report (${missingInCurrent.length}):`);
		for (const id of missingInCurrent) console.log(`- ${id}`);
	}
	if (newInCurrent.length > 0) {
		console.log(`New in current report (${newInCurrent.length}):`);
		for (const id of newInCurrent) console.log(`- ${id}`);
	}
	if (regressions.length > 0) {
		console.log(`Detected ${regressions.length} regressions above threshold:`);
		for (const regression of regressions) {
			console.log(
				`- ${regression.id}: ${pct(regression.delta)} slower (${regression.baselineMsPerOp.toFixed(6)}ms/op -> ${regression.currentMsPerOp.toFixed(6)}ms/op, threshold ${pct(regression.threshold)})`,
			);
		}
	} else {
		console.log('No regressions above threshold.');
	}

	const diffReport = {
		meta: {
			baselinePath,
			currentPath,
			defaultThreshold: thresholds.defaultThreshold,
			allowMetaMismatch: args.allowMetaMismatch,
			allowNewIds: args.allowNewIds,
			baselineMeta,
			currentMeta,
		},
		comparisons,
		missingInCurrent,
		newInCurrent,
		metaMismatch,
		regressions,
	};

	if (args.summaryPath) {
		const summary = summarizeMarkdown({
			baselinePath,
			currentPath,
			threshold: thresholds.defaultThreshold,
			regressions,
			comparisons,
			missingInCurrent,
			newInCurrent,
			metaMismatch,
		});
		await mkdir(dirname(args.summaryPath), { recursive: true });
		await writeFile(args.summaryPath, summary, 'utf8');
		console.log(`Wrote summary: ${args.summaryPath}`);
	}

	if (args.diffPath) {
		await mkdir(dirname(args.diffPath), { recursive: true });
		await writeFile(args.diffPath, `${JSON.stringify(diffReport, null, 2)}\n`, 'utf8');
		console.log(`Wrote diff report: ${args.diffPath}`);
	}

	if (
		regressions.length > 0
		|| missingInCurrent.length > 0
		|| newInCurrent.length > 0 && !args.allowNewIds
		|| metaMismatch.length > 0 && !args.allowMetaMismatch
	) {
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run();
}
