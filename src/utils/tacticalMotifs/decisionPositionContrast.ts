import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "./causalTactics";
import { measurePositionDecision, type DecisionEngineLine } from "./decisionEvidence";
import { compareTacticalMistakeEpisode } from "./tacticalMistakeEpisode";

function replyFromRoot(fen: string, line: DecisionEngineLine) {
    const move = replayTacticalLine(fen, line.pvUci.slice(0, 1))[0];
    if (!move || line.cp === null || line.mate != null || line.pvUci.length < 2) return null;
    return {
        fen: makeFen(move.after.toSetup()),
        depth: line.depth,
        cp: -line.cp,
        pvUci: line.pvUci.slice(1),
    };
}

/** Test one high-ranked alternative. The root line can nominate a concrete
 * refutation for a separate search, but cannot corroborate itself. */
export function nominatePositionRefutation(fen: string, candidates: DecisionEngineLine[]) {
    const [best, second] = candidates;
    if (
        !best ||
        !second ||
        best.depth < 16 ||
        best.cp === null ||
        second.cp === null ||
        best.cp - second.cp < 100 ||
        measurePositionDecision(fen, candidates)?.bestSecondGapCp == null
    )
        return null;
    const defence = replyFromRoot(fen, best);
    if (!defence) return null;
    for (const alternative of candidates.slice(1, 3)) {
        // A third choice can be informative if it is in the same evaluation
        // band as the runner-up. Avoid comparing with a clearly worse move.
        if (alternative.cp === null || second.cp - alternative.cp > 50) break;
        const reply = replyFromRoot(fen, alternative);
        if (reply && compareTacticalMistakeEpisode(fen, best, alternative, reply, defence))
            return { moveUci: alternative.pvUci[0], fen: reply.fen, best, alternative, defence };
    }
    return null;
}

export function confirmPositionRefutation(
    fen: string,
    nomination: NonNullable<ReturnType<typeof nominatePositionRefutation>>,
    reply: DecisionEngineLine,
) {
    // The two independent searches must find the same entry to the tactic.
    if (nomination.alternative.pvUci[1] !== reply.pvUci[0]) return null;
    return compareTacticalMistakeEpisode(
        fen,
        nomination.best,
        nomination.alternative,
        reply,
        nomination.defence,
    );
}
