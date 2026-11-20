import { castlingSide, type Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Color, Square } from "chessops/types";
import {
    kingCastlesTo,
    makeSquare,
    makeUci,
    opposite,
    parseUci,
    rookCastlesTo,
} from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { TacticalGameHistory } from "./gameHistory";
import type { ComparativePositionalEvidence } from "./positionalTransitions";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";
import type { TacticalMistakeEpisode } from "./tacticalMistakeEpisode";

export type DecisionCheckpoint = { fen: string; prefix: string[] };
export type CheckingDefenceRequest = {
    better: DecisionCheckpoint;
    played: DecisionCheckpoint;
    captures: string[];
};
export type CheckingDefenceProbe = {
    capture: DecisionEngineLine;
    played: DecisionEngineLine;
};
export type PassedAdvanceRequest = {
    origin: Square;
    advance: string;
    checks: [DecisionCheckpoint, DecisionCheckpoint];
    throughPly: number;
};
export type PassedAdvanceEvidence = {
    factor: ComparativePositionalEvidence;
    testedAdvanceLines: string[][];
};

type Trace = ReturnType<typeof trace>;
const material = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };

function trace(steps: TacticalReplayStep[]) {
    const original = new Map<Square, Square>();
    for (const [square] of steps[0].before.board) original.set(square, square);
    const removed = new Map<Square, number>();
    const positions = [new Map(original)];
    for (const [index, step] of steps.entries()) {
        const { before, move, capture } = step;
        const origin = original.get(move.from)!;
        original.delete(move.from);
        const castle = castlingSide(before, move);
        if (castle) {
            const rook = before.castles.rook[before.turn][castle]!;
            const rookOrigin = original.get(rook)!;
            original.delete(rook);
            original.set(rookCastlesTo(before.turn, castle), rookOrigin);
            original.set(kingCastlesTo(before.turn, castle), origin);
        } else {
            if (capture) {
                const taken =
                    before.epSquare === move.to && before.board.get(move.from)?.role === "pawn"
                        ? move.to + (before.turn === "white" ? -8 : 8)
                        : move.to;
                removed.set(original.get(taken)!, index + 1);
                original.delete(taken);
            }
            original.set(move.to, origin);
        }
        positions.push(new Map(original));
    }
    return { steps, positions, removed };
}

function safeLine(fen: string, line: DecisionEngineLine, history?: TacticalGameHistory) {
    if (measureDecisionLine(fen, line)?.drawnEnding !== false) return [];
    if (history) {
        let state = readTacticalRepetitionContext(fen, history);
        if (!state || tacticalRepetitionClaim(state)) return [];
        for (const move of line.pvUci.slice(0, 23)) {
            state = advanceTacticalRepetitionContext(state, move);
            if (!state || tacticalRepetitionClaim(state)) return [];
        }
    }
    return replayTacticalLine(fen, line.pvUci.slice(0, 23));
}

function exactReply(
    fen: string,
    root: DecisionEngineLine,
    line: DecisionEngineLine,
    history?: TacticalGameHistory,
) {
    const [choice] = replayTacticalLine(fen, root.pvUci.slice(0, 1));
    if (
        !choice ||
        measureDecisionLine(makeFen(choice.after.toSetup()), line)?.drawnEnding !== false
    )
        return [];
    const continuation = { ...root, pvUci: [choice.uci, ...line.pvUci] };
    return safeLine(fen, continuation, history);
}

const squareOf = (identities: Map<Square, Square>, origin: Square) =>
    [...identities].find(([, item]) => origin === item)?.[0];

