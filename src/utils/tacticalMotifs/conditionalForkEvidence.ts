import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import { replayTacticalLine, tacticalExchangeGain, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { ComparativePositionalEvidence } from "./positionalTransitions";
import type { TacticalSequenceWitness } from "./tacticalSequenceEvidence";

type ForkDefenceConsequence = {
    kind: "material" | "rook-file";
    description: string;
};

export type ConditionalForkEvidence = TacticalSequenceWitness & {
    bestReplyLineUci: string[];
    weakerReplySan: string;
    defenceConsequence: ForkDefenceConsequence | null;
};

function defenceConsequence(
    fen: string,
    root: DecisionEngineLine,
    best: DecisionEngineLine,
    targets: number[],
    corroboratedFactors: readonly ComparativePositionalEvidence[],
): ForkDefenceConsequence | null {
    const bestLine = [root.pvUci[0], ...best.pvUci];
    const steps = replayTacticalLine(fen, bestLine.slice(0, 9));
    const [fork, answer, recapture] = steps;
    if (
        !answer || !recapture?.capture ||
        !targets.includes(answer.move.from) ||
        recapture.move.to !== fork.move.to ||
        !bestLine.slice(0, 3).every((move, index) => root.pvUci[index] === move)
    )
        return null;
    const prefix = `The best reply ${answer.san} removes the fork piece.`;
    const gain = recapture.balance - fork.balance;
    if (gain >= 90) {
        const settles = (replay: TacticalReplayStep[]) =>
            replay.some((step, index) =>
                index >= 4 &&
                step.balance >= fork.balance + gain &&
                replay[index - 2].balance === step.balance &&
                replay.slice(2, index + 1).every(ply => ply.balance >= recapture.balance) &&
                replay.slice(index - 1, index + 1).every(ply =>
                    !ply.capture && !ply.move.promotion && !ply.after.isCheck(),
                ),
            );
        if (settles(replayTacticalLine(fen, root.pvUci.slice(0, 9))) && settles(steps)) {
            return {
                kind: "material",
                description: `${prefix} The recapture ${recapture.san} leaves the attacker ${gain / 100} material points ahead in the exchange in both searches.`,
            };
        }
    }
    const file = makeSquare(recapture.move.from)[0];
    if (
        recapture.before.board.get(recapture.move.from)?.role === "pawn" &&
        corroboratedFactors.some(factor =>
            factor.feature === "rook-file-access" && factor.side === fork.before.turn &&
            factor.squareOrFile === file && factor.firstPly === 3 && factor.rookUsedOpenedFile,
        )
    ) {
        return {
            kind: "rook-file",
            description: `${prefix} The recapture ${recapture.san} opens the ${file}-file for the rook in the main continuation.`,
        };
    }
    return null;
}

/** Keep a legal fork from a weaker reply distinct from the consequence of
 * answering its threats in the strongest searched line. */
export function findConditionalFork(
    fen: string,
    root: DecisionEngineLine,
    replies: DecisionEngineLine[],
    corroboratedFactors: readonly ComparativePositionalEvidence[] = [],
): ConditionalForkEvidence | null {
    const rootStep = replayTacticalLine(fen, root.pvUci.slice(0, 1))[0];
    const best = replies[0];
    if (
        !rootStep ||
        !best ||
        best.cp === null ||
        best.mate != null ||
        rootStep.after.isCheck() ||
        root.depth < 16 ||
        best.depth < 16 ||
        root.cp === null ||
        root.mate != null ||
        Math.abs(root.cp + best.cp) > 90 ||
        !measureDecisionLine(fen, root)
    )
        return null;
    const replyFen = makeFen(rootStep.after.toSetup());
    if (!measureDecisionLine(replyFen, best)) return null;
    const mainReply = replayTacticalLine(replyFen, best.pvUci.slice(0, 1))[0];
    if (!mainReply?.capture || mainReply.move.to !== rootStep.move.to) return null;
    // A trade that takes the attacking piece off is a real answer to the fork.
    // Only count concrete, newly available material targets from the attacker's
    // square, and test legal capture and local recapture before using a label.
    const after = rootStep.after.clone();
    after.turn = rootStep.before.turn;
    after.epSquare = undefined;
    const moved = after.board.get(rootStep.move.to);
    if (!moved || moved.color !== after.turn || moved.role === "king") return null;
    const from = rootStep.move.to;
    const targets = [...after.board[rootStep.after.turn]].filter((to) => {
        const target = after.board.get(to);
        if (!target || target.role === "king" || target.role === "pawn") return false;
        const attack = { from, to };
        const already = { from: rootStep.move.from, to };
        return (
            after.isLegal(attack) &&
            tacticalExchangeGain(after, attack) >= 90 &&
            (!rootStep.before.isLegal(already) ||
                tacticalExchangeGain(rootStep.before, already) < 90)
        );
    });
    if (targets.length < 2) return null;
    for (const branch of replies.slice(1)) {
        if (
            branch.depth !== best.depth ||
            branch.cp === null ||
            branch.mate != null ||
            best.cp - branch.cp < 100 ||
            !measureDecisionLine(replyFen, branch)
        )
            continue;
        const refutation = replayTacticalLine(replyFen, branch.pvUci.slice(0, 2));
        const [defence, payoff] = refutation;
        if (
            !payoff?.capture ||
            payoff.move.from !== from ||
            !targets.includes(payoff.move.to) ||
            defence.move.to === payoff.move.to ||
            defence.move.to === from
        )
            continue;
        if (tacticalExchangeGain(payoff.before, payoff.move) < 90) continue;
        const paid = measureDecisionLine(fen, {
            ...root,
            pvUci: [rootStep.uci, ...branch.pvUci.slice(0, 2)],
        });
        for (let end = 5; end <= Math.min(11, branch.pvUci.length + 1); end++) {
            const line = [rootStep.uci, ...branch.pvUci.slice(0, end - 1)];
            const measured = measureDecisionLine(fen, { ...root, pvUci: line });
            if (
                !measured ||
                measured.drawnEnding ||
                measured.quietEndingPlies < 2 ||
                measured.materialChangeCp < 90
            )
                continue;
            // At the earliest endpoint, there are only two replies after
            // the payoff. The four-ply window would include the board
            // before the capture and incorrectly require no gain there.
            const settled =
                end === 5
                    ? paid?.materialChangeCp === measured.materialChangeCp
                    : measured.endingMaterialRangeCp[0] === measured.endingMaterialRangeCp[1];
            if (!settled) continue;
            const other = targets.find((to) => to !== payoff.move.to)!;
            return {
                fen,
                mechanism: "fork",
                actor: rootStep.before.turn,
                mechanismPly: 1,
                payoffPly: 3,
                squares: [from, payoff.move.to, other].map(makeSquare),
                support: "legal-continuation",
                rootMoveInvolved: true,
                lineUci: line,
                description: `${rootStep.san} attacks both ${makeSquare(payoff.move.to)} and ${makeSquare(other)}. After ${defence.san}, ${payoff.san} collects one of the targets.`,
                bestReplyLineUci: [rootStep.uci, ...best.pvUci.slice(0, 8)],
                weakerReplySan: defence.san,
                defenceConsequence: defenceConsequence(fen, root, best, targets, corroboratedFactors),
            };
        }
    }
    return null;
}
