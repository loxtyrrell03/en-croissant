import { attacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { makeSquare } from "chessops/util";
import type { ConditionalForkEvidence } from "@/utils/tacticalMotifs/conditionalForkEvidence";
import {
    replayTacticalLine,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "@/utils/tacticalMotifs/causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "@/utils/tacticalMotifs/decisionEvidence";

const MIN_GAIN = 90;

function retainedCapture(steps: TacticalReplayStep[], payoff: number, baseline: number) {
    const capture = steps[payoff];
    const window = steps.slice(payoff, payoff + 5);
    if (window.length < 3 || window.at(-1)!.after.isEnd()) return null;
    // A full-value capture can be followed by its expected recapture. The
    // actual minimum and the legal local exchange both debit that response.
    const exchange = steps[payoff - 1].balance + tacticalExchangeGain(capture.before, capture.move);
    const gain = Math.min(exchange, ...window.map((step) => step.balance)) - baseline;
    return gain >= MIN_GAIN ? { gain, line: steps.slice(0, payoff + window.length) } : null;
}

function targetsAfterFork(root: TacticalReplayStep) {
    const side = root.before.turn;
    const attacker = root.after.board.get(root.move.to);
    if (!attacker || attacker.color !== side || attacker.role === "king") return [];
    const after = root.after.clone();
    after.turn = side;
    after.epSquare = undefined;
    const oldAttacks = attacks(root.before.board.get(root.move.from)!, root.move.from, root.before.board.occupied);
    const attacksNow = attacks(attacker, root.move.to, root.after.board.occupied);
    const targets = [...attacksNow.intersect(root.after.board[root.after.turn])].filter((square) => {
        const victim = root.after.board.get(square)!;
        if (victim.role === "king") return root.after.isCheck();
        if (victim.role === "pawn") return false;
        return tacticalExchangeGain(after, { from: root.move.to, to: square }) >= MIN_GAIN;
    });
    return targets.some((square) => !oldAttacks.has(square)) ? targets : [];
}

function collectTarget(
    steps: TacticalReplayStep[],
    targets: Square[],
    maximumPayoff: number,
) {
    const [fork, defence] = steps;
    if (!defence || defence.move.to === fork.move.to) return null;
    const from = fork.move.to;
    for (let i = 2; i <= maximumPayoff - 1 && i < steps.length; i += 2) {
        const payoff = steps[i];
        const target = payoff.move.to;
        if (!payoff.capture || payoff.move.from !== from || !targets.includes(target)) continue;
        // Keep the original target. A replacement arriving on the same
        // square is a different capture. The forker may wait on its square.
        if (steps.slice(1, i).some((step) =>
            [from, target].some((square) => step.move.to === square || step.move.from === square),
        )) continue;
        // A later capture must be an available threat immediately after
        // the same defence, independent of intervening moves in that line.
        if (
            tacticalExchangeGain(defence.after, payoff.move) < MIN_GAIN ||
            tacticalExchangeGain(payoff.before, payoff.move) < MIN_GAIN ||
            !fork.after.board.get(target)
        ) continue;
        const sequence = retainedCapture(steps, i, fork.balance);
        if (sequence) return { target, payoff, index: i, sequence };
    }
    return null;
}

/** Use two engine-checked answers to the exact attack. The strongest must
 * pay to remove the forker; another must concede an original target. */
export function findForkWithPaidDefence(
    fen: string,
    root: DecisionEngineLine,
    replies: readonly DecisionEngineLine[],
    maximumPayoff = 7,
): ConditionalForkEvidence | null {
    const best = replies[0];
    if (
        !best || replies.length < 2 || root.depth < 16 || best.depth < 16 ||
        root.cp == null || root.cp < 65 || root.mate != null ||
        best.cp == null || best.mate != null || Math.abs(root.cp + best.cp) > 90 ||
        !measureDecisionLine(fen, root)
    ) return null;
    const rootSteps = replayTacticalLine(fen, root.pvUci.slice(0, 10));
    const [fork, answer, recapture] = rootSteps;
    const postFen = makeFen(fork.after.toSetup());
    if (
        !answer?.capture || !recapture?.capture ||
        answer.move.to !== fork.move.to || recapture.move.to !== fork.move.to ||
        !measureDecisionLine(postFen, best) ||
        best.pvUci[0] !== answer.uci || best.pvUci[1] !== recapture.uci
    ) return null;
    const targets = targetsAfterFork(fork);
    if (targets.length < 2 || !targets.includes(answer.move.from)) return null;

    // Debit the root capture. In a promotion line this includes the cost
    // of losing the promoted piece and the original pawn.
    const original = retainedCapture(rootSteps, 2, fork.capture);
    if (!original) return null;
    const main = [fork.uci, ...best.pvUci.slice(0, 9)];
    const verified = retainedCapture(replayTacticalLine(fen, main), 2, fork.capture);
    if (!verified) return null;
    for (const alternative of replies.slice(1)) {
        if (
            alternative.depth !== best.depth || alternative.cp == null || alternative.mate != null ||
            alternative.cp > best.cp ||
            alternative.pvUci[0] === best.pvUci[0] || !measureDecisionLine(postFen, alternative)
        ) continue;
        const branch = replayTacticalLine(fen, [fork.uci, ...alternative.pvUci.slice(0, 10)]);
        const payoff = collectTarget(branch, targets, maximumPayoff);
        if (!payoff) continue;
        const other = [branch[1].move.from, answer.move.from, ...targets]
            .find((target) => target !== payoff.target && targets.includes(target))!;
        const targetName = (square: Square) => `${fork.after.board.get(square)!.role} on ${makeSquare(square)}`;
        const victims = `${targetName(other)} and ${targetName(payoff.target)}`;
        const gain = Math.min(original.gain, verified.gain) / 100;
        return {
            fen,
            mechanism: "fork",
            actor: fork.before.turn,
            mechanismPly: 1,
            payoffPly: payoff.index + 1,
            squares: [fork.move.to, other, payoff.target].map(makeSquare),
            support: "legal-continuation",
            rootMoveInvolved: true,
            lineUci: payoff.sequence.line.map((step) => step.uci),
            description: `${fork.san} attacks the ${victims}. After ${branch[1].san}, ${payoff.payoff.san} takes one of the original targets.`,
            bestReplyLineUci: verified.line.map((step) => step.uci),
            weakerReplySan: branch[1].san,
            defenceConsequence: {
                kind: "material",
                description: `${fork.san} forks the ${victims}. The strongest searched reply ${answer.san} takes the attacker. In both searches, ${recapture.san} starts an exchange that retains at least ${gain} ${fork.capture ? "additional " : ""}material points.`,
            },
        };
    }
    return null;
}
