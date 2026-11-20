import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import type { NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import { legalMoves, mayGiveCheck, replayTacticalLine } from "./causalTactics";
import {
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "./decisionEvidence";
import type { DecisionMateConsequence } from "./decisionMateConsequence";
import type { TacticalGameHistory } from "./gameHistory";
import { proveHistoryAwareMate } from "./historyAwareMate";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
} from "./repetitionHistory";
import {
    MATE_BUDGET_EXHAUSTED,
    mateInTwoFromMove,
    mateOnNextMove,
    playShortMateMove,
    type MateBudget,
} from "./shortMateProof";

function order(position: Chess, moves: NormalMove[]) {
    const priority = (move: NormalMove) =>
        Number(position.board.occupied.has(move.to)) * 2 + Number(mayGiveCheck(position, move));
    return moves
        .map((move) => ({ move, priority: priority(move) }))
        .sort((a, b) => b.priority - a.priority)
        .map((item) => item.move);
}

function mateWithinTwo(position: Chess, budget: MateBudget): NormalMove[] | null {
    if (position.isEnd() || position.halfmoves >= 100) return null;
    const one = mateOnNextMove(position, budget);
    if (one) return [one];
    for (const start of order(position, legalMoves(position))) {
        const two = mateInTwoFromMove(position, start, budget);
        if (two) return two;
    }
    return null;
}

function proveStart(position: Chess, start: NormalMove, budget: MateBudget) {
    const reached = playShortMateMove(position, start, budget);
    if (reached.isCheckmate()) return { line: [start] } as const;
    if (reached.isEnd() || reached.halfmoves >= 99) return { draw: true } as const;
    let longest: NormalMove[] = [];
    for (const reply of order(reached, legalMoves(reached))) {
        const next = playShortMateMove(reached, reply, budget);
        const win = mateWithinTwo(next, budget);
        if (!win) return { reply } as const;
        if (longest.length < win.length + 2) longest = [start, reply, ...win];
    }
    return { line: longest } as const;
}

function provedLineFromSan(position: Chess, sans: readonly string[]) {
    const copy = position.clone();
    const line: string[] = [];
    for (const san of sans) {
        const move = parseSan(copy, san);
        if (!move || !copy.isLegal(move)) return null;
        line.push(makeUci(move));
        copy.play(move);
    }
    return copy.isCheckmate() ? line : null;
}

/**
 * Reprove a searched short mate when the independent mate report is missing
 * or incomplete. Every defending reply is tested. The stronger choice
 * must also rule out every mate within the same distance.
 */
export function findAllowedMateInThree(
    fen: string,
    leading: DecisionEngineLine,
    playedMove: string | undefined,
    pair: DecisionEngineLine[],
    replies: DecisionEngineLine[],
    history: TacticalGameHistory | undefined,
): DecisionMateConsequence | null {
    if (!playedMove || playedMove === leading.pvUci[0]) return null;
    const played = pair.find((line) => line.pvUci[0] === playedMove);
    const reply = replies[0];
    const rootNomination = (played?.mate ?? 0) <= -3;
    const replyNomination = (reply?.mate ?? 0) >= 3;
    if (!rootNomination && !replyNomination) return null;
    const paired = pair[0];
    const validPair = Boolean(
        paired &&
        paired.pvUci[0] === leading.pvUci[0] &&
        measurePositionDecision(fen, pair)?.lines.length === pair.length,
    );
    const better = validPair && paired.depth >= leading.depth ? paired : leading;
    if (
        better.depth < 16 ||
        better.cp === null ||
        better.mate != null ||
        measureDecisionLine(fen, better)?.drawnEnding !== false
    )
        return null;

    const [actual] = replayTacticalLine(fen, [playedMove]);
    const [stronger] = replayTacticalLine(fen, better.pvUci.slice(0, 1));
    if (
        !actual ||
        !stronger ||
        actual.after.isEnd() ||
        stronger.after.isEnd() ||
        actual.before.halfmoves >= 94 ||
        makeFen(actual.after.toSetup()) === makeFen(stronger.after.toSetup())
    )
        return null;

    const attackedFen = makeFen(actual.after.toSetup());
    const hints = new Set<string>();
    if (
        reply &&
        replyNomination &&
        reply.depth >= 16 &&
        measureDecisionLine(attackedFen, reply)?.drawnEnding === false
    )
        hints.add(reply.pvUci[0]);
    if (played && rootNomination && validPair && played.depth === paired.depth && played.pvUci[1])
        hints.add(played.pvUci[1]);
    if (!hints.size) return null;

    const rootHistory = history ? readTacticalRepetitionContext(fen, history) : null;
    const playedHistory = rootHistory && advanceTacticalRepetitionContext(rootHistory, playedMove);
    const strongerHistory =
        rootHistory && advanceTacticalRepetitionContext(rootHistory, stronger.uci);
    if (
        history &&
        (!playedHistory ||
            playedHistory.endedAtPly !== undefined ||
            !strongerHistory ||
            strongerHistory.endedAtPly !== undefined)
    )
        return null;

    const proofBudget = { remaining: 8192 };
    const defenceBudget = { remaining: 24000 };
    try {
        for (const hint of hints) {
            const start = parseUci(hint);
            if (!start || !("from" in start) || !actual.after.isLegal(start)) continue;
            const proof = proveStart(actual.after, start, proofBudget);
            if (proof.line?.length !== 5) continue;
            let mateUci: string[] | null = proof.line.map(makeUci);
            if (playedHistory?.hasRepeatedPositions && history) {
                const confirmed = proveHistoryAwareMate(
                    attackedFen,
                    mateUci,
                    { fen: history.fen, moves: [...history.moves, actual.uci] },
                    3,
                    8192,
                );
                if (confirmed.status !== "proven" || confirmed.maxMoves !== 3) continue;
                mateUci = provedLineFromSan(actual.after, confirmed.line);
                if (!mateUci) continue;
            }

            const attackSan = makeSan(actual.after, start);
            const sameAttack = stronger.after.isLegal(start);
            const refuted = sameAttack
                ? proveStart(stronger.after, start, defenceBudget)
                : undefined;
            if (refuted?.line) continue;
            if (
                legalMoves(stronger.after).some(
                    (move) =>
                        makeUci(move) !== makeUci(start) &&
                        proveStart(stronger.after, move, defenceBudget).line?.length,
                )
            )
                return null;
            const [attempt] = sameAttack
                ? replayTacticalLine(makeFen(stronger.after.toSetup()), [makeUci(start)])
                : [];
            const answer = refuted?.reply;
            const contrast = !sameAttack
                ? ` It makes the same ${attackSan} reply illegal.`
                : attempt && answer
                  ? ` If ${makeSan(stronger.after, start)} is tried anyway, ${makeSan(attempt.after, answer)} stops that mating line.`
                  : "";
            return {
                kind: "allowed",
                mateIn: 3,
                proof: "legal",
                lineUci: [actual.uci, ...mateUci],
                avoidingMoveUci: stronger.uci,
                ...(attempt && answer
                    ? { avoidingLineUci: [stronger.uci, attempt.uci, makeUci(answer)] }
                    : {}),
                explanation: `${actual.san} permits ${attackSan}, which forces mate within three moves. ${stronger.san} avoids mate within three moves.${contrast}`,
            };
        }
        return null;
    } catch (error) {
        if (error !== MATE_BUDGET_EXHAUSTED) throw error;
        return null;
    }
}
