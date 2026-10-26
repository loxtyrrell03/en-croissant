import type { GoMode } from "@/bindings";
import type { WebEngineLine } from "./model";
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
export function phoneSearchSummary(go: GoMode): string {
    if (go.t === "Infinite") return "Until stopped";
    if (go.t === "Time")
        return go.c < 1000
            ? `${number(go.c)} ms per position`
            : `${number(go.c / 1000)} s per position`;
    if (go.t === "Nodes") return `${number(go.c)} nodes per position`;
    return go.t === "Depth" ? `Depth ${number(go.c)}` : "Player clocks";
}
/** Stored evaluations and queue/wake time are not progress made by this search. */
export function phoneSearchProgress(
    enabled: boolean,
    status: string,
    lines: WebEngineLine[],
    go: GoMode,
): { value: number | null; label: string } {
    if (!enabled || status === "idle") return { value: 0, label: "Analysis paused" };
    if (status === "error") return { value: 0, label: "Analysis unavailable" };
    const summary = phoneSearchSummary(go);
    if (status === "complete") return { value: 100, label: `Search complete · ${summary}` };
    if (go.t === "Infinite" || go.t === "PlayersTime")
        return { value: null, label: `Analysing · ${summary}` };
    const live = lines.filter((line) => line.source !== "lichess-cloud");
    const field = go.t === "Depth" ? "depth" : go.t === "Time" ? "timeMs" : "nodes";
    const known = live
        .map((line) => line[field])
        .filter(
            (value): value is number =>
                typeof value === "number" && Number.isFinite(value) && value >= 0,
        );
    if (!known.length) return { value: null, label: `Waiting for engine progress · ${summary}` };
    const reached = Math.max(...known),
        value = Math.max(0, Math.min(99, Math.round((reached / Math.max(1, go.c)) * 100)));
    const label =
        go.t === "Depth"
            ? `Depth ${number(reached)} of ${number(go.c)}`
            : go.t === "Time"
              ? `Engine time ${number(reached)} ms · limit ${summary}`
              : `${number(reached)} nodes examined · limit ${summary}`;
    return { value, label };
}
