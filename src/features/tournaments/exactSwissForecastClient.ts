import type { TournamentSnapshot } from "@/features/tournaments/platform";
import {
  swissPairingSystemFor,
  type ExactSwissForecast,
} from "./exactSwissForecast";

interface ExactSwissWorkerResponse {
  id: number;
  forecasts: ExactSwissField;
}
type ExactSwissField = Record<number, ExactSwissForecast | null>;

interface ExactSwissSubscriber {
  settle: (forecasts: ExactSwissField | null) => void;
}

interface PendingExactRequest {
  subscribers: Set<ExactSwissSubscriber>;
  id: number;
  settled: boolean;
  key: string;
  refreshKey: string;
  snapshot: TournamentSnapshot;
  targetRound: number;
  timeout: ReturnType<typeof setTimeout> | null;
  worker: Worker | null;
}

// Large, late-round Dutch pairings can legitimately need several minutes.
// The renderer already has an immediate heuristic result, so scale only the
// background worker budget with the active field while retaining a hard bound.
export const EXACT_SWISS_WORKER_TIMEOUT_MS = 75_000;
export const LARGE_EXACT_SWISS_WORKER_TIMEOUT_MS = 225_000;
export const HUGE_EXACT_SWISS_WORKER_TIMEOUT_MS = 300_000;

export function exactSwissWorkerTimeoutMs(
  snapshot: TournamentSnapshot,
  targetRound: number,
): number {
  const activePlayers = snapshot.players.filter(
    (player) => player.active && !player.notPairedRounds?.includes(targetRound),
  ).length;
  if (activePlayers > 330) return HUGE_EXACT_SWISS_WORKER_TIMEOUT_MS;
  if (activePlayers > 260) return LARGE_EXACT_SWISS_WORKER_TIMEOUT_MS;
  return EXACT_SWISS_WORKER_TIMEOUT_MS;
}

// Independent workers prevent one timeout/error from cancelling other events.
// Queued requests have a separate wait bound; solve time starts on dispatch.
export const MAX_EXACT_SWISS_WORKERS = 2;
export const MAX_QUEUED_EXACT_SWISS_REQUESTS = 8;
export const EXACT_SWISS_QUEUE_WAIT_MS = 75_000;
let nextRequestId = 1;
const active = new Set<PendingExactRequest>();
const queue: PendingExactRequest[] = [];
const inFlight = new Map<string, PendingExactRequest>();
const cache = new Map<string, { forecasts: ExactSwissField | null; refreshKey: string }>();

function finish(request: PendingExactRequest, forecasts: ExactSwissField | null, cacheResult = true): void {
  if (request.settled) return;
  request.settled = true;
  if (request.timeout !== null) clearTimeout(request.timeout);
  request.worker?.terminate();
  active.delete(request);
  const index = queue.indexOf(request);
  if (index !== -1) queue.splice(index, 1);
  if (inFlight.get(request.key) === request) inFlight.delete(request.key);
  // An abandoned computation is not a failed solve. Caching its null result
  // would suppress an immediate request for the same field after navigation.
  if (cacheResult && request.subscribers.size > 0) {
    cache.set(request.key, { forecasts, refreshKey: request.refreshKey });
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
  }
  for (const subscriber of request.subscribers) subscriber.settle(forecasts);
  dispatch();
}

