import { attacks, between } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Color, NormalMove, Role, Square } from "chessops/types";
import { makeSquare, makeUci, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "@/utils/tacticalMotifs/causalTactics";
import { type DecisionEngineLine, measureDecisionLine } from "@/utils/tacticalMotifs/decisionEvidence";
import { followPieceIdentities, initialPieceIdentities } from "@/utils/tacticalMotifs/decisionPieceIdentity";
import { validateDecisionSearchFrame } from "@/utils/tacticalMotifs/decisionSearchFrame";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";

const WEIGHT: Record<Role, number> = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };

type Score = DecisionEngineLine & { cp: number };
type Effect = "opened-check" | "kept-material";

export type QuietReplyProposal = {
    root: TacticalReplayStep;
    reply: TacticalReplayStep;
    threat: Square;
    threatPiece: Role;
    connection: "interposition" | "new-defender";
    effect: Effect;
    replyLine: Score;
    checkpoint: string;
};

export type QuietReplyEvidence = {
    fen: string;
    moveUci: string;
    replyUci: string;
    replySan: string;
    effect: Effect;
    lineUci: string[];
    otherLineUci?: string[];
    explanation: string;
};

export type QuietReplyProbe = {
    rootMoveUci: string;
    replies: DecisionEngineLine[];
    answers: DecisionEngineLine[];
};

function score(line: DecisionEngineLine | undefined): line is Score {
    return line !== undefined && line.cp !== null && Number.isFinite(line.cp) &&
        line.depth >= 16 && line.mate == null && !line.lowerbound && !line.upperbound && !line.claimHistory;
}

function legalFor(position: Chess, side: Color, move: NormalMove) {
    if (position.turn === side) return position.isLegal(move);
    const clone = position.clone();
    clone.turn = side;
    clone.epSquare = undefined;
    return clone.isLegal(move);
}

function threats(root: TacticalReplayStep) {
    const piece = root.before.board.get(root.move.from)!;
    if (piece.role === "king" || root.capture || root.after.isCheck() || root.move.promotion) return [];
    const older = attacks(piece, root.move.from, root.before.board.occupied);
    const newer = attacks(piece, root.move.to, root.after.board.occupied);
    return [...newer.diff(older)].flatMap(square => {
        const victim = root.after.board.get(square);
        return victim && victim.color !== piece.color && WEIGHT[victim.role] - WEIGHT[piece.role] >= 100 &&
            legalFor(root.after, piece.color, { from: root.move.to, to: square })
            ? [{ square, role: victim.role }]
            : [];
    });
}

function connection(root: TacticalReplayStep, reply: TacticalReplayStep, target: Square) {
    if (reply.capture || reply.after.isCheck() || reply.move.promotion || reply.move.from === target) return null;
    if (!legalFor(reply.after, reply.before.turn, { from: reply.move.to, to: root.move.to })) return null;
    const attempt = { from: root.move.to, to: target };
    if (!reply.after.isLegal(attempt)) {
        return between(attempt.from, attempt.to).has(reply.move.to) ? "interposition" : null;
    }
    const challenged = reply.after.clone();
    challenged.play(attempt);
    if (!challenged.isLegal({ from: reply.move.to, to: target })) return null;
    const original = reply.before.clone();
    original.turn = opposite(original.turn);
    original.epSquare = undefined;
    original.play(attempt);
    return original.isLegal({ from: reply.move.from, to: target }) ? null : "new-defender";
}

function opensCheck(root: TacticalReplayStep, reply: TacticalReplayStep, answer: TacticalReplayStep) {
    return answer.move.from !== root.move.to && answer.after.isCheck() &&
        between(answer.move.from, answer.move.to).has(reply.move.from) &&
        !legalFor(reply.before, answer.before.turn, answer.move);
}

function hasOpenedCheck(root: TacticalReplayStep, reply: TacticalReplayStep) {
    for (const [from, destinations] of reply.after.allDests()) {
        if (from === root.move.to) continue;
        for (const to of destinations) {
            if (!between(from, to).has(reply.move.from)) continue;
            const after = reply.after.clone();
            after.play({ from, to });
            if (after.isCheck()) return true;
        }
    }
    return false;
}

function retainedMaterial(reply: TacticalReplayStep, steps: TacticalReplayStep[], target: Square) {
    const pieces = initialPieceIdentities(reply.before);
    followPieceIdentities(pieces, reply);
    const captured = steps.findIndex(step =>
        followPieceIdentities(pieces, step) === target && step.before.turn === reply.after.turn,
    );
    if (captured < 0 || steps.length < captured + 4) return 0;
    return Math.min(...steps.slice(captured + 1, captured + 4).map(step => step.balance));
}

function historyAfter(history: TacticalGameHistory | undefined, ...moves: string[]) {
    return history ? { fen: history.fen, moves: [...history.moves, ...moves] } : undefined;
}

