import { getPGN, parsePGN } from "@/utils/chess";
import { getChesscomGame } from "@/utils/chess.com/api";
import { getChessComGameLinkFromPgn } from "@/utils/chess.com/links";
import { treeIteratorMainLine, type TreeState } from "@/utils/treeReducer";

const TIMING_COMMENT_REGEX = /\[%(?:clk|timestamp)\b/i;

function hasPgnTiming(pgn: string) {
    return TIMING_COMMENT_REGEX.test(pgn);
}

function copyMainlineTiming(target: TreeState, source: TreeState) {
    const targetMoves = [...treeIteratorMainLine(target.root)].slice(1);
    const sourceMoves = [...treeIteratorMainLine(source.root)].slice(1);
    let changed = false;

    for (let i = 0; i < Math.min(targetMoves.length, sourceMoves.length); i++) {
        const targetNode = targetMoves[i].node;
        const sourceNode = sourceMoves[i].node;
        if (targetNode.san !== sourceNode.san) break;

        if (targetNode.clock === undefined && sourceNode.clock !== undefined) {
            targetNode.clock = sourceNode.clock;
            changed = true;
        }
        if (targetNode.timestamp === undefined && sourceNode.timestamp !== undefined) {
            targetNode.timestamp = sourceNode.timestamp;
            changed = true;
        }
    }

    return changed;
}

export async function hydrateOnlinePgnClocks(pgn: string): Promise<string> {
    if (!pgn.trim() || hasPgnTiming(pgn)) return pgn;

    const chessComLink = getChessComGameLinkFromPgn(pgn);
    if (!chessComLink) return pgn;

    let clockedPgn: string | null = null;
    try {
        clockedPgn = await getChesscomGame(chessComLink, { silent: true });
    } catch {
        return pgn;
    }

    if (!clockedPgn || !hasPgnTiming(clockedPgn)) return pgn;

    let targetTree: TreeState;
    let sourceTree: TreeState;
    try {
        targetTree = await parsePGN(pgn);
        sourceTree = await parsePGN(clockedPgn);
    } catch {
        return pgn;
    }
    if (!copyMainlineTiming(targetTree, sourceTree)) return pgn;

    return getPGN(targetTree.root, {
        headers: targetTree.headers,
        comments: true,
        extraMarkups: true,
        glyphs: true,
        variations: true,
    });
}
