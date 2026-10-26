export const ENGINE_SEARCH_PROTOCOL_VERSION: 1;
export type EngineSearchLimit = Readonly<
  { version: 1; mode: "depth" | "time" | "nodes"; value: number } | { version: 1; mode: "infinite" }
>;
export function engineSearchCapability(maxDepth?: number): Readonly<{
  depth: Readonly<{ min: number; max: number }>;
  timeMs: Readonly<{ min: number; max: number }>;
  nodes: Readonly<{ min: number; max: number }>;
  infinite: true;
}>;
export function captureEngineSearchLimit(value: unknown, maxDepth?: number): EngineSearchLimit;
export function parseEngineSearchRequest(
  body: unknown,
  maxDepth?: number,
): EngineSearchLimit | null;
export function engineSearchCommand(limit: EngineSearchLimit): string;
export function engineSearchTimeout(limit: EngineSearchLimit): number | null;
