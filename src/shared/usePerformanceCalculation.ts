import { useCallback, useEffect, useState } from "react";
import { requestPerformanceCalculation } from "./truePerformanceClient";
import type { PerformanceCalculationKind, PerformanceCalculationRequest, PerformanceCalculationValues } from "./truePerformanceProtocol";

type CalculationState<K extends PerformanceCalculationKind> =
  | { status: "idle" | "loading"; value: null; error: null }
  | { status: "ready"; value: PerformanceCalculationValues[K]; error: null }
  | { status: "error"; value: null; error: string };

/** Callers memoize the request. Returning loading for a new identity hides the
 * old account/selection during render, before effect cleanup runs. */
export function usePerformanceCalculation<K extends PerformanceCalculationKind>(request: PerformanceCalculationRequest<K> | null): CalculationState<K> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const [completed, setCompleted] = useState<{ request: PerformanceCalculationRequest<K>; attempt: number; state: CalculationState<K> } | null>(null);
  useEffect(() => {
    if (!request) return;
    let active = true;
    const job = requestPerformanceCalculation(request);
    void job.result.then(result => {
      if (!active || result.status === "cancelled") return;
      setCompleted({ request, attempt, state: result.status === "ready"
        ? { status: "ready", value: result.value, error: null }
        : { status: "error", value: null, error: result.error } });
    });
    return () => { active = false; job.cancel(); };
  }, [request, attempt]);
  if (!request) return { status: "idle", value: null, error: null, retry };
  return { ...(completed?.request === request && completed.attempt === attempt ? completed.state : { status: "loading" as const, value: null, error: null }), retry };
}
