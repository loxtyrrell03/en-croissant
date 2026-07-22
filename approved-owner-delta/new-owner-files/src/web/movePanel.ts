import type { WebPrepLineMove } from "./model";

export function getWebMovePanelDisplayLines(
    activeLine: WebPrepLineMove[],
    sourceRootLines: WebPrepLineMove[][],
) {
    const sourceLines = sourceRootLines.filter((line) => line.length > 0);
    if (sourceLines.length > 0) return sourceLines;
    return activeLine.length > 0 ? [activeLine] : [];
}

export function getWebMovePanelBranchLine(
    parentLine: WebPrepLineMove[],
    branchMoves: WebPrepLineMove[],
) {
    return [...parentLine, ...branchMoves];
}
