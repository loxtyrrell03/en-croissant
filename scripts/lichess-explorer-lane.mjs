export const LICHESS_EXPLORER_MIN_SPACING_MS = 500;
export const LICHESS_EXPLORER_MIN_BACKOFF_MS = 60_000;

export function createLichessExplorerLane({
  minSpacingMs = LICHESS_EXPLORER_MIN_SPACING_MS,
  minBackoffMs = LICHESS_EXPLORER_MIN_BACKOFF_MS,
  now = () => Date.now(),
  delay = (waitMs) => new Promise((resolve) => setTimeout(resolve, waitMs)),
} = {}) {
  let tail = Promise.resolve();
  let nextStartAt = 0;
  let backoffUntil = 0;

  const run = (operation) => {
    const queued = tail
      .catch(() => undefined)
      .then(async () => {
        const currentTime = now();
        if (backoffUntil > currentTime) {
          const error = new Error("Lichess explorer is cooling down after a rate limit.");
          error.statusCode = 429;
          error.retryAfterMs = backoffUntil - currentTime;
          throw error;
        }

        const waitMs = Math.max(0, nextStartAt - currentTime);
        if (waitMs > 0) await delay(waitMs);
        nextStartAt = now() + minSpacingMs;
        return await operation();
      });
    tail = queued.catch(() => undefined);
    return queued;
  };

  const noteRateLimit = (retryAfter, currentTime = now()) => {
    const seconds = Number(retryAfter);
    const date = retryAfter ? Date.parse(retryAfter) : Number.NaN;
    const requestedMs =
      Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : Number.isFinite(date) && date > currentTime
          ? date - currentTime
          : minBackoffMs;
    backoffUntil = Math.max(backoffUntil, currentTime + Math.max(minBackoffMs, requestedMs));
    return backoffUntil - currentTime;
  };

  return { run, noteRateLimit };
}
