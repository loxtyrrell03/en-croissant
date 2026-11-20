import {
    endPairedLineAtDeadDraw,
    isDecisionDrawScore,
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "./decisionEvidence";
import type { TacticalGameHistory } from "./gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";

export function canStartDecisionSearch(fen: string, history?: TacticalGameHistory) {
    if (!history) return true;
    const reached = readTacticalRepetitionContext(fen, history);
    return !!reached && reached.endedAtPly === undefined;
}

function boundedSearchLine(
    fen: string,
    supplied: DecisionEngineLine,
    history?: TacticalGameHistory,
): DecisionEngineLine | null {
    const measured = measureDecisionLine(fen, supplied);
    const line = measured ? supplied : endPairedLineAtDeadDraw(fen, supplied);
    const valid = () => measured || measureDecisionLine(fen, line);
    if (!history) return valid() ? line : null;
    let context = readTacticalRepetitionContext(fen, history);
    if (!context || context.endedAtPly !== undefined) return null;

    const asDraw = (plies: number) => {
        const bounded = { ...line, pvUci: line.pvUci.slice(0, plies), claimHistory: history };
        return measureDecisionLine(fen, bounded) ? bounded : null;
    };
    const sign = Math.sign(line.mate ?? line.cp ?? 0);
    const decisive = line.mate != null || Math.abs(line.cp ?? 0) > 50;
    for (let ply = 0; ply <= line.pvUci.length; ply++) {
        const claim = tacticalRepetitionClaim(context);
        if (claim) {
            if (isDecisionDrawScore(line)) {
                if (ply) return asDraw(ply);
                // A completed MultiPV choice still needs a move. Keep it
                // only if that exact move would produce the third occurrence.
                const next = advanceTacticalRepetitionContext(context, line.pvUci[0]);
                return next && next.currentCount >= 3 ? asDraw(1) : null;
            }
            const claimantFavoured = decisive && sign === (ply % 2 === 0 ? 1 : -1);
            if (context.endedAtPly !== undefined || !claimantFavoured) return null;
        }
        if (ply === line.pvUci.length) break;
        context = advanceTacticalRepetitionContext(context, line.pvUci[ply]);
        if (!context) return null;
    }
    return valid() ? line : null;
}

/** Keep a complete, legal frame. A recoverable draw is a scored choice,
 * with the evidence bounded at the claim or terminal board. */
export function validateDecisionSearchFrame(
    fen: string,
    supplied: DecisionEngineLine[],
    history?: TacticalGameHistory,
): DecisionEngineLine[] | null {
    if (!supplied.length) return null;
    const candidates: DecisionEngineLine[] = [];
    for (const line of supplied) {
        const bounded = boundedSearchLine(fen, line, history);
        if (!bounded) return null;
        candidates.push(bounded);
    }
    return measurePositionDecision(fen, candidates)?.lines.length === candidates.length
        ? candidates
        : null;
}
