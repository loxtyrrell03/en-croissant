import { makeSquare } from "chessops/util";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    tacticalCaptureGain,
    tacticalExchangeGain,
} from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";

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
