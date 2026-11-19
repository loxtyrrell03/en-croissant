import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import { replayTacticalLine } from "./causalTactics";
import {
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "./decisionEvidence";
import { extractTacticalSequenceWitnesses } from "./tacticalSequenceEvidence";

const REPLY_MARGIN_CP = 35;
const CRITICAL_GAP_CP = 150;
const MAX_SCORE_DRIFT_CP = 125;

export function nominatePreparedCheckpoint(
    fen: string,
    best: DecisionEngineLine,
    replies: DecisionEngineLine[],
) {
    const root = measureDecisionLine(fen, best);
    if (!root || root.drawnEnding || best.depth < 18 || best.mate != null || best.cp === null)
        return null;
    const [choice] = replayTacticalLine(fen, best.pvUci.slice(0, 1));
    const child = makeFen(choice.after.toSetup());
    const [top] = replies;
    if (
        !top ||
        top.cp === null ||
        top.mate != null ||
        top.depth < 16 ||
        Math.abs(top.cp + best.cp) > 90 ||
        !measureDecisionLine(child, top)
    )
        return null;

    for (const reply of replies.slice(0, 3)) {
        if (
            reply.cp === null ||
            reply.mate != null ||
            reply.depth !== top.depth ||
            reply.cp > top.cp ||
            top.cp - reply.cp > REPLY_MARGIN_CP ||
            !measureDecisionLine(child, reply)
        )
            continue;
        const branch = { ...best, pvUci: [choice.uci, ...reply.pvUci] };
        const candidates = extractTacticalSequenceWitnesses(fen, branch);
        for (const witness of candidates) {
            if (witness.mechanism !== "tacticalPreparation" || witness.payoffPly <= 5) continue;
            const steps = replayTacticalLine(fen, witness.lineUci);
            const criticalIndex = steps.findIndex(
                (step, at) =>
                    at >= 4 &&
                    at < 7 &&
                    step.before.turn === choice.before.turn &&
                    makeSquare(step.move.to) === witness.squares[2],
            );
            if (criticalIndex < 0) continue;
            const critical = steps[criticalIndex];
            // The destination is supplied by the preparation witness. Check
            // its underlying mechanism at the exact ply, before seeking a gap.
            if (
                !candidates.some(
                    (item) =>
                        item.mechanismPly === criticalIndex + 1 &&
                        witness.supportingMechanisms?.includes(item.mechanism),
                )
            )
                continue;
            return {
                fen: makeFen(critical.before.toSetup()),
                prefix: steps.slice(0, criticalIndex).map(({ uci }) => uci),
                moveUci: critical.uci,
                criticalSan: critical.san,
                rootSan: choice.san,
                defenceSan: steps[1].san,
                expectedCp: -reply.cp,
                witness,
            };
        }
    }
    return null;
}

/** Certify a decision inside one competitive defence's continuation.
 * The independent search verifies the choice at that board, leaving other
 * defences subject to their own lines. */
export function confirmPreparedCheckpoint(
    nomination: NonNullable<ReturnType<typeof nominatePreparedCheckpoint>>,
    lines: DecisionEngineLine[],
) {
    const evidence = measurePositionDecision(nomination.fen, lines);
    const [best, second] = lines;
    if (
        !best ||
        !second ||
        best.cp === null ||
        second.cp === null ||
        best.depth < 16 ||
        evidence?.bestSecondGapCp == null ||
        evidence.bestSecondGapCp < CRITICAL_GAP_CP ||
        best.pvUci[0] !== nomination.moveUci ||
        Math.abs(best.cp - nomination.expectedCp) > MAX_SCORE_DRIFT_CP
    )
        return null;
    const [runnerUp, alternative] = replayTacticalLine(
        nomination.fen,
        second.pvUci.slice(0, 2),
    );
    if (!runnerUp) return null;
    return {
        witness: nomination.witness,
        gapCp: evidence.bestSecondGapCp,
        alternativeUci: [
            ...nomination.prefix,
            runnerUp.uci,
            ...(alternative ? [alternative.uci] : []),
        ],
        description: `After ${nomination.rootSan}, ${nomination.defenceSan} is one of the engine's close replies. In the shown line, ${nomination.criticalSan} scores better than ${runnerUp.san} by ${(evidence.bestSecondGapCp / 100).toFixed(2)} Stockfish evaluation points in a separate search.`,
    };
}
