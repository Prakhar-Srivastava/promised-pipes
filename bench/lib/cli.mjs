const parseNumber = (value) => {
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
};

/**
 * Parse benchmark CLI flags.
 *
 * Supported flags:
 * --json <path>
 * --warmups <n>
 * --runs <n>
 * --quiet
 * --threshold <ratio>
 * --baseline <path>
 * --current <path>
 * --thresholds <path>
 * --summary <path>
 * --diff <path>
 * --allow-meta-mismatch
 * --allow-new-ids
 */
export const parseBenchArgs = (argv = process.argv.slice(2)) => {
	const out = {
		jsonPath: null,
		warmups: null,
		runs: null,
		quiet: false,
		threshold: null,
		baselinePath: null,
		currentPath: null,
		thresholdsPath: null,
		summaryPath: null,
		diffPath: null,
		allowMetaMismatch: false,
		allowNewIds: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		const next = argv[i + 1];
		if (token === '--json' && next) {
			out.jsonPath = next;
			i++;
		} else if (token === '--warmups' && next) {
			out.warmups = parseNumber(next);
			i++;
		} else if (token === '--runs' && next) {
			out.runs = parseNumber(next);
			i++;
		} else if (token === '--quiet') {
			out.quiet = true;
		} else if (token === '--threshold' && next) {
			out.threshold = parseNumber(next);
			i++;
		} else if (token === '--baseline' && next) {
			out.baselinePath = next;
			i++;
		} else if (token === '--current' && next) {
			out.currentPath = next;
			i++;
		} else if (token === '--thresholds' && next) {
			out.thresholdsPath = next;
			i++;
		} else if (token === '--summary' && next) {
			out.summaryPath = next;
			i++;
		} else if (token === '--diff' && next) {
			out.diffPath = next;
			i++;
		} else if (token === '--allow-meta-mismatch') {
			out.allowMetaMismatch = true;
		} else if (token === '--allow-new-ids') {
			out.allowNewIds = true;
		}
	}
	return out;
};
