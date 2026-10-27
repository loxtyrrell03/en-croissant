import type { WebPrepLineMove } from "./model";

/** Optional persisted tree. Reject malformed/cyclic additions without rewriting storage. */
export function validPhoneMoveTree(value: unknown): boolean {
    if (value === undefined) return true;
    if (!Array.isArray(value)) return false;
    const pending: { lines: unknown; exit?: boolean }[] = [{ lines: value }];
    const ancestors = new Set<unknown>();
    while (pending.length) {
        const item = pending.pop()!;
        if (item.exit) {
            ancestors.delete(item.lines);
            continue;
        }
        if (!Array.isArray(item.lines) || ancestors.has(item.lines)) return false;
        ancestors.add(item.lines);
        pending.push({ lines: item.lines, exit: true });
        for (const line of item.lines) {
            if (!Array.isArray(line)) return false;
            for (const move of line) {
                if (
                    !move ||
                    typeof move !== "object" ||
                    typeof move.fenBefore !== "string" ||
                    typeof move.fenAfter !== "string" ||
                    typeof move.san !== "string" ||
                    (move.uci !== null && typeof move.uci !== "string") ||
                    (move.actor !== "user" && move.actor !== "opponent")
                )
                    return false;
                if (move.variations !== undefined) pending.push({ lines: move.variations });
            }
        }
    }
    return true;
}

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
