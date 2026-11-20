import type { Color, Piece, Square } from "chessops/types";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    type TacticalReplayStep,
} from "./causalTactics";
import { initialPieceIdentities, followPieceIdentities } from "./decisionPieceIdentity";
import type { DecisionEngineLine } from "./decisionEvidence";
import { qualifyPositionFactors } from "./decisionPositionPlans";
import type { ComparativePositionalEvidence } from "./positionalTransitions";

type Capture = { taken: Piece; square: Square; origin: Square; uci: string; settledGain: boolean };
const file = (square: Square) => square % 8;
const onColumn = (square: Square, column: number) => file(square) === column;

function traceCaptures(steps: TacticalReplayStep[]) {
    const root = steps[0].before;
    const identities = initialPieceIdentities(root);
    return steps.map((step, index): Capture | null => {
        const { move, before } = step;
        const origin = followPieceIdentities(identities, step);
        if (origin === undefined || before.turn !== root.turn || move.promotion) return null;
        const square =
            before.epSquare === move.to && before.board.get(move.from)?.role === "pawn"
                ? move.to + (before.turn === "white" ? -8 : 8)
                : move.to;
        const taken = before.board.get(square);
        if (!taken || (taken.role !== "bishop" && taken.role !== "pawn")) return null;
        let end = index;
        let captureGain = step.capture;
        // A check or counter-capture can delay the exchange. Follow the
        // occupied square and keep other captures out of the local gain.
        for (let next = index + 1; next <= end + 4 && next < steps.length; next++) {
            const reply = steps[next];
            if (reply.capture && reply.move.to === move.to) {
                if (reply.move.promotion) return null;
                if (next > end + 1 && Math.abs(captureGain) <= 50) break;
                captureGain += reply.before.turn === root.turn ? reply.capture : -reply.capture;
                end = next;
            } else if (reply.move.from === move.to) break;
        }
        const startBalance = steps[index - 1]?.balance ?? 0;
        const settle = steps.slice(end, end + 3).map(({ balance }) => balance);
        const retained = Math.max(0, startBalance) + MIN_TACTICAL_CAPTURE_GAIN;
        return {
            taken,
            square,
            origin,
            uci: step.uci,
            settledGain:
                captureGain >= MIN_TACTICAL_CAPTURE_GAIN &&
                settle.length === 3 &&
                settle.every((value) => value >= retained),
        };
    });
}

function blockers(
    steps: TacticalReplayStep[],
    index: number,
    removed: Square,
    side: Color,
    column: number,
) {
    const { after } = steps[index];
    const enemy = side === "white" ? after.board.black : after.board.white;
    const own = [...after.board.pawn.intersect(after.board[side])];
    const inFront = (pawn: Square, other: Square) =>
        side === "white" ? other >> 3 > pawn >> 3 : other >> 3 < pawn >> 3;
    return own.filter(
        (pawn) =>
            file(pawn) === column &&
            Math.abs(file(removed) - column) <= 1 &&
            inFront(pawn, removed) &&
            ![...after.board.pawn.intersect(enemy)].some(
                (other) => Math.abs(file(other) - column) <= 1 && inFront(pawn, other),
            ),
    );
}

function dependsOnCapturedPiece(
    factor: ComparativePositionalEvidence,
    steps: TacticalReplayStep[],
    index: number,
    capture: Capture,
) {
    const { taken, square } = capture;
    const { before, after } = steps[index];
    const column = factor.squareOrFile.charCodeAt(0) - 97;
    switch (factor.feature) {
        case "bishop-pair-removal": {
            const colours = (board: TacticalReplayStep["before"]) =>
                new Set(
                    [...board.board.bishop.intersect(board.board[factor.side])].map(
                        (bishop) => (file(bishop) + (bishop >> 3)) % 2,
                    ),
                ).size;
            return (
                taken.role === "bishop" &&
                taken.color === factor.side &&
                colours(before) === 2 &&
                colours(after) === 1
            );
        }
        case "isolated-pawn":
            return (
                taken.role === "pawn" &&
                taken.color === factor.side &&
                Math.abs(column - file(square)) === 1 &&
                [...after.board.pawn.intersect(after.board[factor.side])].some((pawn) =>
                    onColumn(pawn, column),
                ) &&
                ![...after.board.pawn.intersect(after.board[factor.side])].some(
                    (pawn) => Math.abs(file(pawn) - column) === 1,
                )
            );
        case "open-rook-file":
            return (
                taken.role === "pawn" &&
                taken.color !== factor.side &&
                column === file(square) &&
                ![...after.board.pawn].some((pawn) => onColumn(pawn, column)) &&
                [...after.board.rook.intersect(after.board[factor.side])].some((rook) =>
                    onColumn(rook, column),
                )
            );
        case "passed-pawn":
            return (
                taken.role === "pawn" &&
                taken.color !== factor.side &&
                blockers(steps, index, square, factor.side, column).length > 0
            );
        default:
            return false;
    }
}

function advancesPasser(
    factor: ComparativePositionalEvidence,
    steps: TacticalReplayStep[],
    index: number,
    capture: Capture,
) {
    const column = factor.squareOrFile.charCodeAt(0) - 97;
    return blockers(steps, index, capture.square, factor.side, column).some((square) => {
        for (const step of steps.slice(index + 1, factor.lastConsecutivePly)) {
            if (step.before.turn === factor.side && step.move.from === square)
                return !step.capture && !step.move.promotion && !step.after.isCheck();
            if (step.move.to === square) return false;
        }
        return false;
    });
}

/** Verify that the rooted structural observation and the material gain are
 * the same event. An independent strategic comparison still takes precedence. */
export function findCaptureEffectDependencies(
    fen: string,
    line: DecisionEngineLine,
    corroborating: DecisionEngineLine,
    factors: ComparativePositionalEvidence[],
) {
    const possible = factors.filter(
        (factor) =>
            factor.comparison === "separate-reply-search" &&
            factor.materialWindowPlies === undefined &&
            ["bishop-pair-removal", "isolated-pawn", "open-rook-file", "passed-pawn"].includes(
                factor.feature,
            ),
    );
    if (!possible.length) return [];
    const primary = replayTacticalLine(fen, line.pvUci.slice(0, 14));
    const repeated = replayTacticalLine(fen, corroborating.pvUci.slice(0, 14));
    if (!primary.length || !repeated.length) return [];
    const a = traceCaptures(primary);
    const b = traceCaptures(repeated);
    return possible.flatMap((factor) => {
        const index = factor.firstPly - 1;
        const first = a[index],
            second = b[index];
        if (
            !first ||
            !second ||
            first.uci !== second.uci ||
            first.origin !== second.origin ||
            first.taken.role !== second.taken.role ||
            first.taken.color !== second.taken.color ||
            !dependsOnCapturedPiece(factor, primary, index, first) ||
            !dependsOnCapturedPiece(factor, repeated, index, second)
        )
            return [];
        const tacticalGain = first.settledGain && second.settledGain;
        const separatelyUsed =
            factor.feature === "passed-pawn"
                ? advancesPasser(factor, primary, index, first) &&
                  advancesPasser(factor, repeated, index, second)
                : factor.feature === "open-rook-file"
                  ? qualifyPositionFactors(fen, line, [factor]).length > 0 &&
                    qualifyPositionFactors(fen, corroborating, [factor]).length > 0
                  : false;
        return [{ factor, tacticalGain, separatelyUsed, captureSan: primary[index].san }];
    });
}
