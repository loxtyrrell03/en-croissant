import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { makeSquare } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import type { DecisionEngineLine } from "./decisionEvidence";
import { validateDecisionSearchFrame } from "./decisionSearchFrame";
import type { TacticalGameHistory } from "./gameHistory";

export type CaptureOrderProbe = { moveUci: string; replyUci: string; lines: DecisionEngineLine[] };
export type CaptureOrderEvidence = {
    fen: string;
    moveUci: string;
    replySan: string;
    lineUci: string[];
    otherLineUci: string[];
    explanation: string;
};

type ScoredLine = DecisionEngineLine & { cp: number };
type ReplyFrame = { moveUci: string; lines: DecisionEngineLine[] };
type CaptureOrderInput = {
    fen: string;
    history?: TacticalGameHistory;
    candidates: DecisionEngineLine[];
    comparisonCandidates?: DecisionEngineLine[];
    replyProbes?: ReplyFrame[];
};

function scored(line: DecisionEngineLine | undefined): line is ScoredLine {
    return !!line && line.cp !== null && Number.isFinite(line.cp) && line.mate == null &&
        line.depth >= 16 && !line.lowerbound && !line.upperbound && !line.claimHistory;
}

function special(step: TacticalReplayStep) {
    return !!step.move.promotion || !!castlingSide(step.before, step.move) ||
        (step.capture > 0 && !step.before.board.get(step.move.to));
}

type CaptureOrderProposal = {
    root: TacticalReplayStep;
    reply: TacticalReplayStep;
    remove: TacticalReplayStep;
    take: TacticalReplayStep;
    checkpoint: string;
    rootCp: number;
};
type SupportedCaptureOrder = CaptureOrderProposal & { replyCp: number };

function competitiveRoots(input: CaptureOrderInput, allowed: ReadonlySet<string>) {
    const first = input.candidates[0];
    if (!scored(first)) return [];
    const paired = input.comparisonCandidates && validateDecisionSearchFrame(
        input.fen, input.comparisonCandidates, input.history,
    );
    const pairLeader = paired?.[0];
    return input.candidates.filter((candidate): candidate is ScoredLine => {
        if (!scored(candidate) || candidate.depth !== first.depth || first.cp - candidate.cp > 50 ||
            !allowed.has(candidate.pvUci[0])) return false;
        const counterpart = paired?.find(line => line.pvUci[0] === candidate.pvUci[0]);
        return !scored(pairLeader) || !scored(counterpart) || pairLeader.depth !== counterpart.depth ||
            pairLeader.cp - counterpart.cp <= 50;
    });
}

function findPreparedCapture(steps: TacticalReplayStep[], guard: Square) {
    const [, reply, remove] = steps;
    const reached = reply.after;
    const displaced = new Set<Square>();
    for (const [offset, step] of steps.slice(3).entries()) {
        if (special(step)) break;
        const { move } = step;
        if (offset % 2 === 1 && step.capture > 0 && move.from !== remove.move.from &&
            move.to !== guard && !displaced.has(move.from) && !displaced.has(move.to) &&
            reached.board.get(move.to) && reached.isLegal(move)) {
            const direct = reached.clone();
            direct.play(move);
            if (direct.isLegal({ from: guard, to: move.to })) return step;
        }
        displaced.add(move.from);
        displaced.add(move.to);
    }
}

export function nominateCaptureOrder(fen: string, candidate: DecisionEngineLine): CaptureOrderProposal | undefined {
    if (!scored(candidate) || candidate.pvUci.length < 5) return;
    const steps = replayTacticalLine(fen, candidate.pvUci.slice(0, 7));
    if (steps.length < 5) return;
    const [root, reply, remove] = steps;
    if (root.capture || root.before.isCheck() || root.after.isCheck() || special(root) || special(reply) ||
        !remove.capture || remove.after.isCheck() || special(remove) || remove.move.from !== root.move.to) return;
    const guard = remove.move.to;
    const original = reply.move.to === guard ? reply.move.from : guard;
    if (root.before.board.get(original) && root.before.isLegal({ from: root.move.from, to: original })) return;
    const take = findPreparedCapture(steps, guard);
    if (take) return { root, reply, remove, take, checkpoint: makeFen(reply.after.toSetup()), rootCp: candidate.cp };
}

