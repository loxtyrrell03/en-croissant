import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import { followPieceIdentities, initialPieceIdentities } from "./decisionPieceIdentity";
import { validateDecisionSearchFrame } from "./decisionSearchFrame";
import type { TacticalGameHistory } from "./gameHistory";

const MIN_DEPTH = 16;
const MIN_SCORE_CONTRAST = 100;
const MAX_SCORE_DISAGREEMENT = 100;
const WITNESS_PLIES = 10;

export type CheckingOrderEvidence = {
    betterLineUci: string[];
    checkingLineUci: string[];
    immediateCaptureLineUci: string[];
    explanation: string;
};

export type CheckingOrderProbe = {
    scope: "mistake" | "position";
    lines: DecisionEngineLine[];
};

function usableScore(line: DecisionEngineLine) {
    return line.cp !== null && line.mate == null && line.depth >= MIN_DEPTH;
}

function capturedOrigin(steps: TacticalReplayStep[]) {
    const identities = initialPieceIdentities(steps[0].before);
    return steps.map((step) => followPieceIdentities(identities, step)).at(-1);
}

function attackOnCheckingPiece(
    taking: TacticalReplayStep[],
    checked: TacticalReplayStep[][],
    choice: TacticalReplayStep,
    firstReply: TacticalReplayStep,
) {
    const identities = initialPieceIdentities(choice.before);
    followPieceIdentities(identities, choice);
    const checker = identities.get(firstReply.move.from);
    if (checker === undefined) return;
    const capture = taking.slice(0, 5).find((step) => followPieceIdentities(identities, step) === checker);
    if (!capture) return;
    // Both checked lines must still have that same original piece after the
    // point where the immediate capture loses it.
    if (checked.every((line) => {
        if (line.length < 6) return false;
        const active = initialPieceIdentities(choice.before);
        for (const step of line.slice(0, 6)) followPieceIdentities(active, step);
        return [...active.values()].includes(checker);
    })) return capture;
}

/** Compare the exact delayed capture to taking the same original piece immediately. */
export function nominateCheckingOrder(
    fen: string,
    better: DecisionEngineLine,
    weaker: DecisionEngineLine,
) {
    if (
        !usableScore(better) || !usableScore(weaker) ||
        better.depth !== weaker.depth ||
        better.cp! - weaker.cp! < MIN_SCORE_CONTRAST
    ) return null;
    const steps = replayTacticalLine(fen, weaker.pvUci.slice(0, 4));
    const [choice, firstReply, defence, capture] = steps;
    if (!capture || !firstReply.after.isCheck() || defence.after.isCheck() || !capture.capture) return null;
    const victim = capture.before.board.get(capture.move.to);
    if (!victim || victim.role === "pawn" || victim.color !== choice.before.turn) return null;
    const takeFirst = replayTacticalLine(fen, [choice.uci, capture.uci]);
    if (!takeFirst[1]?.capture) return null;
    const origin = capturedOrigin(steps);
    const [preferred] = replayTacticalLine(fen, better.pvUci.slice(0, 1));
    // The better choice moves the original piece out of the capture, rather
    // than relying on a different tactical explanation for an unrelated gain.
    if (origin === undefined || origin !== capturedOrigin(takeFirst) || preferred?.move.from !== origin) return null;
    const moved = preferred.after.board.get(preferred.move.to);
    if (moved?.role !== victim.role || moved.color !== victim.color) return null;
    return {
        better, weaker, choice, firstReply, defence, capture, victim, origin, preferred,
        fen: makeFen(choice.after.toSetup()),
        moves: [firstReply.uci, capture.uci],
    };
}

export function findCheckingOrderChoice(fen: string, candidates: DecisionEngineLine[]) {
    if (!candidates[0]) return null;
    let exchange: ReturnType<typeof nominateCheckingOrder> = null;
    for (const weaker of candidates.slice(1)) {
        const candidate = nominateCheckingOrder(fen, candidates[0], weaker);
        if (!candidate) continue;
        // A recapture of the piece that started a trade can occur in both
        // move orders. Prefer a line that leaves a separate piece exposed.
        if (!candidate.choice.capture || candidate.choice.move.from !== candidate.origin) return candidate;
        exchange ??= candidate;
    }
    return exchange;
}

export function confirmCheckingOrder(
    fen: string,
    request: NonNullable<ReturnType<typeof nominateCheckingOrder>>,
    supplied: DecisionEngineLine[],
    history?: TacticalGameHistory,
): CheckingOrderEvidence | null {
    if (supplied.length !== 2 || supplied[0].depth !== supplied[1].depth) return null;
    const { choice, preferred, firstReply, defence, capture, victim, origin } = request;
    const checkedHistory = history && { fen: history.fen, moves: [...history.moves, choice.uci] };
    const [check, take] = validateDecisionSearchFrame(request.fen, supplied, checkedHistory) ?? [];
    if (
        !check || !take || !usableScore(check) || !usableScore(take) ||
        check.claimHistory || take.claimHistory ||
        check.pvUci[0] !== firstReply.uci || take.pvUci[0] !== capture.uci ||
        check.pvUci[1] !== defence.uci || check.pvUci[2] !== capture.uci ||
        check.cp! - take.cp! < MIN_SCORE_CONTRAST ||
        Math.abs(check.cp! + request.weaker.cp!) > MAX_SCORE_DISAGREEMENT
    ) return null;
    const frames = [request.better, request.weaker, { ...request.weaker, pvUci: [choice.uci, ...check.pvUci] }];
    if (frames.some((line) => measureDecisionLine(fen, line)?.drawnEnding !== false)) return null;
    // Preserve verification against actual game history when any of the
    // variations reaches a draw claim or termination.
    if (frames.some((line) => {
        const [valid] = validateDecisionSearchFrame(fen, [line], history) ?? [];
        return !valid || valid.claimHistory || valid.pvUci.length !== line.pvUci.length;
    })) return null;
    const [good, bad, independent] = frames.map((line) =>
        replayTacticalLine(fen, line.pvUci.slice(0, WITNESS_PLIES)),
    );
    if (capturedOrigin(independent.slice(0, 4)) !== origin) return null;
    const horizon = Math.min(good.length, bad.length, independent.length);
    if (horizon < 6) return null;
    const bestBalance = Math.min(...good.slice(horizon - 3, horizon).map((step) => step.balance));
    const weakBalance = Math.max(...[...bad.slice(horizon - 3, horizon),
        ...independent.slice(horizon - 3, horizon)].map((step) => step.balance));
    const taking = replayTacticalLine(request.fen, take.pvUci.slice(0, 5));
    const counterattack = attackOnCheckingPiece(taking, [bad, independent], choice, firstReply);
    if ((weakBalance > -90 || bestBalance - weakBalance < 90) && !counterattack) return null;
    const reply = counterattack
        ? ` Taking immediately allows ${counterattack.san} to capture the ${firstReply.before.board.get(firstReply.move.from)!.role} that gives check.`
        : ` Taking immediately scores worse for the attacker.${taking[1] ? ` The line continues with ${taking.slice(1, 4).map((step) => step.san).join(" ")}.` : ""}`;
    return {
        betterLineUci: request.better.pvUci.slice(0, horizon),
        checkingLineUci: [choice.uci, ...check.pvUci.slice(0, horizon - 1)],
        immediateCaptureLineUci: [choice.uci, ...take.pvUci.slice(0, horizon - 1)],
        explanation: `After ${choice.san}, ${firstReply.san} comes before ${capture.san}, which takes the ${victim.role} on ${makeSquare(capture.move.to)}.${reply} ${preferred.san} moves the ${victim.role} out of that capture.`,
    };
}
