export function untilFideRequestAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    return new Promise<T>((resolve, reject) => {
        const detach = () => signal.removeEventListener("abort", onAbort);
        const onAbort = () => {
            detach();
            reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        promise.then(
            (value) => {
                detach();
                resolve(value);
            },
            (error) => {
                detach();
                reject(error);
            },
        );
    });
}

export async function withFideRequestDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
) {
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
        () => controller.abort(new Error("FIDE lookup took too long. Retry the search.")),
        10_000,
    );
    try {
        return await untilFideRequestAborted(operation(controller.signal), controller.signal);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
    }
}
