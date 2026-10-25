import type { BestMoves } from "@/bindings";
import type { Engine } from "./engines";

export const NATIVE_STORED_EVALUATIONS_KEY = "local-engine-stored-evaluations";

export function storedEvaluationsAllowed(type: Engine["type"] | undefined, enabled: boolean) {
    return enabled || (type !== undefined && type !== "local");
}
export function visibleEngineLines(
    lines: BestMoves[] | undefined,
    type: Engine["type"] | undefined,
    enabled: boolean,
    sourceEpoch?: number,
): BestMoves[] | undefined {
    if (!lines) return lines;
    const selected = lines.filter((line) => {
        const source = (line as { source?: unknown }).source;
        if (
            sourceEpoch !== undefined &&
            source === "lichess" &&
            (line.evaluationSourceEpoch ?? 0) !== sourceEpoch
        )
            return false;
        return (
            storedEvaluationsAllowed(type, enabled) ||
            (source !== "lichess" && source !== "lichess-cloud" && source !== "chessdb")
        );
    });
    return selected.length === lines.length ? lines : selected.length ? selected : undefined;
}
export function visibleEngineMoveCache(
    cache: Map<string, BestMoves[]>,
    type: Engine["type"] | undefined,
    enabled: boolean,
    sourceEpoch?: number,
): Map<string, BestMoves[]> {
    let next: Map<string, BestMoves[]> | undefined;
    for (const [key, lines] of cache) {
        const selected = visibleEngineLines(lines, type, enabled, sourceEpoch);
        if (selected !== lines) {
            next ??= new Map(cache);
            if (selected) next.set(key, selected);
            else next.delete(key);
        }
    }
    return next ?? cache;
}
