import { attacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "../../tacticalMotifs/causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "../../tacticalMotifs/decisionEvidence";
import type { TacticalSequenceWitness } from "../../tacticalMotifs/tacticalSequenceEvidence";

function targetCapture(steps: TacticalReplayStep[], targets: Square[]) {
    const attacker = steps[0].move.to;
    const stationary = new Set(targets);
    for (const index of [2, 4]) {
        const defence = steps[index - 1];
        const step = steps[index];
        if (!defence || !step) break;
        if (defence.move.to === attacker) return null;
        stationary.delete(defence.move.from);
        stationary.delete(defence.move.to);
        if (step.move.from === attacker) {
            return step.capture > 0 && stationary.has(step.move.to)
                ? { index, target: step.move.to, kind: "collection" as const }
                : null;
        }
        stationary.delete(step.move.to);
    }
    return null;
}

function paidDisarm(steps: TacticalReplayStep[], targets: Square[]) {
    const [root, defence, recapture] = steps;
    if (
        !root.move.promotion ||
        !defence?.capture ||
        defence.move.to !== root.move.to ||
        !targets.includes(defence.move.from) ||
        !recapture?.capture ||
        recapture.move.to !== root.move.to ||
        recapture.balance - root.capture < 90
    )
        return null;
    return { index: 2, target: defence.move.from, kind: "disarm" as const };
}

/** Two searched defences can connect an exact fork to a later collection, or
 * show that a defender takes the promoted attacker at a material cost. */
export function findForkInReplies(
    fen: string,
    root: DecisionEngineLine,
    replies: readonly DecisionEngineLine[],
): TacticalSequenceWitness | null {
    if (root.depth < 16 || root.cp == null || root.mate != null || !measureDecisionLine(fen, root)) return null;
    const rootStep = replayTacticalLine(fen, root.pvUci.slice(0, 1))[0];
    const [best, next] = replies;
    if (
        !rootStep || !best || !next || best.depth < 16 || next.depth !== best.depth ||
        best.cp == null || next.cp == null || best.mate != null || next.mate != null ||
        best.cp > -65 || next.cp > best.cp || Math.abs(root.cp + best.cp) > 90 ||
        best.pvUci[0] === next.pvUci[0]
    )
        return null;
    const side = rootStep.before.turn;
    const from = rootStep.move.to;
    const original = rootStep.before.board.get(rootStep.move.from);
    const mover = rootStep.after.board.get(from);
    if (!original || !mover || mover.color !== side || mover.role === "king") return null;
    const opponent = opposite(side);
    const previous = attacks(original, rootStep.move.from, rootStep.before.board.occupied);
    const attack = attacks(mover, from, rootStep.after.board.occupied);
    const after = rootStep.after.clone();
    after.turn = side;
    after.epSquare = undefined;
    const targets = [...attack.intersect(after.board[opponent])].filter(square => {
        const role = after.board.get(square)?.role;
        if (role === "pawn") return false;
        if (role === "king") return rootStep.after.isCheck();
        const promotion = mover.role === "pawn" && (square < 8 || square >= 56) ? "queen" : undefined;
        return after.isLegal({ from, to: square, promotion });
    });
    if (targets.length < 2 || !targets.some(square => !previous.has(square))) return null;
    const replyFen = makeFen(rootStep.after.toSetup());
    const witnesses: TacticalSequenceWitness[] = [];
    const resolvedTargets = new Set<Square>();
    const defenderMoves = new Set<Square>();
    let directCollection = false;
    for (const reply of [best, next]) {
        const measured = measureDecisionLine(replyFen, reply);
        if (!measured || measured.drawnEnding) return null;
        const lineUci = [rootStep.uci, ...reply.pvUci.slice(0, 8)];
        const steps = replayTacticalLine(fen, lineUci);
        const payoff = targetCapture(steps, targets) ?? paidDisarm(steps, targets);
        if (!payoff || steps.length < payoff.index + 3) return null;
        const tail = steps.slice(-2);
        if (Math.min(...tail.map(step => step.balance)) < 90) return null;
        if (payoff.kind === "collection") directCollection = true;
        resolvedTargets.add(payoff.target);
        defenderMoves.add(steps[1].move.from);
        const second = targets.find(target => target !== payoff.target)!;
        const response = steps[1].san;
        const payoffSan = steps[payoff.index].san;
        witnesses.push({
            fen,
            mechanism: "fork",
            actor: side,
            mechanismPly: 1,
            payoffPly: payoff.index + 1,
            squares: [from, payoff.target, second].map(makeSquare),
            description: payoff.kind === "collection"
                ? `After ${rootStep.san}, the reply ${response} allows ${payoffSan} to take the attacked piece on ${makeSquare(payoff.target)}.`
                : `After ${rootStep.san}, ${response} takes the promoted piece, but ${payoffSan} recaptures the attacked piece and keeps a material gain.`,
            support: "legal-continuation",
            rootMoveInvolved: true,
            lineUci,
        });
    }
    if (!directCollection) return null;
    const usedTarget = [...resolvedTargets][0];
    const otherTarget = targets.find(square => square !== usedTarget &&
        (resolvedTargets.has(square) || defenderMoves.has(square) ||
            (rootStep.after.isCheck() && square === rootStep.after.board.kingOf(opponent))));
    if (otherTarget === undefined) return null;
    const [primary, alternate] = witnesses;
    const squares = [from, usedTarget, otherTarget].map(makeSquare);
    return {
        ...primary,
        squares,
        description: `${primary.description} ${alternate.description}`,
        alternatives: [{ ...alternate, squares }],
    };
}
