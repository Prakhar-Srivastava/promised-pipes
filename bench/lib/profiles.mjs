export const BENCH_PROFILES = Object.freeze({
	ci: Object.freeze({
		id: 'ci-v1',
		track: 'ci',
		intent: 'regression-gate',
		warmups: 3,
		runs: 11,
	}),
	showcase: Object.freeze({
		id: 'showcase-v1',
		track: 'showcase',
		intent: 'capability-profile',
		warmups: 2,
		runs: 9,
	}),
});

/**
 * @param {'ci'|'showcase'} profileName
 * @param {{warmups?: number|null, runs?: number|null}} [overrides]
 */
export const resolveProfile = (profileName, overrides = {}) => {
	const profile = BENCH_PROFILES[profileName];
	if (!profile) {
		throw new Error(`Unknown benchmark profile: ${profileName}`);
	}
	const warmups = Number.isInteger(overrides.warmups) ? overrides.warmups : profile.warmups;
	const runs = Number.isInteger(overrides.runs) ? overrides.runs : profile.runs;
	return {
		...profile,
		warmups,
		runs,
	};
};
