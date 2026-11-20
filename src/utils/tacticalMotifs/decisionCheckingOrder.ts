import { makeFen } from "chessops/fen";
import type { NormalMove } from "chessops/types";
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
    defenceLineUci?: string[];
    explanation: string;
};

export type CheckingOrderProbe = {
    scope: "mistake" | "position";
    lines: DecisionEngineLine[];
    control?: DecisionEngineLine;
};

function usableScore(line: DecisionEngineLine) {
    return line.cp !== null && line.mate == null && line.depth >= MIN_DEPTH;
}

function capturedOrigin(steps: TacticalReplayStep[]) {
    const identities = initialPieceIdentities(steps[0].before);
    return steps.map((step) => followPieceIdentities(identities, step)).at(-1);
}

function retainedIdentities(steps: TacticalReplayStep[]) {
    const pieces = initialPieceIdentities(steps[0].before);
    for (const step of steps) followPieceIdentities(pieces, step);
    return pieces;
}

type BetterDefence =
    | { kind: "move-target" }
    | { kind: "take-attacker" }
    | { kind: "give-check" }
    | { kind: "same-reply"; fen: string; attack: TacticalReplayStep };

function addsDefence(
    original: TacticalReplayStep[],
    alternative: TacticalReplayStep[],
    response: NormalMove,
) {
    const played = retainedIdentities(original);
    const better = retainedIdentities(alternative);
    return better.get(response.from) !== undefined &&
        better.get(response.from) === played.get(response.from) &&
        !original[1].after.isLegal(response);
}

function compareBetterChoice(
    fen: string,
    preferred: TacticalReplayStep,
    original: [TacticalReplayStep, TacticalReplayStep],
    origin: number,
): BetterDefence | null {
    const [choice, attack] = original;
    const piece = choice.before.board.get(origin);
    const moved = preferred.after.board.get(preferred.move.to);
    if (preferred.move.from === origin && moved?.role === piece?.role && moved?.color === piece?.color)
        return { kind: "move-target" };

    const attacker = retainedIdentities([choice]).get(attack.move.from);
    if (attacker === undefined) return null;
    const same = replayTacticalLine(fen, [preferred.uci, attack.uci])[1];
    if (!same) {
        if (capturedOrigin([preferred]) === attacker) return { kind: "take-attacker" };
        if (preferred.after.isCheck() && retainedIdentities([preferred]).get(attack.move.from) === attacker)
            return { kind: "give-check" };
        return null;
    }
    const originalCapture = capturedOrigin(original);
    if (
        retainedIdentities([preferred]).get(attack.move.from) !== attacker ||
        capturedOrigin([preferred, same]) !== originalCapture
    ) return null;

    if (same.after.isCheck()) {
        if (!same.after.ctx().checkers.has(same.move.to) || !attack.after.ctx().checkers.has(attack.move.to))
            return null;
        const enablesCapture = [...same.after.allDests()].some(([from, squares]) =>
            squares.has(same.move.to) && addsDefence(original, [preferred, same], { from, to: same.move.to }),
        );
        if (!enablesCapture) return null;
    }
    return { kind: "same-reply", fen: makeFen(preferred.after.toSetup()), attack: same };
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
    if (origin === undefined || origin !== capturedOrigin(takeFirst) || !preferred) return null;
    const betterDefence = compareBetterChoice(fen, preferred, [choice, firstReply], origin);
    if (!betterDefence) return null;
    return {
        better, weaker, choice, firstReply, defence, capture, victim, origin, preferred, betterDefence,
        fen: makeFen(choice.after.toSetup()),
        moves: [firstReply.uci, capture.uci],
    };
}

export function findCheckingOrderChoice(fen: string, candidates: DecisionEngineLine[]) {
    if (!candidates[0]) return null;
    let exchange: ReturnType<typeof nominateCheckingOrder> = null;
    let contrast: ReturnType<typeof nominateCheckingOrder> = null;
    for (const weaker of candidates.slice(1)) {
        const candidate = nominateCheckingOrder(fen, candidates[0], weaker);
        if (!candidate) continue;
        if (candidate.betterDefence.kind !== "move-target") {
            contrast ??= candidate;
            continue;
        }
        // A recapture of the piece that started a trade can occur in both
        // move orders. Prefer a line that leaves a separate piece exposed.
        if (!candidate.choice.capture || candidate.choice.move.from !== candidate.origin) return candidate;
        exchange ??= candidate;
    }
    return exchange ?? contrast;
}

type CheckingOrderChoice = NonNullable<ReturnType<typeof nominateCheckingOrder>>;

