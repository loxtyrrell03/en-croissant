import type { WebPrepLineMove } from "./model";

export function getWebMovePanelDisplayLines(
    activeLine: WebPrepLineMove[],
    sourceRootLines: WebPrepLineMove[][],
) {
    const sourceLines = sourceRootLines.filter((line) => line.length > 0);
    if (sourceLines.length === 0) return activeLine.length > 0 ? [activeLine] : [];
    if (
        activeLine.length > 0 &&
        !sourceLines.some((line) => webMovePanelBranchContainsLine(line, activeLine, 0))
    ) {
        // A board line that deviates from the source game would otherwise be
        // invisible in the panel while Next/End still walk it.
        return [...sourceLines, activeLine];
    }
    return sourceLines;
}

export function getWebMovePanelBranchLine(
    parentLine: WebPrepLineMove[],
    branchMoves: WebPrepLineMove[],
) {
    return [...parentLine, ...branchMoves];
}

function webMovePanelBranchContainsLine(
    branch: WebPrepLineMove[],
    activeLine: WebPrepLineMove[],
    startPly: number,
): boolean {
    let ply = startPly;
    for (const move of branch) {
        if (ply >= activeLine.length) return true;
        const target = activeLine[ply];
        if (move.san !== target.san || move.fenAfter !== target.fenAfter) return false;
        ply += 1;
        if (ply >= activeLine.length) return true;
        // Variations attached to a move are alternative continuations after it
        // (mirrors how MovesUnderBoardPanel renders them).
        if (
            (move.variations ?? []).some((variation) =>
                webMovePanelBranchContainsLine(variation, activeLine, ply),
            )
        ) {
            return true;
        }
    }
    return ply >= activeLine.length;
}