function checkedPair(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
    history?: TacticalGameHistory,
) {
    const [best, wrong, goodReply, badReply] = [better, played, betterReply, playedReply];
    if (
        [best, wrong, goodReply, badReply].some(
            (line) => line.cp === null || line.mate != null || line.depth < 16,
        ) ||
        best.depth !== wrong.depth ||
        best.cp! - wrong.cp! < 90 ||
        badReply.cp! - goodReply.cp! < 90 ||
        Math.abs(best.cp! + goodReply.cp!) > 90 ||
        Math.abs(wrong.cp! + badReply.cp!) > 90
    )
        return null;
    const good = safeLine(fen, best, history),
        bad = safeLine(fen, wrong, history);
    const independentGood = exactReply(fen, better, betterReply, history);
    const independentBad = exactReply(fen, played, playedReply, history);
    if ([good, bad, independentGood, independentBad].some((line) => line.length < 3)) return null;
    return { good, bad, independentGood, independentBad };
}

export function nominateCheckingDefence(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
    history?: TacticalGameHistory,
): CheckingDefenceRequest | null {
    const pair = checkedPair(fen, better, played, betterReply, playedReply, history);
    return pair ? findCaptureContrast(fen, pair) : null;
}

function findCaptureContrast(
    fen: string,
    pair: NonNullable<ReturnType<typeof checkedPair>>,
): CheckingDefenceRequest | null {
    const { good: better, bad, independentBad } = pair;
    const proposal = replayTacticalLine(fen, [
        better[0].uci,
        ...bad.slice(1, 7).map((step) => step.uci),
    ]);
    if (proposal.length < 2) return null;
    const good = trace(proposal),
        actual = trace(bad);
    for (
        let index = 1;
        index < Math.min(proposal.length, bad.length, independentBad.length);
        index++
    ) {
        const attack = bad[index],
            control = proposal[index];
        const { from, to } = attack.move;
        if (
            attack.uci !== independentBad[index].uci ||
            attack.capture !== control.capture ||
            actual.positions[index].get(from) !== good.positions[index].get(from) ||
            actual.positions[index].get(to) !== good.positions[index].get(to) ||
            attack.move.promotion ||
            castlingSide(attack.before, attack.move) ||
            (attack.before.epSquare === to) !== (control.before.epSquare === to)
        )
            break;
        if (index % 2 === 0 || !attack.after.ctx().checkers.has(to)) continue;
        const candidates: string[] = [];
        for (const [source, destinations] of control.after.allDests()) {
            if (!destinations.has(to)) continue;
            if (control.after.board.get(source)?.role === "pawn" && (to < 8 || to >= 56)) continue;
            if (attack.after.isLegal({ from: source, to })) continue;
            const other = squareOf(
                actual.positions[index + 1],
                good.positions[index + 1].get(source)!,
            );
            if (other !== undefined && attack.after.isLegal({ from: other, to })) continue;
            candidates.push(makeUci({ from: source, to }));
        }
        if (!candidates.length) continue;
        const checkpoint = (steps: TacticalReplayStep[]) => ({
            fen: makeFen(steps[index].after.toSetup()),
            prefix: steps.slice(0, index + 1).map((step) => step.uci),
        });
        return {
            better: checkpoint(proposal),
            played: checkpoint(bad),
            captures: candidates.sort(),
        };
    }
    return null;
}

function checkedContinuation(
    fen: string,
    checkpoint: DecisionCheckpoint,
    reply: DecisionEngineLine,
    history?: TacticalGameHistory,
) {
    if (reply.depth < 16 || measureDecisionLine(checkpoint.fen, reply)?.drawnEnding !== false)
        return [];
    return safeLine(
        fen,
        {
            ...reply,
            fen,
            pvUci: [...checkpoint.prefix, ...reply.pvUci],
        },
        history,
    );
}

const evaluation = (line: DecisionEngineLine) =>
    line.mate == null ? line.cp : Math.sign(line.mate) * (10_000 - Math.abs(line.mate));

