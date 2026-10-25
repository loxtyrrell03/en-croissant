import type { PcEngineKind } from "@/utils/lc0Networks";
import type { WebEngineLine } from "./model";

export type LiveEnginePolicy = { engineKind: PcEngineKind; useStoredEvaluations: boolean };
export type LiveEngineSnapshot = { fen: string; lines: WebEngineLine[] };
export function visibleWebEngineLines(lines: WebEngineLine[], policy: LiveEnginePolicy) {
    const selected = lines.filter((line) =>
        policy.engineKind === "lc0"
            ? line.source === "lc0"
            : line.source === "stockfish" ||
              (policy.useStoredEvaluations && line.source === "lichess-cloud"),
    );
    return selected.length === lines.length ? lines : selected;
}
/** Keep a real prior score during retargeting, never a disallowed stored/model score. */
export function retainWebEngineAnalysis(
    previous: LiveEngineSnapshot | null,
    fen: string,
    lines: WebEngineLine[],
    policy?: LiveEnginePolicy,
): LiveEngineSnapshot | null {
    const selected = policy ? visibleWebEngineLines(lines, policy) : lines;
    if (selected.length) return { fen, lines: selected };
    if (!previous || !policy) return previous;
    const retained = visibleWebEngineLines(previous.lines, policy);
    return retained.length
        ? retained === previous.lines
            ? previous
            : { ...previous, lines: retained }
        : null;
}
