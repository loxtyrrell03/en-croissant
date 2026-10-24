export type PlanHorizon = "all" | "immediate" | "medium" | "long";
export const PLAN_HORIZONS = [
  { value: "all", label: "All" }, { value: "immediate", label: "Immediate" },
  { value: "medium", label: "Medium term" }, { value: "long", label: "Long term" },
] as const;

/** One ply is one player's move; either player's first turn is immediate. */
export function matchesPlanHorizon(ply: number | undefined, horizon: PlanHorizon): boolean {
  if (horizon === "all") return true;
  if (!Number.isSafeInteger(ply) || !ply || ply < 1) return false;
  return horizon === (ply <= 2 ? "immediate" : ply <= 6 ? "medium" : "long");
}
