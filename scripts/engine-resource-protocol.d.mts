import type { CpuResourcePreset } from "./engine-resource-presets.mjs";
export type CpuResourceSelection = Readonly<{ version: 1; threads: number; hashMb: number }>;
export const CPU_RESOURCE_PROTOCOL_VERSION: 1;
export const CPU_RESOURCE_CAPABILITY: Readonly<{
  threads: Readonly<{ min: 1; max: 64 }>;
  hashMb: Readonly<{ min: 16; max: 8192 }>;
  presets: readonly Readonly<{ id: CpuResourcePreset; label: string }>[];
}>;
export function parseCpuResourceRequest(
  body: unknown,
  engineKind: string,
): CpuResourceSelection | null;
export function cpuResourceSpinOption(
  line: string,
): { name: "Threads" | "Hash"; min: number; max: number } | null;
export function validateCpuResourceOptions(
  values: CpuResourceSelection,
  options: ReadonlyMap<string, { min: number; max: number }>,
): void;
