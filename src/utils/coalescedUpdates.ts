/** Keep the latest live result during each display interval, including startup. */
export function coalescedUpdates<T>(
    publish: (value: T) => void,
    isCurrent: () => boolean,
    intervalMs: number,
) {
    let pending: { value: T } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPublication: number | null = null;
    let closed = false;
    const clear = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        pending = null;
    };
    const publishPending = () => {
        const latest = pending;
        clear();
        if (closed || !latest || !isCurrent()) return;
        lastPublication = performance.now();
        publish(latest.value);
    };
    return {
        push(value: T) {
            if (closed || !isCurrent()) return;
            pending = { value };
            const now = performance.now();
            const remaining =
                lastPublication === null ? intervalMs : lastPublication + intervalMs - now;
            if (remaining <= 0) publishPending();
            else if (timer === null) timer = setTimeout(publishPending, remaining);
        },
        finish(value: T) {
            const wasClosed = closed;
            closed = true;
            clear();
            if (!wasClosed && isCurrent()) publish(value);
        },
        cancel() {
            closed = true;
            clear();
        },
    };
}
