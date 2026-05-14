import { type PersistStorage, type StorageValue } from "zustand/middleware";

const DEBOUNCE_MS = 1200;
const pendingWrites = new Map<string, StorageValue<unknown>>();

let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let idleFlushId: number | null = null;
let flushHandlersBound = false;

function requestIdleFlush(callback: () => void) {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        return window.requestIdleCallback(callback, { timeout: 3000 });
    }

    return globalThis.setTimeout(callback, 0) as unknown as number;
}

function cancelIdleFlush(id: number) {
    if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(id);
        return;
    }

    globalThis.clearTimeout(id);
}

function flush() {
    if (pendingWrites.size === 0) {
        return;
    }

    for (const [name, value] of pendingWrites) {
        sessionStorage.setItem(name, JSON.stringify(value));
    }

    pendingWrites.clear();
}

function scheduleFlush(delay: number) {
    if (flushTimeout) {
        clearTimeout(flushTimeout);
    }
    if (idleFlushId !== null) {
        cancelIdleFlush(idleFlushId);
        idleFlushId = null;
    }

    flushTimeout = setTimeout(() => {
        flushTimeout = null;
        idleFlushId = requestIdleFlush(() => {
            idleFlushId = null;
            flush();
        });
    }, delay);
}

function bindFlushHandlers() {
    if (flushHandlersBound || typeof window === "undefined") {
        return;
    }

    const flushAndClearTimeout = () => {
        if (flushTimeout) {
            clearTimeout(flushTimeout);
            flushTimeout = null;
        }
        if (idleFlushId !== null) {
            cancelIdleFlush(idleFlushId);
            idleFlushId = null;
        }

        flush();
    };

    window.addEventListener("beforeunload", flushAndClearTimeout);
    window.addEventListener("pagehide", flushAndClearTimeout);

    flushHandlersBound = true;
}

export function createDebouncedSessionStorage<S>(delay = DEBOUNCE_MS): PersistStorage<S> {
    bindFlushHandlers();

    return {
        getItem: (name) => {
            const pending = pendingWrites.get(name);
            if (pending) {
                return pending as StorageValue<S>;
            }

            const stored = sessionStorage.getItem(name);
            return stored ? (JSON.parse(stored) as StorageValue<S>) : null;
        },
        setItem: (name, value) => {
            pendingWrites.set(name, value as StorageValue<unknown>);
            scheduleFlush(delay);
        },
        removeItem: (name) => {
            pendingWrites.delete(name);
            sessionStorage.removeItem(name);
        },
    };
}

export function removeDebouncedSessionStorageItem(name: string) {
    pendingWrites.delete(name);
    sessionStorage.removeItem(name);
}
