// A successor must not start while a previous stop/kill for the same native
// engine/tab can still arrive. This scope survives listener unmount/remount.
const pending = new Map<string, Promise<void>>();
const keyFor = (engine: string, tab: string) => JSON.stringify([engine, tab]);
export function ownedEngineReply<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener("abort", abort);
            reject(new DOMException("Analysis cancelled", "AbortError"));
        };
        if (signal.aborted) {
            promise.catch(() => {});
            abort();
            return;
        }
        signal.addEventListener("abort", abort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", abort);
                if (signal.aborted) abort();
                else resolve(value);
            },
            (error) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            },
        );
    });
}
export function queueLocalEngineStop(engine: string, tab: string, stop: () => Promise<void>) {
    const key = keyFor(engine, tab);
    const operation = (pending.get(key) ?? Promise.resolve()).then(stop);
    const barrier = operation.then(
        () => {},
        () => {},
    );
    pending.set(key, barrier);
    void barrier.then(() => {
        if (pending.get(key) === barrier) pending.delete(key);
    });
    return operation;
}
export async function waitForLocalEngineStops(
    engine: string,
    tab: string,
    signal?: AbortSignal,
    timeoutMs = 15000,
) {
    const key = keyFor(engine, tab);
    const deadline = performance.now() + timeoutMs;
    for (;;) {
        if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
        const barrier = pending.get(key);
        if (!barrier) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const remaining = deadline - performance.now();
            if (remaining <= 0)
                throw new Error(
                    "Timed out waiting for the previous engine stop request. Retry after it finishes.",
                );
            const bounded = Promise.race([
                barrier,
                new Promise<void>((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    "Timed out waiting for the previous engine stop request. Retry after it finishes.",
                                ),
                            ),
                        remaining,
                    );
                }),
            ]);
            await (signal ? ownedEngineReply(bounded, signal) : bounded);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }
}