function retainedDifference(strong: Trace, weak: Trace[], checkpoint: number) {
    const root = strong.steps[0].before;
    const maximum = Math.min(strong.steps.length, ...weak.map((line) => line.steps.length));
    const targets = [...weak[0].removed.keys()]
        .filter(
            (square) =>
                root.board.get(square)?.color === root.turn &&
                weak.every((line) => (line.removed.get(square) ?? 0) > checkpoint),
        )
        .map((square) => ({
            square,
            lost: Math.max(...weak.map((line) => line.removed.get(square)!)),
        }))
        .sort(
            (a, b) =>
                a.lost - b.lost ||
                material[root.board.get(b.square)!.role] - material[root.board.get(a.square)!.role],
        );
    for (const { square, lost } of targets)
        for (let end = lost + 2; end <= Math.min(lost + 6, maximum); end++) {
            const last = (line: Trace) =>
                line.steps.slice(end - 3, end).map((step) => step.balance);
            const defended = Math.min(...last(strong)),
                played = Math.max(...weak.flatMap(last));
            if (played <= -90 && defended - played >= 90)
                return { square, end, difference: defended - played };
        }
    return null;
}

export function confirmCheckingDefence(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
    probe: CheckingDefenceProbe,
    history?: TacticalGameHistory,
) {
    const pair = checkedPair(fen, better, played, betterReply, playedReply, history);
    if (!pair) return null;
    const request = findCaptureContrast(fen, pair);
    if (!request || !request.captures.includes(probe.capture.pvUci[0])) return null;
    const defence = evaluation(probe.capture),
        loss = evaluation(probe.played);
    if (
        defence == null ||
        loss == null ||
        defence < better.cp! - 75 ||
        defence - loss < 100 ||
        Math.abs(loss - played.cp!) > 125
    )
        return null;
    const guarded = checkedContinuation(fen, request.better, probe.capture, history);
    const repeated = checkedContinuation(fen, request.played, probe.played, history);
    if (!guarded.length || !repeated.length) return null;
    const strong = trace(guarded),
        weak = [trace(pair.bad), trace(pair.independentBad), trace(repeated)];
    const onset = request.played.prefix.length;
    const proof = retainedDifference(strong, weak, onset);
    if (!proof) return null;
    const pawnRequest = nominatePasser(pair, weak, onset);
    const victim = pair.bad[0].before.board.get(proof.square)!;
    const check = pair.bad[onset - 1],
        answer = guarded[onset];
    const failure = `The played searches lose the ${victim.role} that started on ${makeSquare(proof.square)}.`;
    const comparison =
        strong.removed.has(proof.square) && strong.removed.get(proof.square)! <= proof.end
            ? `${failure} The defence can trade that same piece and retain more material.`
            : failure;
    const points = proof.difference / 100;
    const moves = (steps: TacticalReplayStep[]) =>
        steps.slice(0, proof.end).map((step) => step.uci);
    const episode: TacticalMistakeEpisode = {
        kind: "comparative",
        materialDifferencePoints: points,
        throughPly: proof.end,
        mechanisms: [],
        betterLineUci: moves(pair.good),
        playedLineUci: moves(repeated),
        controlLineUci: moves(guarded),
        explanation: `After ${pair.bad[0].san}, ${check.san} cannot be met with ${answer.san}. That capture is available against the same attack after ${pair.good[0].san}. ${comparison} The defence keeps at least ${points} more material ${points === 1 ? "point" : "points"} over the compared moves.`,
    };
    return { episode, pawnRequest };
}

const rank = (square: Square, side: Color) =>
    side === "white" ? Math.floor(square / 8) : 7 - Math.floor(square / 8);
function isPasser(position: Chess, square: Square, side: Color) {
    return ![...position.board.pawn.intersect(position.board[opposite(side)])].some(
        (enemy) =>
            Math.abs((enemy % 8) - (square % 8)) <= 1 && rank(enemy, side) > rank(square, side),
    );
}

