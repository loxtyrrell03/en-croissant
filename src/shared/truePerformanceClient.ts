import {
  PERFORMANCE_CALCULATION_ERROR,
  type PerformanceCalculationKind,
  type PerformanceCalculationRequest,
  type PerformanceCalculationResult,
  type PerformanceWorkerResponse,
} from "./truePerformanceProtocol";

export const PERFORMANCE_WORKER_TIMEOUT_MS = 120_000;
let nextRequestId = 1;

/** A worker belongs to one calculation, so cancellation stops the computation
 * itself. There is no renderer fallback or retained cross-account result cache. */
export function requestPerformanceCalculation<K extends PerformanceCalculationKind>(request: PerformanceCalculationRequest<K>) {
  const id = nextRequestId++;
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let resolve!: (value: PerformanceCalculationResult<K>) => void;
  const result = new Promise<PerformanceCalculationResult<K>>(done => { resolve = done; });
  const finish = (value: PerformanceCalculationResult<K>) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
    if (value.status === "error") {
      console.error(`Performance estimate could not be calculated (${request.kind})`, value.diagnostic ?? value.error);
    }
    resolve(value);
  };
  try {
    if (typeof Worker === "undefined") throw new Error("Workers unavailable");
    worker = new Worker(new URL("./truePerformance.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<PerformanceWorkerResponse>) => {
      if (event.data?.id !== id || event.data.kind !== request.kind) return;
      const response = event.data.result;
      if (response?.status !== "ready" && response?.status !== "error") {
        finish({ status: "error", error: PERFORMANCE_CALCULATION_ERROR });
        return;
      }
      finish(response as PerformanceCalculationResult<K>);
    });
    const failed = (event: Event) => {
      event.preventDefault();
      finish({ status: "error", error: PERFORMANCE_CALCULATION_ERROR,
        diagnostic: event.type === "error" ? (event as ErrorEvent).message : "Worker response could not be read" });
    };
    worker.addEventListener("error", failed);
    worker.addEventListener("messageerror", failed);
    timer = setTimeout(() => finish({ status: "error", error: "This estimate took too long. Try again." }), PERFORMANCE_WORKER_TIMEOUT_MS);
    worker.postMessage({ ...request, id });
  } catch (error) {
    finish({ status: "error", error: "Background estimates are unavailable. Try again or reload this view.",
      diagnostic: error instanceof Error ? error.message : String(error) });
  }
  return { result, cancel: () => finish({ status: "cancelled" }) };
}