function supportingReplies(
    fen: string, root: ScoredLine, probe: ReplyFrame | undefined, history?: TacticalGameHistory,
) {
    if (!probe) return [];
    const step = replayTacticalLine(fen, root.pvUci.slice(0, 1))[0];
    if (!step) return [];
    const replyHistory = history ? { fen: history.fen, moves: [...history.moves, step.uci] } : undefined;
    const replies = validateDecisionSearchFrame(makeFen(step.after.toSetup()), probe.lines, replyHistory);
    const best = replies?.[0];
    if (!replies || !scored(best) || Math.abs(root.cp + best.cp) > 90) return [];
    return replies.filter((line): line is ScoredLine =>
        scored(line) && line.depth === best.depth && best.cp - line.cp <= 100);
}

export function availableCaptureOrders(
    input: CaptureOrderInput, allowed: ReadonlySet<string>,
) {
    const { fen, history, replyProbes = [] } = input;
    const roots = competitiveRoots(input, allowed).map(root => ({
        root,
        replies: supportingReplies(fen, root, replyProbes.find(p => p.moveUci === root.pvUci[0]), history),
    }));
    return [
        ...roots.flatMap(({ root, replies }) => {
            const proposal = nominateCaptureOrder(fen, root);
            if (!proposal) return [];
            const supporting = replies.find(line => line.pvUci[0] === proposal.reply.uci);
            return supporting ? [{ ...proposal, replyCp: supporting.cp }] : [];
        }),
        ...roots.flatMap(({ root, replies }) => replies.flatMap(line => {
            const proposal = nominateCaptureOrder(fen, { ...root, pvUci: [root.pvUci[0], ...line.pvUci] });
            return proposal ? [{ ...proposal, replyCp: line.cp }] : [];
        })),
    ];
}

function capturesOriginalTarget(steps: TacticalReplayStep[], square: Square) {
    for (const [ply, step] of steps.entries()) {
        if (step.move.from === square) return false;
        if (step.move.to === square) return ply % 2 === 0 && step.capture > 0 && !special(step);
    }
    return false;
}

export function confirmCaptureOrder(
    proposal: SupportedCaptureOrder, answers: DecisionEngineLine[], history?: TacticalGameHistory,
): CaptureOrderEvidence | undefined {
    const { root, reply, remove, take, checkpoint, rootCp, replyCp } = proposal;
    if (answers.length !== 2) return;
    const checkpointHistory = history ? { fen: history.fen, moves: [...history.moves, root.uci, reply.uci] } : undefined;
    const frame = validateDecisionSearchFrame(checkpoint, answers, checkpointHistory);
    const first = frame?.find(line => line.pvUci[0] === remove.uci);
    const early = frame?.find(line => line.pvUci[0] === take.uci);
    if (!scored(first) || !scored(early) || first.depth !== early.depth ||
        first.cp - early.cp < 100 || Math.abs(first.cp - rootCp) > 90 ||
        Math.abs(first.cp + replyCp) > 90) return;
    const good = replayTacticalLine(checkpoint, first.pvUci.slice(0, 5));
    const bad = replayTacticalLine(checkpoint, early.pvUci.slice(0, 4));
    const guard = remove.move.to;
    const target = take.move.to;
    const answer = bad[1];
    if (!capturesOriginalTarget(good, target) || !answer?.capture || answer.move.from !== guard ||
        (answer.move.to !== target && answer.move.to !== remove.move.from)) return;
    const guardSquare = makeSquare(guard);
    const condition = answer.move.to === target
        ? `the defender on ${guardSquare} recaptures with ${answer.san}`
        : `the defender takes the piece that was about to remove it with ${answer.san}`;
    return {
        fen: checkpoint, moveUci: root.uci, replySan: reply.san,
        lineUci: good.map(step => step.uci), otherLineUci: bad.map(step => step.uci),
        explanation: `After ${reply.san}, ${remove.san} removes the defender before taking on ${makeSquare(target)}. If ${take.san} comes first, ${condition}.`,
    };
}