function nominatePasser(
    pair: NonNullable<ReturnType<typeof checkedPair>>,
    weak: Trace[],
    onset: number,
): PassedAdvanceRequest | null {
    const root = pair.bad[0].before,
        side = opposite(root.turn);
    for (const origin of root.board.pawn.intersect(root.board[side])) {
        if (!isPasser(root, origin, side)) continue;
        const advances = weak.map((line) =>
            line.steps.findIndex(
                (step, index) =>
                    index >= onset &&
                    index < 12 &&
                    step.before.turn === side &&
                    line.positions[index].get(step.move.from) === origin &&
                    step.before.board.get(step.move.from)?.role === "pawn" &&
                    rank(step.move.to, side) === 6 &&
                    step.after
                        .kingAttackers(step.move.to, side, step.after.board.occupied)
                        .nonEmpty() &&
                    line.positions[index + 3] &&
                    squareOf(line.positions[index + 3], origin) !== undefined,
            ),
        );
        const ply = advances[0];
        if (
            ply < 1 ||
            advances.some((index) => index !== ply) ||
            weak.some((line) => line.steps[ply].uci !== weak[0].steps[ply].uci)
        )
            continue;
        const advance = weak[0].steps[ply].uci;
        const attempt = weak[0].steps[ply].move;
        const checkpoints: DecisionCheckpoint[] = [];
        for (const good of [pair.good, pair.independentGood]) {
            if (good.length < ply + 3) break;
            const checked = trace(good);
            if (
                checked.positions[ply].get(attempt.from) !== origin ||
                !good[ply - 1].after.isLegal(attempt)
            )
                break;
            const later = squareOf(checked.positions[ply + 3], origin);
            if (later !== undefined && rank(later, side) === 6) break;
            const after = good[ply - 1].after.clone();
            after.play(attempt);
            checkpoints.push({
                fen: makeFen(after.toSetup()),
                prefix: [...good.slice(0, ply).map((step) => step.uci), advance],
            });
        }
        if (checkpoints.length !== 2 || checkpoints[0].fen === checkpoints[1].fen) continue;
        return { origin, advance, checks: [checkpoints[0], checkpoints[1]], throughPly: ply + 3 };
    }
    return null;
}

export function confirmPassedAdvance(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    request: PassedAdvanceRequest,
    replies: DecisionEngineLine[],
    history?: TacticalGameHistory,
): PassedAdvanceEvidence | null {
    if (replies.length !== 2) return null;
    const lines: TacticalReplayStep[][] = [];
    for (const [index, checkpoint] of request.checks.entries()) {
        const reply = replies[index];
        const value = evaluation(reply);
        if (value == null || value < Math.max(better.cp! - 75, played.cp! + 120)) return null;
        const steps = checkedContinuation(fen, checkpoint, reply, history);
        if (!steps.length) return null;
        const capture = trace(steps).removed.get(request.origin);
        if (
            capture === undefined ||
            capture < checkpoint.prefix.length ||
            capture > checkpoint.prefix.length + 5
        )
            return null;
        const before = steps[capture - 2].balance,
            window = steps.slice(capture - 1, capture + 2);
        if (window.length !== 3 || window.some((step) => step.balance < before)) return null;
        lines.push(steps.slice(0, capture + 2));
    }
    const square = makeSquare(request.origin);
    const pawn = parseUci(request.advance);
    const [playedMove] = replayTacticalLine(fen, played.pvUci.slice(0, 1));
    if (!pawn || !("to" in pawn) || !playedMove) return null;
    const destination = makeSquare(pawn.to);
    return {
        factor: {
            feature: "passed-pawn",
            side: opposite(lines[0][0].before.turn),
            squareOrFile: destination[0],
            firstPly: request.throughPly - 2,
            lastConsecutivePly: request.throughPly,
            support: "board-fact",
            comparison: "alternative-choice",
            comparisonMoveUci: played.pvUci[0],
            comparisonGapCp: better.cp! - played.cp!,
            supportInComparison: false,
            interpretation: "heuristic",
            description: `The original passed pawn on ${square} reaches ${destination} with support after ${playedMove.san}. After ${lines[0][0].san}, the same advance in either compared line allows the pawn to be taken without a material loss in the immediate reply sequence.`,
        },
        testedAdvanceLines: lines.map((steps) => steps.map((step) => step.uci)),
    };
}
