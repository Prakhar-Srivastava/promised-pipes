import { bench, ITER } from './core.bench.mjs';
import { configure } from '../pipe.mjs';

const tries = 10;
const Pipe = configure({ maxAttempts: tries, maxDelay: 0 });

const fakeFetch = () =>
    new Promise((resolve, reject) => {
        if (10 * Math.random() < 10 * Math.random()) reject(new Error('Fail cuz lolz!'));
        else resolve(10.0 * Math.random());
    });

export default async function run() {
    await Promise.all([
        // Manual retry
        bench('Manual retry', async () => {
            for (let i = 0; i < ITER; i++) {
                let attempts = 0;
                while (attempts < tries) {
                    try {
                        console.log(`🚹 Attempting fetch[${i + 1}/${ITER}] (${attempts + 1} of ${tries})...`);
                        const result = await fakeFetch();
                        console.log(`🚹 Fetch Returned[${i + 1}/${ITER}]! ${result}`);
                        break;
                    } catch (error) {
                        console.error(`🚹⛔️ Fetch(${i + 1}/${ITER}) failed[${attempts + 1}]! ${error.message}`, error);
                        attempts++;
                    }
                }
                if (attempts === tries) console.log(`🚹⛔️ Fetch Returned[${i + 1}/${ITER}]!  null`);
                else console.log(`🚹 Fetch(${i + 1}/${ITER}) recovered after ${attempts + 1} attempts!`);
            }
        }),

        // Pipe retryWhen
        bench('Pipe retryWhen', async () => {
            for (let i = 0; i < ITER; i++) {
                console.log(`߷ Attempting fetch[${i + 1}/${ITER}]...`);
                const awaitedResult = await Pipe.fromAsync(fakeFetch)
                    .tap(tappedResult => console.log(`߷ Fetch successful[${i + 1}/${ITER}]! ${tappedResult}`))
                    .tapError(error => console.error(`߷⛔️ Fetch(${i + 1}/${ITER}) failed! Retrying... ${error.message}`, error))
                    .retryWhen(() => true, { attempts: tries, delay: 0, jitter: false })
                    .orRecover(() => {
                        console.log(`߷⛔️ Fetch(${i + 1}/${ITER}) failed all attempts! Recovering...`);
                        return fakeFetch();
                    })
                    .orElse(() => null);
                console.log(`߷ Fetch Returned[${i + 1}/${ITER}]! ${awaitedResult}`);
            }
        }),
    ]);
}

if (import.meta.main) {
    await run();
}