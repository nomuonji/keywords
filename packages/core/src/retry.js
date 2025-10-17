"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retry = retry;
async function retry(fn, options = {}) {
    const retries = options.retries ?? 3;
    const factor = options.factor ?? 2;
    const initialDelay = options.initialDelayMs ?? 500;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            return await fn();
        }
        catch (err) {
            attempt += 1;
            if (attempt > retries) {
                throw err;
            }
            const delay = initialDelay * factor ** (attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}
