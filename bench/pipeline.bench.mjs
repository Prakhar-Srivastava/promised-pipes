import { bench, ITER } from './core.bench.mjs';
import Pipe from '../pipe.mjs';

const fakeFetch = () =>
    new Promise((resolve, reject) => {
        if (10 * Math.random() < 10 * Math.random()) reject(new Error('fail'));
        else resolve(42);
    });

export default async function run() {
    await Promise.all([
        // Manual retry
        bench('Manual retry', async () => {
            for (let i = 0; i < ITER; i++) {
                let attempts = 0;
                while (attempts < 3) {
                    try {
                        await fakeFetch();
                        break;
                    } catch {
                        attempts++;
                    }
                }
            }
        }),
        // Pipe retryWhen

        bench('Pipe retryWhen', async () => {
            // for (let i = 0; i < 5; i++) {
                await Pipe.fromAsync(fakeFetch)
                    .retryWhen(() => true, { attempts: 3, delay: 0, jitter: false })
                    .orElse(() => null);
            // }
        }),
    ]);
}

if (import.meta.main) {
    await run();
}