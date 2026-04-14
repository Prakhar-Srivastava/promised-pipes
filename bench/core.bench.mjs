import Pipe from '../pipe.mjs';
import { performance } from 'node:perf_hooks';

export const ITER = 100_000;

export const bench = async (name, fn) => {
    const start = performance.now();
    await fn();
    const end = performance.now();
    console.log(`${name}: ${(end - start).toFixed(2)} ms`);
};

export default async function run() {
    const arr = () => Array.from({ length: 1000 }, (_, i) => i);

    await Promise.all([
        // Native Promise
        bench('Promise.then', async () => {
            let p = Promise.resolve(0);
            for (let i = 0; i < ITER; i++) {
                p = p.then(x => x + 1);
            }
            await p;
        }),
        // Pipe.map
        bench('Pipe.map', async () => {
            let p = Pipe.of(0);
            for (let i = 0; i < ITER; i++) {
                p = p.map(x => x + 1);
            }
            await p;
        }),
        // async/await
        bench('async/await', async () => {
            let x = 0;
            for (let i = 0; i < ITER; i++) {
                x = await Promise.resolve(x + 1);
            }
        }),
        // Pipe.chain
        bench('Pipe.chain', async () => {
            let p = Pipe.of(0);
            for (let i = 0; i < ITER; i++) {
                p = p.chain(x => x + 1);
            }
            await p;
        }),
        // Promise.all
        bench('Promise.all', async () => {
            await Promise.all(arr().map(x => Promise.resolve(x * 2)));
        }),
        // Pipe.all
        bench('Pipe.all', async () => {
            await Pipe.all(arr().map(x => Pipe.of(x * 2)));
        }),
    ]);
}

if (import.meta.main) {
    await run();
}