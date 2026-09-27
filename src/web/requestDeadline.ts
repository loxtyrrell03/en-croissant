export async function withWebRequestDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    message: string,
    signal?: AbortSignal,
): Promise<T> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();
    const timer = setTimeout(() => controller.abort(new Error(message)), timeoutMs);
    let detach = () => {};
    try {
        if (controller.signal.aborted) throw controller.signal.reason;
        const interrupted = new Promise<never>((_resolve, reject) => {
            const abort = () => reject(controller.signal.reason);
            controller.signal.addEventListener("abort", abort, { once: true });
            detach = () => controller.signal.removeEventListener("abort", abort);
        });
        // Bound the response body too, including providers that fail to reject
        // their pending promise when the browser aborts the underlying request.
        return await Promise.race([operation(controller.signal), interrupted]);
    } finally {
        clearTimeout(timer);
        detach();
        signal?.removeEventListener("abort", forwardAbort);
    }
}
