import { makeSquare, opposite } from "chessops/util";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    tacticalCaptureGain,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";

function takesLoosePawn(step: TacticalReplayStep) {
    const { before, after, move } = step;
    return step.capture === 100 && before.board.get(move.to)?.role === "pawn" &&
        !move.promotion && !before.isCheck() && !after.isCheck() &&
        before.kingAttackers(move.to, opposite(before.turn), before.board.occupied).isEmpty();
}

/** The loose pawn is still there after a quiet, similarly strong
 * alternative. This qualifies the immediate pawn-capture certificate,
 * without drawing conclusions about other tactical mechanisms. */
export function findDeferredPawnCapture(
    fen: string,
    line: DecisionEngineLine,
    candidates: DecisionEngineLine[],
) {
    const [capture] = replayTacticalLine(fen, line.pvUci.slice(0, 1));
    if (!capture || !takesLoosePawn(capture) || line.cp === null || line.cp < 300 || line.mate != null)
        return;
    const { from, to } = capture.move;
    const score = line.cp;
    for (const alternative of candidates) {
        if (alternative.pvUci[0] === capture.uci || alternative.depth !== line.depth ||
            alternative.mate != null || alternative.cp === null || alternative.cp < 300 ||
            Math.abs(score - alternative.cp) > 150) continue;
        const bounded = { ...alternative, pvUci: alternative.pvUci.slice(0, 10) };
        const measured = measureDecisionLine(fen, bounded);
        if (!measured || measured.drawnEnding) continue;
        const steps = replayTacticalLine(fen, bounded.pvUci);
        const first = steps[0];
        if (!first || first.capture || first.move.promotion || first.after.isCheck()) continue;
        for (const [index, step] of steps.entries()) {
            if (step.before.turn === capture.before.turn && step.move.from === from &&
                step.move.to === to && takesLoosePawn(step)) {
                return {
                    description: `The pawn on ${makeSquare(to)} can also be taken later. With ${first.san}, the engine keeps a large advantage and still plays ${step.san} in the shown line.`,
                    linesUci: [[capture.uci], bounded.pvUci.slice(0, index + 1)] as [string[], string[]],
                };
            }
            // The original capturer and original pawn must stay on their
            // squares. A later piece on either square cannot replace them.
            if (step.move.from === from || step.move.from === to || step.move.to === from ||
                step.move.to === to || !step.after.board.get(from) || !step.after.board.get(to)) break;
        }
    }
}

/** An immediate capture can be the critical tactical decision even when it
 * contains no named combination. Require a credible competing root line in
 * which the same target escapes and a separately searched reply after taking. */
export function explainFleetingCapture(
    fen: string,
    line: DecisionEngineLine,
    candidates: DecisionEngineLine[],
    independentlySearched: DecisionEngineLine,
) {
    if (line !== candidates[0] || line.cp === null) return;
    const [capture] = replayTacticalLine(fen, line.pvUci.slice(0, 1));
    if (!capture?.capture || capture.move.promotion) return;
    const square = capture.move.to;
    const target = capture.before.board.get(square);
    if (!target || target.role === "pawn") return;
    const score = line.cp;
    const alternative = candidates.slice(1).find((other) => {
        if (other.cp === null || other.depth !== line.depth || score - other.cp < 100) return false;
        if (!measureDecisionLine(fen, other)) return false;
        const [decline, escape] = replayTacticalLine(fen, other.pvUci.slice(0, 2));
        if (!decline || !escape || decline.capture || escape.move.from !== square) return false;
        const landing = escape.move.to;
        return [...escape.after.allDests()].every(([from, destinations]) => {
            if (!destinations.has(landing)) return true;
            const promotion =
                escape.after.board.get(from)?.role === "pawn" && (landing < 8 || landing >= 56)
                    ? "queen"
                    : undefined;
            const gain = tacticalExchangeGain(escape.after, { from, to: landing, promotion });
            return gain > -20000 && gain < MIN_TACTICAL_CAPTURE_GAIN;
        });
    });
    if (!alternative || (tacticalCaptureGain(capture) ?? 0) < MIN_TACTICAL_CAPTURE_GAIN) return;

    const settledGain = (branch: DecisionEngineLine, ply: number) => {
        const pvUci = branch.pvUci.slice(0, ply);
        const measured = measureDecisionLine(fen, { ...branch, pvUci });
        return (
            measured &&
            !measured.drawnEnding &&
            measured.quietEndingPlies >= 2 &&
            measured.endingMaterialRangeCp[0] === measured.endingMaterialRangeCp[1] &&
            measured.materialChangeCp >= MIN_TACTICAL_CAPTURE_GAIN
        );
    };
    const end = Math.min(line.pvUci.length, independentlySearched.pvUci.length, 9);
    for (let ply = 4; ply <= end; ply++) {
        if (!settledGain(line, ply) || !settledGain(independentlySearched, ply)) continue;
        const [decline, escape] = replayTacticalLine(fen, alternative.pvUci.slice(0, 2));
        return `${capture.san} takes the ${target.role} on ${makeSquare(square)} while it is available. After ${decline.san}, it can move away with ${escape.san}. Both searches show a material gain after the capture.`;
    }
}
