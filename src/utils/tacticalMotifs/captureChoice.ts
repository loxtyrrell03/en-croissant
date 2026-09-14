import { makeSquare } from "chessops/util";
import { replayTacticalLine, tacticalExchangeGain, type TacticalReplayStep } from "./causalTactics";
import type { TacticalMotifEvidence } from "./types";

function capturedPiece(step: TacticalReplayStep) {
    const square = step.before.board.has(step.move.to)
        ? step.move.to
        : step.move.to + (step.before.turn === "white" ? -8 : 8);
    return `the ${step.before.board.get(square)?.role} on ${makeSquare(square)}`;
}

/** Compare only the two capture-square exchanges, not whole-position safety.
 * This can disqualify a generic capture as the established reason for choosing
 * one move over another; it cannot prove the moves equally good or replace an
 * independently verified fork, pin, mate, or other connected mechanism. */
export function qualifyComparableCaptureChoice(
    fen: string,
    bestMove: string | null,
    playedMove: string | null,
    motifs: TacticalMotifEvidence[],
): TacticalMotifEvidence[] {
    if (
        !bestMove ||
        !playedMove ||
        bestMove === playedMove ||
        !motifs.some(
            (motif) =>
                motif.source === "missed" &&
                motif.id === "hangingPiece" &&
                motif.ply === 1 &&
                motif.moveUci === bestMove &&
                !motif.verifiedCombination,
        )
    )
        return motifs;
    const best = replayTacticalLine(fen, [bestMove])[0];
    const played = replayTacticalLine(fen, [playedMove])[0];
    if (
        !best ||
        !played ||
        !best.capture ||
        !played.capture ||
        best.move.promotion ||
        played.move.promotion
    )
        return motifs;
    const bestGain = tacticalExchangeGain(best.before, best.move);
    const playedGain = tacticalExchangeGain(played.before, played.move);
    // Less than a pawn of exchange difference is not itself a compelling
    // missed-material lesson. In particular, bishop versus knight is 10 cp.
    // Negative/zero/exhausted exchanges cannot fund this qualification.
    if (bestGain <= 0 || playedGain <= 0 || bestGain - playedGain >= 90) return motifs;
    const comparison =
        Math.abs(bestGain - playedGain) < 90
            ? "Their immediate exchanges are comparable"
            : "Your move has the larger immediate exchange gain";
    return motifs.map((motif) =>
        motif.source === "missed" &&
        motif.id === "hangingPiece" &&
        motif.ply === 1 &&
        motif.moveUci === bestMove &&
        !motif.verifiedCombination
            ? {
                  ...motif,
                  alternativeCapture: true,
                  comparisonEvidence: `${best.san} captures ${capturedPiece(best)}; ${played.san} captures ${capturedPiece(played)}. ${comparison}, so the capture alone is not a verified explanation of why the move was worse.`,
              }
            : motif,
    );
}
