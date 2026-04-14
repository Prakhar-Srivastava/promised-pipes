import coreBench from './core.bench.mjs';
import pipelineBench from './pipeline.bench.mjs';
import abortBench from './abort.bench.mjs';
import concurrencyBench from './concurrency.bench.mjs';
import coalesceBench from './coalesce.bench.mjs';

export default async function run() {
	await coreBench();
	await pipelineBench();
	await abortBench();
	await concurrencyBench();
	await coalesceBench();
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run();
}