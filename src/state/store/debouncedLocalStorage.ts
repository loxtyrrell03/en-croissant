import { atomWithStorage, createJSONStorage } from "jotai/utils";

// atomWithStorage's default storage writes to localStorage synchronously on
// every set. For atoms updated at pointermove frequency (board resize,
// workspace pane drags) that is a synchronous disk-backed write per mouse
// event, which visibly stutters the drag. This adapter keeps the latest value
// in memory (so reads stay consistent) and flushes to localStorage once the
// writes settle, plus on page hide so nothing is lost.

const DEBOUNCE_MS = 500;
const pendingWrites = new Map<string, string>();

let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let flushHandlersBound = false;

function flush() {
    for (const [key, value] of pendingWrites) {
        localStorage.setItem(key, value);
    }
    pendingWrites.clear();
}

function scheduleFlush() {
    if (flushTimeout) {
        clearTimeout(flushTimeout);
    }
    flushTimeout = setTimeout(() => {
        flushTimeout = null;
        flush();
    }, DEBOUNCE_MS);
}

function bindFlushHandlers() {
    if (flushHandlersBound || typeof window === "undefined") {
        return;
    }

    const flushNow = () => {
        if (flushTimeout) {
            clearTimeout(flushTimeout);
            flushTimeout = null;
        }
        flush();
    };

    window.addEventListener("beforeunload", flushNow);
    window.addEventListener("pagehide", flushNow);

    flushHandlersBound = true;
}

const debouncedStringStorage = {
    getItem: (key: string) => {
        const pending = pendingWrites.get(key);
        if (pending !== undefined) {
            return pending;
        }
        return localStorage.getItem(key);
    },
    setItem: (key: string, value: string) => {
        pendingWrites.set(key, value);
        scheduleFlush();
    },
    removeItem: (key: string) => {
        pendingWrites.delete(key);
        localStorage.removeItem(key);
    },
};

export function atomWithDebouncedStorage<T>(key: string, initialValue: T) {
    bindFlushHandlers();
    return atomWithStorage<T>(
        key,
        initialValue,
        createJSONStorage<T>(() => debouncedStringStorage),
    );
}