function subscribe(
  request: PendingExactRequest,
  myStartNumber: number,
  signal?: AbortSignal,
): Promise<ExactSwissForecast | null> {
  return new Promise((resolve) => {
    const subscriber: ExactSwissSubscriber = {
      settle(forecasts) {
        if (!request.subscribers.delete(subscriber)) return;
        signal?.removeEventListener("abort", cancel);
        resolve(forecasts?.[myStartNumber] ?? null);
      },
    };
    const cancel = () => {
      subscriber.settle(null);
      if (request.settled || request.subscribers.size > 0) return;
      // React can clean up one selection and subscribe to the same field in
      // the same effect flush. Keep its worker until that handoff completes.
      queueMicrotask(() => {
        if (!request.settled && request.subscribers.size === 0) finish(request, null, false);
      });
    };
    request.subscribers.add(subscriber);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

function dispatch(): void {
  while (active.size < MAX_EXACT_SWISS_WORKERS && queue.length > 0) {
    // Its last subscriber may be handing off to a new selection this tick.
    // The cancellation microtask removes it or a new subscription dispatches
    // it; do not start a worker for an already abandoned queued request.
    if (queue[0].subscribers.size === 0) break;
    const request = queue.shift()!;
    if (request.timeout !== null) clearTimeout(request.timeout);
    active.add(request);
    try {
      const worker = new Worker(new URL("./exactSwissForecast.worker.ts", import.meta.url), {
        type: "module",
      });
      request.worker = worker;
      worker.addEventListener("message", (event: MessageEvent<ExactSwissWorkerResponse>) => {
        if (event.data?.id === request.id) finish(request, event.data.forecasts);
      });
      worker.addEventListener("error", () => finish(request, null));
      worker.addEventListener("messageerror", () => finish(request, null));
      request.timeout = setTimeout(
        () => finish(request, null),
        exactSwissWorkerTimeoutMs(request.snapshot, request.targetRound),
      );
      worker.postMessage({
        id: request.id,
        snapshot: request.snapshot,
        targetRound: request.targetRound,
        system: swissPairingSystemFor(request.snapshot),
      });
    } catch {
      finish(request, null);
    }
  }
}

export function exactSwissForecastKey(
  snapshot: TournamentSnapshot,
  targetRound: number,
  _myStartNumber?: number,
): string {
  // Only observation timestamps are irrelevant to the solver. Preserve every
  // other field so results, ratings, availability, rules and future additions
  // still invalidate the cached reconstruction even within the same fetch.
  return JSON.stringify([{ ...snapshot, fetchedAt: "", sourceUpdatedAt: null }, targetRound]);
}

export function requestExactSwissForecast(
  snapshot: TournamentSnapshot,
  targetRound: number,
  myStartNumber: number,
  signal?: AbortSignal,
): Promise<ExactSwissForecast | null> {
  if (signal?.aborted) return Promise.resolve(null);
  if (snapshot.incompletePairingRounds?.some(round => round > 0 && round < targetRound)) return Promise.resolve(null);
  const key = exactSwissForecastKey(snapshot, targetRound, myStartNumber);
  const refreshKey = JSON.stringify([snapshot.fetchedAt, snapshot.sourceUpdatedAt]);
  const pending = inFlight.get(key);
  if (pending) {
    pending.refreshKey = refreshKey;
    const result = subscribe(pending, myStartNumber, signal);
    dispatch();
    return result;
  }
  const cached = cache.get(key);
  // Successful field results survive metadata-only refreshes. An infrastructure
  // failure is cached only for the last observed refresh, so a subsequent fetch
  // can retry instead of making an unchanged field permanently unavailable.
  if (cached && (cached.forecasts !== null || cached.refreshKey === refreshKey)) {
    return Promise.resolve(cached.forecasts?.[myStartNumber] ?? null);
  }
  if (typeof Worker === "undefined" || queue.length >= MAX_QUEUED_EXACT_SWISS_REQUESTS) {
    return Promise.resolve(null);
  }
  // Preserve the original observation metadata in the immutable worker input;
  // those timestamps are omitted only from the semantic cache identity.
  const frozenSnapshot = JSON.parse(JSON.stringify(snapshot)) as TournamentSnapshot;
  const request: PendingExactRequest = {
    id: nextRequestId++, settled: false, key, refreshKey, snapshot: frozenSnapshot, targetRound,
    subscribers: new Set(), worker: null, timeout: null,
  };
  inFlight.set(key, request);
  const result = subscribe(request, myStartNumber, signal);
  request.timeout = setTimeout(() => finish(request, null), EXACT_SWISS_QUEUE_WAIT_MS);
  queue.push(request);
  dispatch();
  return result;
}