export function nominateQuietReply(
    fen: string,
    rootLine: DecisionEngineLine,
    supplied: DecisionEngineLine[],
    history?: TacticalGameHistory,
): QuietReplyProposal | null {
    if (!score(rootLine) || !measureDecisionLine(fen, rootLine)) return null;
    const [root] = replayTacticalLine(fen, rootLine.pvUci.slice(0, 1));
    if (!root) return null;
    const targets = threats(root);
    if (!targets.length) return null;
    const reached = makeFen(root.after.toSetup());
    const [safest, ...others] = validateDecisionSearchFrame(reached, supplied, historyAfter(history, root.uci)) ?? [];
    if (!score(safest) || Math.abs(rootLine.cp + safest.cp) > 90) return null;
    for (const replyLine of others) {
        if (!score(replyLine) || replyLine.depth !== safest.depth || safest.cp - replyLine.cp < 100) continue;
        const [reply] = replayTacticalLine(reached, replyLine.pvUci.slice(0, 1));
        if (!reply) continue;
        const checkpoint = makeFen(reply.after.toSetup());
        const steps = replayTacticalLine(checkpoint, replyLine.pvUci.slice(1, 13));
        for (const target of targets) {
            const relation = connection(root, reply, target.square);
            if (!relation || !steps[0] || (relation === "interposition" && !hasOpenedCheck(root, reply))) continue;
            const effect = relation === "interposition" && opensCheck(root, reply, steps[0])
                ? "opened-check"
                : retainedMaterial(reply, steps, target.square) >= 140 ? "kept-material" : null;
            if (effect) return { root, reply, threat: target.square, threatPiece: target.role,
                connection: relation, effect, replyLine, checkpoint };
        }
    }
    return null;
}

export function nominateUnsearchedQuietReply(
    fen: string,
    rootLine: DecisionEngineLine,
    replies: DecisionEngineLine[],
    history?: TacticalGameHistory,
) {
    if (!score(rootLine) || !measureDecisionLine(fen, rootLine) || !score(replies[0])) return;
    if (Math.abs(rootLine.cp + replies[0].cp) > 90) return;
    const [root] = replayTacticalLine(fen, rootLine.pvUci.slice(0, 1));
    if (!root) return;
    const targets = threats(root);
    if (!targets.length) return;
    const reached = makeFen(root.after.toSetup());
    if (!validateDecisionSearchFrame(reached, replies, historyAfter(history, root.uci))) return;
    const candidates: Array<{ uci: string; priority: number }> = [];
    const alreadySearched = new Set(replies.map(line => line.pvUci[0]));
    for (const [from, destinations] of root.after.allDests()) {
        for (const to of destinations) {
            const uci = makeUci({ from, to });
            if (alreadySearched.has(uci)) continue;
            const [reply] = replayTacticalLine(reached, [uci]);
            if (!reply) continue;
            for (const target of targets) {
                const relation = connection(root, reply, target.square);
                if (relation === "new-defender" || (relation === "interposition" && hasOpenedCheck(root, reply))) {
                    candidates.push({ uci, priority: relation === "interposition" ? 0 : 1 });
                }
            }
        }
    }
    const candidate = candidates.sort((a, b) => a.priority - b.priority || a.uci.localeCompare(b.uci))[0];
    return candidate && { fen: reached, root: root.uci, reply: candidate.uci, safer: replies[0].pvUci[0] };
}

export function confirmQuietReply(
    proposal: QuietReplyProposal,
    supplied: DecisionEngineLine[],
    history?: TacticalGameHistory,
): QuietReplyEvidence | null {
    const { root, reply, effect, threat, threatPiece, checkpoint } = proposal;
    const checked = validateDecisionSearchFrame(checkpoint, supplied, historyAfter(history, root.uci, reply.uci));
    const [best, ...others] = checked ?? [];
    if (!score(best) || !others.length || Math.abs(best.cp + proposal.replyLine.cp) > 110) return null;
    const prefix = [root.uci, reply.uci];
    const base = { fen: makeFen(root.before.toSetup()), moveUci: root.uci, replyUci: reply.uci,
        replySan: reply.san, effect };
    if (effect === "opened-check") {
        const [answer] = replayTacticalLine(checkpoint, best.pvUci.slice(0, 1));
        if (!answer || !opensCheck(root, reply, answer)) return null;
        const control = others.find(line => {
            if (!score(line) || line.depth !== best.depth) return false;
            const [other] = replayTacticalLine(checkpoint, line.pvUci.slice(0, 1));
            return other && !opensCheck(root, reply, other);
        });
        if (!score(control) || best.cp - control.cp < 40) return null;
        return {
            ...base, lineUci: [...prefix, ...best.pvUci.slice(0, 7)],
            otherLineUci: [...prefix, ...control.pvUci.slice(0, 7)],
            explanation: `After ${root.san}, ${reply.san} blocks the attack on the ${threatPiece} on ${makeSquare(threat)}. Moving from ${makeSquare(reply.move.from)} also makes ${answer.san} legal. The checking route scores higher than the other searched responses outside that route.`,
        };
    }
    for (const line of checked!) {
        if (!score(line) || line.depth !== best.depth || best.cp - line.cp > 35) continue;
        const plies = replayTacticalLine(checkpoint, line.pvUci.slice(0, 12));
        if (retainedMaterial(reply, plies, threat) < 140) continue;
        return {
            ...base, lineUci: [...prefix, ...plies.map(step => step.uci)],
            explanation: `After ${root.san}, ${reply.san} tries to protect the ${threatPiece} on ${makeSquare(threat)}. The compared continuations still capture that piece and keep a material gain through the shown exchange.`,
        };
    }
    return null;
}
