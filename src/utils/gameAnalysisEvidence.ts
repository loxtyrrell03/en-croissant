import type { Color } from "chessops";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import type { ScoreValue } from "@/bindings";
import { positionFromFen } from "./chessops";
import { scoreValueToCentipawns } from "./score";
import { treeIteratorMainLine, type TreeNode } from "./treeReducer";

/** Read-only report evidence. Repetition/terminal results follow the complete
 * legal main line, rather than guessing a final result from an engine score. */
export function gameAnalysisEvidence(root: TreeNode) {
    const [board] = positionFromFen(root.fen);
    const startColor: Color = board?.turn ?? (root.halfMoves % 2 === 0 ? "white" : "black");
    const entries = [...treeIteratorMainLine(root)].slice(1);
    const validScore = (score: ScoreValue | null | undefined): ScoreValue | null =>
        score && scoreValueToCentipawns(score) !== null ? score : null;
    const initialScore = board && makeFen(board.toSetup()) === INITIAL_FEN
        ? { type: "cp" as const, value: 15 } : validScore(root.score?.value);
    const repetitions = new Map<string, number>();
    const key = () => makeFen(board!.toSetup()).split(" ").slice(0, 4).join(" ");
    if (board) repetitions.set(key(), 1);
    let validHistory = !!board;
    const scores = entries.map(({ node }): ScoreValue | null => {
        if (!board || !validHistory) return null;
        const move = node.move ?? (node.san ? parseSan(board, node.san) : undefined);
        if (!move || !board.isLegal(move)) { validHistory = false; return null; }
        board.play(move);
        const [saved] = positionFromFen(node.fen);
        if (!saved || makeFen(saved.toSetup()) !== makeFen(board.toSetup())) {
            validHistory = false; return null;
        }
        const count = (repetitions.get(key()) ?? 0) + 1;
        repetitions.set(key(), count);
        if (board.isCheckmate()) return { type: "mate", value: board.turn === "white" ? -1 : 1 };
        if (board.isEnd() || board.halfmoves >= 100 || count >= 3) return { type: "cp", value: 0 };
        return validScore(node.score?.value);
    });
    return { entries, initialScore, startColor, scores };
}
