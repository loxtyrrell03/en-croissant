import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import { replayTacticalLine, tacticalExchangeGain } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { TacticalSequenceWitness } from "./tacticalSequenceEvidence";

/** The best response can neutralise a threat so completely that no gain
 * appears in its PV. Show a fork only when another searched reply really
 * permits one of the threatened captures, and the best reply answers the
 * threats. This witness describes that branch, not an inevitable win. */
export function findConditionalFork(
    fen: string,
    root: DecisionEngineLine,
    replies: DecisionEngineLine[],
): TacticalSequenceWitness | null {
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
                description: `${rootStep.san} attacks both ${makeSquare(payoff.move.to)} and ${makeSquare(other)}. The engine's best reply ${mainReply.san} removes the attacker. After ${defence.san}, ${payoff.san} wins material in the separate continuation.`,
            };
        }
    }
    return null;
}
