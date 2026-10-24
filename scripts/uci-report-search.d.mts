export type ReportSearchLimits = { depth: number; timeMs: number };
export function validReportSearchLimits(value: unknown): value is ReportSearchLimits;
export function exactReportRoot(
  line: string,
  limits: ReportSearchLimits,
  multipv: number,
): string | null;
export function runBoundedUciReport(options: {
  limits: ReportSearchLimits;
  multipv: number;
  runSearch: (
    command: string,
    onInfo: (line: string) => void,
    signal?: AbortSignal,
    timeoutMs?: number,
  ) => Promise<string>;
  onInfo: (line: string) => void;
  signal?: AbortSignal;
  setMultiPv?: (value: number) => void | Promise<void>;
  now?: () => number;
}): Promise<string>;
