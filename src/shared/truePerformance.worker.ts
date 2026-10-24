import { periodPerformanceHistory, strengthHistory } from "./truePerformance";
import { PERFORMANCE_CALCULATION_ERROR, type PerformanceWorkerRequest, type PerformanceWorkerResponse } from "./truePerformanceProtocol";

self.addEventListener("message", (event: MessageEvent<PerformanceWorkerRequest>) => {
  const request = event.data;
  let result: PerformanceWorkerResponse["result"];
  try {
    result = { status: "ready", value: request.kind === "period"
      ? periodPerformanceHistory(request.games, request.asOf, request.gameType)
      : strengthHistory(request.games, request.asOf, undefined, request.gameType) };
  } catch (error) {
    result = { status: "error", error: PERFORMANCE_CALCULATION_ERROR,
      diagnostic: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage({ id: request.id, kind: request.kind, result } satisfies PerformanceWorkerResponse);
});

export {};
