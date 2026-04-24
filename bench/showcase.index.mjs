import { createRunner } from './lib/runner.mjs';
import { parseBenchArgs } from './lib/cli.mjs';
import { resolveProfile } from './lib/profiles.mjs';
import showcaseBench from './showcase/scenarios.bench.mjs';

export default async function run(argv = process.argv.slice(2)) {
	const args = parseBenchArgs(argv);
	const profile = resolveProfile('showcase', {
		warmups: args.warmups,
		runs: args.runs,
	});
	const runner = createRunner({
		track: profile.track,
		warmups: profile.warmups,
		runs: profile.runs,
		outputFile: args.jsonPath,
		quiet: args.quiet,
		profile: {
			id: profile.id,
			intent: profile.intent,
		},
	});

	await showcaseBench(runner);
	return runner.finalize();
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run();
}
