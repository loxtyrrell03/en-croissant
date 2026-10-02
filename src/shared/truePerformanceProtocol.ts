import type { PerformanceGame, PerformanceGameType, StrengthHistory, StrengthPoint } from "./truePerformance";

export interface PerformanceCalculationValues {
  period: StrengthPoint[];
  history: StrengthHistory;
}
export type PerformanceCalculationKind = keyof PerformanceCalculationValues;
export interface PerformanceCalculationRequest<K extends PerformanceCalculationKind = PerformanceCalculationKind> {
  kind: K;
  games: readonly PerformanceGame[];
  asOf: number;
  gameType: PerformanceGameType;
}
export type PerformanceCalculationResult<K extends PerformanceCalculationKind = PerformanceCalculationKind> =
  | { status: "ready"; value: PerformanceCalculationValues[K] }
  | { status: "error"; error: string; diagnostic?: string }
  | { status: "cancelled" };
export interface PerformanceWorkerRequest extends PerformanceCalculationRequest {
  id: number;
}
export interface PerformanceWorkerResponse {
  id: number;
  kind: PerformanceCalculationKind;
  result: PerformanceCalculationResult;
}

export const PERFORMANCE_CALCULATION_ERROR = "This estimate could not be calculated reliably for these games.";
