import coreBench from './core.bench.mjs';
import pipelineBench from './pipeline.bench.mjs';

export default async function run() {
    await Promise.all([
        coreBench(),
        pipelineBench(),
    ]);
}

if (import.meta.main) {
    await run();
}