import {
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "@/utils/tacticalMotifs/decisionEvidence";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "@/utils/tacticalMotifs/repetitionHistory";

export function validateOriginalFrame(
    fen: string,
    lines: DecisionEngineLine[],
    history?: TacticalGameHistory,
) {
    const crossesDrawClaim = (moves: string[]) => {
        if (!history) return false;
        let state = readTacticalRepetitionContext(fen, history);
        if (!state) return true;
        for (const uci of moves) {
            if (tacticalRepetitionClaim(state) || state.endedAtPly !== undefined) return true;
            state = advanceTacticalRepetitionContext(state, uci);
            if (!state) return true;
        }
        return !!tacticalRepetitionClaim(state);
    };
    if (
        !lines.length ||
        crossesDrawClaim([]) ||
        lines.some((line) => !measureDecisionLine(fen, line) || crossesDrawClaim(line.pvUci))
    )
        return null;
    return measurePositionDecision(fen, lines)?.lines.length === lines.length ? lines : null;
}
