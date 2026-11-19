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

export type ExtraPositionChoice = {
    shortlist: DecisionEngineLine[];
    pair: DecisionEngineLine[];
    replies: DecisionEngineLine[];
};

/** The short search proposes a move. All evaluation and attribution comes
 * from the later paired search and the independent search after that move. */
export function pickExtraPositionMove(
    fen: string,
    candidates: DecisionEngineLine[],
    shortlist: DecisionEngineLine[],
) {
    const boardAfter = (line: DecisionEngineLine) => {
        const first = replayTacticalLine(fen, line.pvUci.slice(0, 1))[0];
        return first ? makeFen(first.after.toSetup()) : null;
    };
    const originalBoards = new Set(candidates.map(boardAfter));
    const observed = shortlist.map(boardAfter);
    if (
        originalBoards.has(null) ||
        observed.some((value) => value === null) ||
        shortlist.some((line) => line.fen !== fen || line.depth !== shortlist[0].depth) ||
        new Set(observed).size !== observed.length
    )
        return null;
    const index = observed.findIndex((value) => !originalBoards.has(value));
    return index < 0 ? null : shortlist[index].pvUci[0];
}

export function compareExtraPositionMove(
    fen: string,
    originalBest: DecisionEngineLine,
    moveUci: string,
    pair: DecisionEngineLine[],
) {
    const [best, alternative] = pair;
    if (
        pair.length !== 2 ||
        best.pvUci[0] !== originalBest.pvUci[0] ||
        alternative.pvUci[0] !== moveUci ||
        originalBest.depth < 18 ||
        best.depth < 16 ||
        originalBest.cp === null ||
        best.cp === null ||
        alternative.cp === null ||
        Math.abs(originalBest.cp - best.cp) > 90 ||
        best.cp - alternative.cp < 100 ||
        measurePositionDecision(fen, pair)?.bestSecondGapCp == null
    )
        return null;
    const response = replyFromRoot(fen, alternative);
    const defence = replyFromRoot(fen, best);
    return response && defence ? { best, alternative, fen: response.fen, defence } : null;
}

export function confirmExtraPositionChoice(
    fen: string,
    candidates: DecisionEngineLine[],
    evidence: ExtraPositionChoice,
) {
    const move = pickExtraPositionMove(fen, candidates, evidence.shortlist);
    if (!move || !candidates.length) return null;
    const pair = compareExtraPositionMove(fen, candidates[0], move, evidence.pair);
    const [reply] = evidence.replies;
    if (
        !pair ||
        !reply ||
        reply.depth < 16 ||
        reply.cp === null ||
        reply.mate != null ||
        Math.abs(pair.alternative.cp! + reply.cp) > 90 ||
        reply.pvUci[0] !== pair.alternative.pvUci[1] ||
        evidence.replies.some(
            (line, index) =>
                line.depth !== reply.depth ||
                (index > 0 &&
                    line.cp !== null &&
                    evidence.replies[index - 1].cp !== null &&
                    line.cp > evidence.replies[index - 1].cp!),
        ) ||
        measurePositionDecision(pair.fen, evidence.replies)?.lines.length !==
            evidence.replies.length
    )
        return null;
    // An extra alternative informs position character when its first reply
    // wins something or sets up a material payoff by the next opponent turn.
    // The comparison can look further to let the exchanges settle.
    return compareTacticalMistakeEpisode(fen, pair.best, pair.alternative, reply, pair.defence, 3);
}
