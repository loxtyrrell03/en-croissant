import { makeFen } from "chessops/fen";
import type { Color } from "chessops/types";
import { opposite } from "chessops/util";
import { replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";

export type ConfirmedMatingLines = {
    fen: string;
    winner: Color;
    mateIn: number;
    rootLineUci: string[];
    replyLineUci: string[];
};

function terminalMate(fen: string, line: DecisionEngineLine) {
    if (line.cp !== null || line.mate == null || line.depth < 16) return false;
    const measured = measureDecisionLine(fen, line);
    const expectedPlies = 2 * Math.abs(line.mate) - Number(line.mate > 0);
    return measured?.checkmate === true && measured.plies === expectedPlies;
}

/** The two complete legal lines must agree on the winning side and on
 * the reported distance after accounting for the move already played. */
export function corroborateMatingLines(
    fen: string,
    root: DecisionEngineLine,
    reply: DecisionEngineLine | undefined,
): ConfirmedMatingLines | null {
    if (root.mate == null || !reply) return null;
    const remaining = root.mate > 0 ? 1 - root.mate : -root.mate;
    if (reply.mate !== remaining || !terminalMate(fen, root)) return null;
    const [first] = replayTacticalLine(fen, root.pvUci.slice(0, 1));
    if (!first || !terminalMate(makeFen(first.after.toSetup()), reply)) return null;
    return {
        fen,
        winner: root.mate > 0 ? first.before.turn : opposite(first.before.turn),
        mateIn: Math.abs(root.mate),
        rootLineUci: root.pvUci,
        replyLineUci: [first.uci, ...reply.pvUci],
    };
}
