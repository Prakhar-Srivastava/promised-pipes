import runCiBench from './ci.index.mjs';
import runShowcaseBench from './showcase.index.mjs';

export default async function run() {
	await runCiBench([]);
	await runShowcaseBench([]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run();
}