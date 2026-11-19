import type { Chess } from "chessops/chess";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { ComparativePositionalEvidence } from "./positionalTransitions";

const rank = (square: Square, side: Color) =>
    side === "white" ? 1 + Math.floor(square / 8) : 8 - Math.floor(square / 8);
const passed = (board: Chess, square: Square, side: Color) =>
    ![...board.board.pawn.intersect(board.board[opposite(side)])].some(
        (enemy) =>
            Math.abs((enemy % 8) - (square % 8)) <= 1 && rank(enemy, side) > rank(square, side),
    );

/** Track the original pawn across captures, including en passant. */
function pawnRoute(steps: TacticalReplayStep[], origin: Square, side: Color) {
    const positions: { square: Square; advanced: boolean }[] = [];
    let square = origin;
    for (const step of steps) {
        if (step.before.turn === side && step.move.from === square) square = step.move.to;
        else if (step.before.turn !== side && step.capture) {
            const ep =
                step.before.epSquare === step.move.to &&
                step.before.board.get(step.move.from)?.role === "pawn";
            const taken = ep
                ? step.move.to + (step.before.turn === "white" ? -8 : 8)
                : step.move.to;
            if (taken === square) break;
        }
        const pawn = step.after.board.get(square);
        if (pawn?.role !== "pawn" || pawn.color !== side) break;
        positions.push({
            square,
            advanced: rank(square, side) >= 5 && passed(step.after, square, side),
        });
    }
    return positions;
}

function pawnEpisodes(steps: TacticalReplayStep[], moverGains: boolean) {
    const [root, reply] = steps;
    if (
        !root ||
        !reply?.capture ||
        root.before.board.get(root.move.from)?.role !== "pawn" ||
        reply.before.board.get(reply.move.from)?.role !== "pawn"
    )
        return [];
    const ep = reply.before.epSquare === reply.move.to;
    const taken = ep ? reply.move.to + (reply.before.turn === "white" ? -8 : 8) : reply.move.to;
    if (taken !== root.move.to) return [];

    const mover = root.before.turn;
    const side = moverGains ? mover : opposite(mover);
    // An adjacent pawn can be freed by drawing its blocker off-file.
    // Conversely the capturing pawn can become the newly advanced passer.
    const origins = moverGains
        ? [...root.before.board.pawn.intersect(root.before.board[mover])].filter(
              (square) => square !== root.move.from && square % 8 === reply.move.from % 8,
          )
        : [reply.move.from];
    return origins.flatMap((origin) => {
        const afterCapture = moverGains ? origin : reply.move.to;
        if (passed(root.before, origin, side) || !passed(reply.after, afterCapture, side))
            return [];
        const route = pawnRoute(steps, origin, side);
        const start = route.findIndex((item, index) => index >= 1 && item.advanced);
        if (
            start < 0 ||
            start > 5 ||
            route.length < start + 4 ||
            !route.slice(start, start + 4).every((item) => item.advanced)
        )
            return [];
        return [
            { origin, side, square: route[start].square, firstPly: start + 1, lastPly: start + 4 },
        ];
    });
}

/** A pawn break or concession can create the strategic difference on a
 * subsequent ply. Both searches must preserve the same advanced passer,
 * and neither comparison can recover it within the same bounded window. */
export function comparePawnEpisodes(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
): ComparativePositionalEvidence[] {
    if (
        better.cp === null ||
        played.cp === null ||
        betterReply.cp === null ||
        playedReply.cp === null ||
        [better, played, betterReply, playedReply].some((line) => line.mate != null) ||
        better.cp - played.cp < 60 ||
        playedReply.cp - betterReply.cp <= 20
    )
        return [];
    const expand = (choice: DecisionEngineLine, reply: DecisionEngineLine) => ({
        ...choice,
        pvUci: [choice.pvUci[0], ...reply.pvUci],
    });
    const legal = (line: DecisionEngineLine) => {
        const measured = measureDecisionLine(fen, line);
        return measured && !measured.drawnEnding
            ? replayTacticalLine(fen, line.pvUci.slice(0, 12))
            : [];
    };
    const stronger = [legal(better), legal(expand(better, betterReply))];
    const weaker = [legal(played), legal(expand(played, playedReply))];
    if ([...stronger, ...weaker].some((line) => line.length < 6)) return [];
    const found: ComparativePositionalEvidence[] = [];
    for (const moverGains of [true, false]) {
        const source = moverGains ? stronger : weaker;
        const alternatives = moverGains ? weaker : stronger;
        const alternateEpisode = pawnEpisodes(source[1], moverGains);
        for (const item of pawnEpisodes(source[0], moverGains)) {
            if (
                !alternateEpisode.some(
                    (other) => other.origin === item.origin && other.square === item.square,
                )
            )
                continue;
            const horizon = Math.max(
                item.lastPly,
                ...alternateEpisode
                    .filter((other) => other.origin === item.origin && other.square === item.square)
                    .map((other) => other.lastPly),
            );
            if (
                alternatives.some(
                    (line) =>
                        line.length < horizon ||
                        pawnRoute(line.slice(0, horizon), item.origin, item.side).some(
                            ({ advanced }) => advanced,
                        ),
                )
            )
                continue;
            const [first, second] = source[0];
            found.push({
                feature: "passed-pawn",
                side: item.side,
                squareOrFile: makeSquare(item.square)[0],
                description: `${first.san} ${second.san} changes the pawn structure. In both searches the pawn from ${makeSquare(item.origin)} becomes an advanced passer on ${makeSquare(item.square)} and stays passed through subsequent moves.`,
                firstPly: item.firstPly,
                lastConsecutivePly: item.lastPly,
                support: "board-fact",
                comparisonMoveUci: (moverGains ? played : better).pvUci[0],
                comparisonGapCp: better.cp - played.cp,
                supportInComparison: false,
                comparison: "alternative-choice",
                interpretation: "heuristic",
            });
        }
    }
    return found;
}
