import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import type { NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import { legalMoves, mayGiveCheck, replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import {
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "@/utils/tacticalMotifs/decisionEvidence";
import type { DecisionMateConsequence } from "@/utils/tacticalMotifs/decisionMateConsequence";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";
import { proveHistoryAwareMate } from "@/utils/tacticalMotifs/historyAwareMate";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
} from "@/utils/tacticalMotifs/repetitionHistory";
import {
    MATE_BUDGET_EXHAUSTED,
    mateInTwoFromMove,
    mateOnNextMove,
    playShortMateMove,
    type MateBudget,
} from "@/utils/tacticalMotifs/shortMateProof";

type SearchMethod = "nominated" | "checking" | "all";
type DefenceMethod = "all" | "shown";

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

function nominatedAttacks(
    better: DecisionEngineLine,
    played: DecisionEngineLine | undefined,
    pair: DecisionEngineLine[],
    replyFen: string,
    replies: DecisionEngineLine[],
) {
    const hints = [];
    if (
        played &&
        played.depth >= 16 &&
        measureDecisionLine(better.fen, played)?.drawnEnding === false &&
        (played.mate != null
            ? played.mate <= -3
            : played.cp != null && better.cp! - played.cp >= 180 && played.cp <= -300)
    ) {
        if (
            pair[0]?.pvUci[0] === better.pvUci[0] &&
            pair[0].depth === played.depth &&
            played.pvUci[1]
        ) {
            hints.push(played.pvUci[1]);
        }
    }
    const reply = replies[0];
    if (
        reply &&
        reply.depth >= 16 &&
        measureDecisionLine(replyFen, reply)?.drawnEnding === false &&
        (reply.mate != null
            ? reply.mate >= 3
            : reply.cp != null && reply.cp >= 330 && better.cp! + reply.cp >= 180)
    )
        hints.unshift(reply.pvUci[0]);

    return [...new Set(hints)];
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

export function proveAllowedMateInThree(
    fen: string,
    leading: DecisionEngineLine,
    playedMove: string | undefined,
    pair: DecisionEngineLine[],
    replies: DecisionEngineLine[],
    history: TacticalGameHistory | undefined,
    method: SearchMethod,
    defence: DefenceMethod,
    leadingOnly = false,
): DecisionMateConsequence | null {
    const paired = pair[0];
    const better =
        !leadingOnly &&
        paired &&
        paired.pvUci[0] === leading.pvUci[0] &&
        paired.depth >= leading.depth &&
        measurePositionDecision(fen, pair)?.lines.length === pair.length
            ? paired
            : leading;
    if (
        !playedMove ||
        playedMove === better.pvUci[0] ||
        better.depth < 16 ||
        better.cp === null ||
        better.mate != null ||
        measureDecisionLine(fen, better)?.drawnEnding !== false
    )
        return null;

    const playedLine = pair.find((line) => line.pvUci[0] === playedMove);
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
    const hints = nominatedAttacks(better, playedLine, pair, attackedFen, replies);
    if (!hints.length) return null;

    const rootHistory = history ? readTacticalRepetitionContext(fen, history) : null;
    const playedHistory = rootHistory && advanceTacticalRepetitionContext(rootHistory, playedMove);
    if (history && (!playedHistory || playedHistory.endedAtPly !== undefined)) return null;
    const starts = legalMoves(actual.after);
    const selected = hints.flatMap((uci) => {
        const move = parseUci(uci);
        return move && "from" in move && actual.after.isLegal(move) ? [move] : [];
    });
    if (method !== "nominated")
        selected.push(
            ...order(actual.after, starts).filter(
                (move) =>
                    !hints.includes(makeUci(move)) &&
                    (method === "all" || mayGiveCheck(actual.after, move)),
            ),
        );

    const proofBudget = { remaining: 8192 };
    const defenceBudget = { remaining: 24000 };
    try {
        for (const start of selected) {
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
            const defenceHistory =
                rootHistory && advanceTacticalRepetitionContext(rootHistory, stronger.uci);
            if (history && (!defenceHistory || defenceHistory.endedAtPly !== undefined))
                return null;
            const sameAttack = stronger.after.isLegal(start);
            const refuted = sameAttack
                ? proveStart(stronger.after, start, defenceBudget)
                : undefined;
            if (refuted?.line) continue;
            if (
                defence === "all" &&
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
            const within = "within three moves";
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
                ...(defence === "all" ? { avoidingMoveUci: stronger.uci } : {}),
                ...(defence === "all" && attempt && answer
                    ? { avoidingLineUci: [stronger.uci, attempt.uci, makeUci(answer)] }
                    : {}),
                explanation: `${actual.san} permits ${attackSan}, which forces mate ${within}. ${stronger.san} ${defence === "all" ? `avoids mate ${within}.` : "stops that attack."}${contrast}`,
            };
        }
        return null;
    } catch (error) {
        if (error !== MATE_BUDGET_EXHAUSTED) throw error;
        return null;
    }
}