export function compareCheckToCapture(
    request: CheckingOrderChoice,
    supplied: DecisionEngineLine[],
    history?: TacticalGameHistory,
) {
    if (supplied.length !== 2 || supplied[0].depth !== supplied[1].depth) return null;
    const { choice, firstReply, defence, capture } = request;
    const checkedHistory = history && { fen: history.fen, moves: [...history.moves, choice.uci] };
    const [check, take] = validateDecisionSearchFrame(request.fen, supplied, checkedHistory) ?? [];
    if (
        !check || !take || !usableScore(check) || !usableScore(take) ||
        check.claimHistory || take.claimHistory ||
        check.pvUci[0] !== firstReply.uci || take.pvUci[0] !== capture.uci ||
        check.pvUci[1] !== defence.uci ||
        check.pvUci[2] !== capture.uci ||
        check.cp! - take.cp! < MIN_SCORE_CONTRAST ||
        Math.abs(check.cp! + request.weaker.cp!) > MAX_SCORE_DISAGREEMENT
    ) return null;
    const repeated = replayTacticalLine(request.fen, check.pvUci.slice(0, 3));
    if (
        repeated.length !== 3 || repeated[1].after.isCheck() ||
        capturedOrigin([choice, ...repeated]) !== request.origin
    ) return null;
    return { check, take };
}

function verifyBetterDefence(
    request: CheckingOrderChoice,
    check: DecisionEngineLine,
    control: DecisionEngineLine | undefined,
    history?: TacticalGameHistory,
) {
    const { preferred, firstReply, betterDefence, choice, victim, origin } = request;
    switch (betterDefence.kind) {
        case "move-target":
            return { text: `${preferred.san} moves the ${victim.role} out of that capture.` };
        case "take-attacker": {
            const piece = firstReply.before.board.get(firstReply.move.from)!;
            return { text: `${preferred.san} takes the ${piece.role} that would give that check.` };
        }
        case "give-check":
            return { text: `${preferred.san} gives check and prevents the reply ${firstReply.san}.` };
        case "same-reply": {
            const chain = history && { fen: history.fen, moves: [...history.moves, preferred.uci] };
            const validated = control && validateDecisionSearchFrame(betterDefence.fen, [control], chain)?.[0];
            if (
                !validated || !usableScore(validated) || validated.claimHistory ||
                validated.pvUci[0] !== firstReply.uci ||
                check.cp! - validated.cp! < MIN_SCORE_CONTRAST ||
                request.better.cp! + validated.cp! > MAX_SCORE_DISAGREEMENT
            ) return null;
            const steps = replayTacticalLine(betterDefence.fen, validated.pvUci.slice(0, WITNESS_PLIES - 1));
            const [attack, answer] = steps;
            if (!answer || !addsDefence([choice, firstReply], [preferred, attack], answer.move)) return null;
            if (attack.after.isCheck()) {
                if (!answer.capture || answer.move.to !== attack.move.to || steps.length < 3 ||
                    ![...retainedIdentities([preferred, ...steps.slice(0, 3)]).values()].includes(origin))
                    return null;
                return {
                    text: `After ${preferred.san}, ${attack.san} can be answered with ${answer.san}, taking the checking piece. That capture is unavailable after ${choice.san}.`,
                    line: [preferred.uci, ...steps.map((step) => step.uci)],
                };
            }
            return {
                text: `After ${preferred.san}, ${attack.san} comes without check and gives time for ${answer.san}.`,
                line: [preferred.uci, ...steps.map((step) => step.uci)],
            };
        }
    }
}

export function confirmCheckingOrder(
    fen: string,
    request: CheckingOrderChoice,
    supplied: DecisionEngineLine[],
    history?: TacticalGameHistory,
    control?: DecisionEngineLine,
): CheckingOrderEvidence | null {
    const pair = compareCheckToCapture(request, supplied, history);
    if (!pair) return null;
    const { check, take } = pair;
    const { choice, firstReply, capture, victim } = request;
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
    const horizon = Math.min(good.length, bad.length, independent.length);
    if (horizon < 6) return null;
    const bestBalance = Math.min(...good.slice(horizon - 3, horizon).map((step) => step.balance));
    const weakBalance = Math.max(...[...bad.slice(horizon - 3, horizon),
        ...independent.slice(horizon - 3, horizon)].map((step) => step.balance));
    const taking = replayTacticalLine(request.fen, take.pvUci.slice(0, 5));
    const counterattack = attackOnCheckingPiece(taking, [bad, independent], choice, firstReply);
    if (
        request.betterDefence.kind === "move-target" &&
        (weakBalance > -90 || bestBalance - weakBalance < 90) &&
        !counterattack
    ) return null;
    const compensation = verifyBetterDefence(request, check, control, history);
    if (!compensation) return null;
    const reply = counterattack
        ? ` Taking immediately allows ${counterattack.san} to capture the ${firstReply.before.board.get(firstReply.move.from)!.role} that gives check.`
        : ` Taking immediately scores worse for the attacker.${taking[1] ? ` The line continues with ${taking.slice(1, 4).map((step) => step.san).join(" ")}.` : ""}`;
    return {
        betterLineUci: request.better.pvUci.slice(0, horizon),
        checkingLineUci: [choice.uci, ...check.pvUci.slice(0, horizon - 1)],
        immediateCaptureLineUci: [choice.uci, ...take.pvUci.slice(0, horizon - 1)],
        ...(compensation.line ? { defenceLineUci: compensation.line } : {}),
        explanation: `After ${choice.san}, ${firstReply.san} comes before ${capture.san}, which takes the ${victim.role} on ${makeSquare(capture.move.to)}.${reply} ${compensation.text}`,
    };
}
