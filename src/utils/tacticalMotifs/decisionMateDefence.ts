import type { Chess } from "chessops/chess";
import { makeSan } from "chessops/san";
import type { NormalMove } from "chessops/types";
import { makeUci, opposite } from "chessops/util";
import { legalMoves, mayGiveCheck, replayTacticalLine } from "./causalTactics";
import type { DecisionEngineLine } from "./decisionEvidence";

export type ImmediateMateDefence = {
    fen: string;
    defenceUci: string;
    exampleLineUci: [string, string];
    exampleWasSearched: boolean;
    defendedLineUci?: [string, string, string];
    description: string;
};

function played(position: Chess, move: NormalMove) {
    const next = position.clone();
    next.play(move);
    return next;
}

function mateInOne(position: Chess) {
    return legalMoves(position).filter(
        (move) => mayGiveCheck(position, move) && played(position, move).isCheckmate(),
    );
}

/** After a real legal alternative, the same pre-existing threat must still
 * deliver mate. A synthetic change of side to move is only a nomination. */
function matchMate(position: Chess, threats: NormalMove[]) {
    return threats.find((move) => position.isLegal(move) && played(position, move).isCheckmate());
}

/** Show why a non-checking engine choice matters defensively. The result
 * concerns mate on the very next move and does not settle longer threats. */
export function findImmediateMateDefence(
    fen: string,
    candidates: DecisionEngineLine[],
    allowQuietExample = true,
): ImmediateMateDefence | null {
    const leading = candidates[0];
    if (
        !leading ||
        leading.cp === null ||
        leading.mate != null ||
        leading.depth < 16 ||
        leading.lowerbound ||
        leading.upperbound
    )
        return null;
    const [defence] = replayTacticalLine(fen, leading.pvUci.slice(0, 1));
    if (
        !defence ||
        defence.after.isCheck() ||
        defence.before.isCheck() ||
        defence.before.halfmoves >= 99
    )
        return null;

    const root = defence.before;
    const opposingTurn = root.clone();
    opposingTurn.turn = opposite(root.turn);
    opposingTurn.epSquare = undefined;
    const threats = mateInOne(opposingTurn);
    if (!threats.length || defence.after.isEnd() || mateInOne(defence.after).length) return null;

    const certificate = (
        alternative: NormalMove,
        reached: Chess,
        alternativeUci: string,
        searched: boolean,
    ): ImmediateMateDefence | null => {
        if (reached.isEnd()) return null;
        const mate = matchMate(reached, threats);
        if (!mate) return null;
        const alternativeSan = makeSan(root, alternative);
        const mateSan = makeSan(reached, mate);
        const attempt = defence.after.isLegal(mate) ? played(defence.after, mate) : null;
        const answer = attempt?.isCheck() ? legalMoves(attempt)[0] : undefined;
        return {
            fen,
            defenceUci: defence.uci,
            exampleLineUci: [alternativeUci, makeUci(mate)],
            exampleWasSearched: searched,
            ...(answer && { defendedLineUci: [defence.uci, makeUci(mate), makeUci(answer)] }),
            description: `${defence.san} prevents immediate mate. For example, ${alternativeSan} allows ${mateSan}.`,
        };
    };
    for (const candidate of candidates.slice(1)) {
        const [alternative] = replayTacticalLine(fen, candidate.pvUci.slice(0, 1));
        if (!alternative || alternative.after.isCheck() || alternative.uci === defence.uci)
            continue;
        const result = certificate(alternative.move, alternative.after, alternative.uci, true);
        if (result) return result;
    }
    if (!allowQuietExample) return null;
    for (const move of legalMoves(root)) {
        if (
            move.promotion ||
            root.board.get(move.from)?.role === "king" ||
            root.board.get(move.to) ||
            (root.board.get(move.from)?.role === "pawn" && move.to === root.epSquare)
        )
            continue;
        const moveUci = makeUci(move);
        if (moveUci === defence.uci) continue;
        const reached = played(root, move);
        if (reached.isCheck()) continue;
        const result = certificate(move, reached, moveUci, false);
        if (result) return result;
    }
    return null;
}
