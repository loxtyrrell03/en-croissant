export type EngineDevice = {
  logicalThreads: number;
  totalMemoryMb: number | null;
  availableMemoryMb: number | null;
};
export type CpuResourcePreset = "quiet" | "balanced" | "faster";
export type EngineResourceValues = { threads: number; hashMb: number };
export type EngineResourcePlan = {
  known: boolean;
  engines: number;
  maxThreads: number;
  maxHashMb: number;
  canRecommend: boolean;
  presets: Record<CpuResourcePreset, EngineResourceValues>;
};
export const CPU_RESOURCE_PRESETS: readonly {
  readonly id: CpuResourcePreset;
  readonly label: string;
}[];
export function parseEngineDevice(value: unknown): EngineDevice | null;
export function engineResourcePlan(input: unknown, engines?: number): EngineResourcePlan;
export function matchingCpuResourcePreset(
  values: EngineResourceValues,
  plan: EngineResourcePlan,
): CpuResourcePreset | "custom";
export function memoryStops(min: number, max: number, current?: number): number[];
