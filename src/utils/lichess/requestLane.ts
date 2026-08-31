export const LICHESS_REQUEST_SPACING_MS = 500;
export const LICHESS_MIN_BACKOFF_MS = 60_000;

export type LichessRequestPriority = "interactive" | "normal" | "background";

export type LichessRequestSchedule = {
    signal?: AbortSignal;
    priority?: LichessRequestPriority;
    minSpacingMs?: number;
};

type QueuedRequest = {
    operation: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
    priority: LichessRequestPriority;
    minSpacingMs: number;
    order: number;
    started: boolean;
};

const priorityRank: Record<LichessRequestPriority, number> = {
    interactive: 0,
    normal: 1,
    background: 2,
};

let active: QueuedRequest | null = null;
let queue: QueuedRequest[] = [];
let nextOrder = 0;
let lastStartedAt: number | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let backoffUntil = 0;

function abortError() {
    const error = new Error("Lichess request was cancelled.");
    error.name = "AbortError";
    return error;
}

function detach(request: QueuedRequest) {
    if (request.signal && request.onAbort) {
        request.signal.removeEventListener("abort", request.onAbort);
    }
    request.onAbort = undefined;
}

function nextIndex() {
    let best = -1;
    for (let index = 0; index < queue.length; index += 1) {
        const candidate = queue[index];
        if (candidate.signal?.aborted) continue;
        if (
            best < 0 ||
            priorityRank[candidate.priority] < priorityRank[queue[best].priority] ||
            (candidate.priority === queue[best].priority && candidate.order < queue[best].order)
        ) {
            best = index;
        }
    }
    return best;
}

function runNext() {
    if (active || timer !== undefined) return;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
        const request = queue[index];
        if (!request.signal?.aborted) continue;
        queue.splice(index, 1);
        detach(request);
        request.reject(abortError());
    }

    const index = nextIndex();
    if (index < 0) return;
    const request = queue[index];
    const spacing = Math.max(LICHESS_REQUEST_SPACING_MS, request.minSpacingMs);
    const wait = lastStartedAt === null ? 0 : Math.max(0, lastStartedAt + spacing - Date.now());
    if (wait > 0) {
        timer = globalThis.setTimeout(() => {
            timer = undefined;
            runNext();
        }, wait);
        return;
    }

    queue.splice(index, 1);
    request.started = true;
    active = request;
    lastStartedAt = Date.now();
    detach(request);
    void Promise.resolve()
        .then(() => {
            if (request.signal?.aborted) throw abortError();
            return request.operation();
        })
        .then(
            (value) => {
                if (active === request) active = null;
                runNext();
                request.resolve(value);
            },
            (error: unknown) => {
                if (active === request) active = null;
                runNext();
                request.reject(error);
            },
        );
}

export function queueLichessRequest<T>(
    operation: () => Promise<T>,
    schedule: LichessRequestSchedule = {},
): Promise<T> {
    if (schedule.signal?.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
        const request: QueuedRequest = {
            operation,
            resolve: (value) => resolve(value as T),
            reject,
            signal: schedule.signal,
            priority: schedule.priority ?? "normal",
            minSpacingMs: Math.max(0, schedule.minSpacingMs ?? 0),
            order: nextOrder++,
            started: false,
        };
        if (schedule.signal) {
            request.onAbort = () => {
                if (request.started) return;
                const index = queue.indexOf(request);
                if (index >= 0) queue.splice(index, 1);
                detach(request);
                reject(abortError());
            };
            schedule.signal.addEventListener("abort", request.onAbort, { once: true });
        }
        queue.push(request);
        runNext();
    });
}

export function lichessBackoffRemaining(now = Date.now()) {
    return Math.max(0, backoffUntil - now);
}

export function noteLichessRateLimit(retryAfter: string | null, now = Date.now()) {
    const seconds = Number(retryAfter);
    const date = retryAfter ? Date.parse(retryAfter) : Number.NaN;
    const requested =
        Number.isFinite(seconds) && seconds > 0
            ? seconds * 1000
            : Number.isFinite(date) && date > now
              ? date - now
              : LICHESS_MIN_BACKOFF_MS;
    backoffUntil = Math.max(backoffUntil, now + Math.max(LICHESS_MIN_BACKOFF_MS, requested));
}

export function resetLichessRequestLaneForTests() {
    active = null;
    for (const request of queue) detach(request);
    queue = [];
    nextOrder = 0;
    lastStartedAt = null;
    backoffUntil = 0;
    if (timer !== undefined) globalThis.clearTimeout(timer);
    timer = undefined;
}
