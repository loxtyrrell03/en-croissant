import { buildEnginePlanReport } from "@/utils/enginePlanExplorer";
import type { WebEngineLine } from "./model";

export function phoneEnginePlanReport(
    fen: string,
    lines: WebEngineLine[],
    depth: number,
    multipv: number,
) {
    return buildEnginePlanReport(
        fen,
        lines
            .filter((line) => line.source === "stockfish" && line.depth <= depth)
            .map((line) => ({
                depth: line.depth,
                multipv: line.multipv,
                score: { value: line.score, wdl: null },
                uciMoves: line.uciMoves,
                sanMoves: line.sanMoves,
                nps: line.nps ?? 0,
                nodes: line.nodes ?? 0,
            })),
        { requestedMultipv: multipv, limitLabel: `Depth ${depth}` },
    );
}
