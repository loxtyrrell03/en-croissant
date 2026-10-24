// Review files have one writer per path, shared by mounted workspaces and
// background updates. Pending evidence outlives a failed write or panel remount.
type Pending = { revision: number; value: unknown; write: (value: unknown) => Promise<unknown> };
type Waiter = {
    revision: number;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
};
type Entry = {
    pending: Pending | null;
    active: Promise<void> | null;
    error: unknown;
    waiters: Waiter[];
};
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let revision = 0;
let lifecycleBound = false;

function key(path: string) {
    const normalized = path.replaceAll("\\", "/");
    return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
        ? normalized.toLowerCase()
        : normalized;
}

function publish() {
    for (const listener of listeners) listener();
}

function start(entry: Entry): Promise<void> {
    if (entry.active) return entry.active;
    if (!entry.pending) return Promise.resolve();
    entry.active = Promise.resolve()
        .then(async () => {
            while (entry.pending) {
                const pending = entry.pending;
                try {
                    const saved = await pending.write(structuredClone(pending.value));
                    if (entry.pending === pending) entry.pending = null;
                    entry.error = null;
                    const completed = entry.waiters.filter(
                        (waiter) => waiter.revision <= pending.revision,
                    );
                    entry.waiters = entry.waiters.filter(
                        (waiter) => waiter.revision > pending.revision,
                    );
                    for (const waiter of completed) waiter.resolve(structuredClone(saved));
                    publish();
                } catch (error) {
                    entry.error =
                        error instanceof Error
                            ? error
                            : new Error(String(error || "Could not save review progress."));
                    const waiting = entry.waiters;
                    entry.waiters = [];
                    for (const waiter of waiting) waiter.reject(entry.error);
                    publish();
                    // Retain the newest snapshot. A later save or explicit boundary
                    // retries it; storage failures must never create a hot loop.
                    return;
                }
            }
        })
        .finally(() => {
            entry.active = null;
            // A new edit can arrive as an earlier task settles in a microtask.
            if (!entry.error && entry.pending) void start(entry);
        });
    return entry.active;
}

export function pendingReviewDeck<T>(path: string): T | null {
    const pending = entries.get(key(path))?.pending;
    return pending ? (structuredClone(pending.value) as T) : null;
}

export function reviewDeckWriteError(path: string): string | null {
    const error = entries.get(key(path))?.error;
    return error ? (error instanceof Error ? error.message : String(error)) : null;
}

export function subscribeReviewDeckWrites(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export async function flushReviewDeckWrites(path?: string): Promise<void> {
    const selected = path
        ? [entries.get(key(path))].filter((entry): entry is Entry => !!entry)
        : [...entries.values()];
    await Promise.all(
        selected.map(async (entry) => {
            // The rejected caller can retry before the failed task's final microtask
            // clears its slot. Wait for that slot, then actually attempt the retry.
            if (entry.error && entry.active) await entry.active;
            do {
                await start(entry);
                if (entry.error) throw entry.error;
            } while (entry.pending || entry.active);
        }),
    );
}

function bindLifecycle() {
    if (lifecycleBound || typeof window === "undefined") return;
    lifecycleBound = true;
    const flush = () => {
        void flushReviewDeckWrites().catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("beforeunload", (event) => {
        if (![...entries.values()].some((entry) => entry.pending)) return;
        flush();
        event.preventDefault();
        event.returnValue = "";
    });
}

export function writeReviewDeck<T>(
    path: string,
    value: T,
    write: (value: T) => Promise<T>,
): Promise<T> {
    bindLifecycle();
    const pathKey = key(path);
    let entry = entries.get(pathKey);
    if (!entry) {
        entry = { pending: null, active: null, error: null, waiters: [] };
        entries.set(pathKey, entry);
    }
    const nextRevision = ++revision;
    entry.pending = {
        revision: nextRevision,
        value: structuredClone(value),
        write: (snapshot) => write(snapshot as T),
    };
    const promise = new Promise<T>((resolve, reject) => {
        entry.waiters.push({
            revision: nextRevision,
            resolve: (saved) => resolve(saved as T),
            reject,
        });
    });
    void start(entry);
    return promise;
}
