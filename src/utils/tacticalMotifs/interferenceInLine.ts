import { attacks, between } from "chessops/attacks";
import { castlingSide } from "chessops/chess";
import type { Square } from "chessops/types";
import { makeSquare } from "chessops/util";
import {
    tacticalCaptureGain,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";

const MIN_GAIN = 100;

function stayedThrough(steps: TacticalReplayStep[], until: number, ...squares: Square[]) {
    return steps
        .slice(0, until)
        .every(
            ({ before, move }) =>
                !castlingSide(before, move) &&
                !squares.includes(move.from) &&
                !squares.includes(move.to),
        );
}

/** The shown capture uses a cut in the original defender's recapture
 * route. Check the earlier defence and restore exactly that route after
 * the capture. A blocked geometric ray alone cannot establish interference. */
export function findInterferenceInLine(
    steps: TacticalReplayStep[],
    material: boolean,
    mate: boolean,
) {
    const [root] = steps;
    const { from: source, to: block } = root.move;
    const side = root.before.turn;
    const blocker = root.after.board.get(block);
    if (!blocker || blocker.color !== side || blocker.role === "king" || root.move.promotion)
        return null;
    for (let index = 2; index < Math.min(steps.length, 9); index += 2) {
        const payoff = steps[index];
        const { from, to, promotion } = payoff.move;
        if (
            !payoff.capture ||
            promotion ||
            from === source ||
            from === block ||
            to === source ||
            !root.before.board.has(to) ||
            !stayedThrough(steps.slice(1), index - 1, block, from, to)
        )
            continue;
        const endingInMate = mate && payoff.after.isCheckmate();
        if (!endingInMate && !material) continue;
        const original = root.before;
        if (!original.isLegal(payoff.move)) continue;
        const originalPayoff = original.clone();
        originalPayoff.play(payoff.move);
        const king = payoff.after.board.kingOf(payoff.after.turn);
        // Taking a second checking piece off the board is not a clean
        // test of what opening the guard's line alone would change.
        if (
            endingInMate &&
            king !== undefined &&
            attacks(blocker, block, payoff.after.board.occupied).has(king)
        )
            continue;
        for (const guard of original.board[payoff.after.turn]) {
            const piece = original.board.get(guard)!;
            if (
                !["bishop", "rook", "queen"].includes(piece.role) ||
                !between(guard, to).has(block) ||
                !stayedThrough(steps, index, guard)
            )
                continue;
            const recapture = { from: guard, to };
            if (!originalPayoff.isLegal(recapture) || payoff.after.isLegal(recapture)) continue;
            const restored = payoff.after.clone();
            restored.board.take(block);
            if (!restored.isLegal(recapture)) continue;
            const beforeGain = tacticalExchangeGain(originalPayoff, recapture);
            const restoredGain = tacticalExchangeGain(restored, recapture);
            if (!endingInMate && (beforeGain < MIN_GAIN || restoredGain < MIN_GAIN)) continue;
            const gain = endingInMate ? null : tacticalCaptureGain(payoff, 2048);
            const retained = gain === null ? null : steps[index - 1].balance + gain;
            if (!endingInMate && (gain === null || gain < MIN_GAIN || retained! < MIN_GAIN))
                continue;
            const guardSquare = makeSquare(guard);
            const target = makeSquare(to);
            return {
                id: "interference" as const,
                through: index + 1,
                text: `In this line, ${root.san} blocks the ${piece.role} on ${guardSquare} from recapturing on ${target}. ${payoff.san} uses the cut defence${endingInMate ? " to give mate" : " to win material"}.`,
                squares: [block, guard, to, from],
                outcome: endingInMate ? { mate: true as const } : { gain: retained! },
            };
        }
    }
    return null;
}
