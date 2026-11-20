import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import { legalMoves, mayGiveCheck, replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
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

type Method = "nominated" | "checking" | "all";
const PROOF_BUDGET = 4096;

function orderedStarts(position: Chess, first?: string) {
    const tested = first && parseUci(first);
    const preferred = tested && "from" in tested && position.isLegal(tested) ? tested : null;
    const moves = legalMoves(position);
    const checks: NormalMove[] = [];
    const quiet: NormalMove[] = [];
    for (const move of moves) {
        if (preferred && makeUci(move) === makeUci(preferred)) continue;
        (mayGiveCheck(position, move) ? checks : quiet).push(move);
    }
    return { preferred, checks, quiet };
}

function stopSameAttack(
    position: Chess,
    first: NormalMove,
    budget: MateBudget,
): NormalMove | undefined {
    if (!position.isLegal(first)) return undefined;
    const attacked = playShortMateMove(position, first, budget);
    const priority = (move: NormalMove) =>
        attacked.board.get(move.to)?.color === position.turn ? (move.to === first.to ? 2 : 1) : 0;
    return legalMoves(attacked)
        .sort((a, b) => priority(b) - priority(a))
        .find((reply) => !mateOnNextMove(playShortMateMove(attacked, reply, budget), budget));
}

/** The played choice allows a two-move mate on the actual board. The
 * stronger engine choice also has to rule out every mate within that
 * distance. The local tree can decide without a complete mating PV. */
export function findAllowedMateInTwo(
    fen: string,
    better: DecisionEngineLine,
    playedMove: string | undefined,
    history?: TacticalGameHistory,
    attackHint?: string,
    method: Method = "all",
): DecisionMateConsequence | null {
    if (
        !playedMove ||
        playedMove === better.pvUci[0] ||
        better.depth < 16 ||
        better.cp === null ||
        better.mate != null
    )
        return null;
    const [actual] = replayTacticalLine(fen, [playedMove]);
    const [alternative] = replayTacticalLine(fen, better.pvUci.slice(0, 1));
    if (
        !actual ||
        !alternative ||
        actual.after.isEnd() ||
        alternative.after.isEnd() ||
        actual.before.halfmoves >= 95 ||
        makeFen(actual.after.toSetup()) === makeFen(alternative.after.toSetup()) ||
        !measureDecisionLine(fen, better)
    )
        return null;

    const context = history ? readTacticalRepetitionContext(fen, history) : null;
    const reached = context && advanceTacticalRepetitionContext(context, actual.uci);
    if (history && (!reached || reached.endedAtPly !== undefined)) return null;

    const budget: MateBudget = { remaining: PROOF_BUDGET };
    try {
        if (mateOnNextMove(actual.after, budget)) return null;
        const { preferred, checks, quiet } = orderedStarts(actual.after, attackHint);
        const starts =
            method === "nominated"
                ? preferred
                    ? [preferred]
                    : []
                : method === "checking"
                  ? checks
                  : [...(preferred ? [preferred] : []), ...checks, ...quiet];
        for (const first of starts) {
            const forced = mateInTwoFromMove(actual.after, first, budget, method === "checking");
            if (!forced) continue;
            let lineUci = forced.map(makeUci);
            if (history && reached?.hasRepeatedPositions) {
                const local = proveHistoryAwareMate(
                    makeFen(actual.after.toSetup()),
                    lineUci,
                    { fen: history.fen, moves: [...history.moves, actual.uci] },
                    2,
                    PROOF_BUDGET,
                );
                if (local.status !== "proven") continue;
                // Retain the published line only if the exact history also
                // plays it to checkmate without an automatic draw.
                let route = reached;
                for (const move of lineUci) {
                    const next = advanceTacticalRepetitionContext(route, move);
                    if (!next || next.endedAtPly !== undefined) {
                        lineUci = [];
                        break;
                    }
                    route = next;
                }
                if (lineUci.length !== 3) continue;
            }
            // A failed local search can be used as absence only if it ran
            // to completion. Budget exhaustion unwinds the entire check.
            if (
                mateOnNextMove(alternative.after, budget) ||
                legalMoves(alternative.after).some((move) =>
                    mateInTwoFromMove(alternative.after, move, budget),
                )
            )
                return null;
            const attack = makeSan(actual.after, first);
            let explanation = `${actual.san} allows mate in two starting with ${attack}. ${alternative.san} avoids mate within two moves.`;
            let avoidingLineUci: string[] | undefined;
            if (!alternative.after.isLegal(first)) {
                explanation += ` It takes away ${attack} as a legal reply.`;
            } else {
                try {
                    const answer = stopSameAttack(alternative.after, first, budget);
                    if (answer) {
                        const move = makeUci(first);
                        const defence = makeUci(answer);
                        const alt =
                            context && advanceTacticalRepetitionContext(context, alternative.uci);
                        const attempted = alt && advanceTacticalRepetitionContext(alt, move);
                        const met =
                            attempted && advanceTacticalRepetitionContext(attempted, defence);
                        if (!history || (alt && attempted && met && met.endedAtPly === undefined)) {
                            const attacked = alternative.after.clone();
                            attacked.play(first);
                            explanation += ` If the opponent tries ${makeSan(alternative.after, first)} anyway, ${makeSan(attacked, answer)} stops mate on the next move.`;
                            avoidingLineUci = [alternative.uci, move, defence];
                        }
                    }
                } catch (error) {
                    if (error !== MATE_BUDGET_EXHAUSTED) throw error;
                }
            }
            return {
                kind: "allowed",
                mateIn: 2,
                proof: "legal",
                lineUci: [actual.uci, ...lineUci],
                avoidingMoveUci: alternative.uci,
                ...(avoidingLineUci ? { avoidingLineUci } : {}),
                explanation,
            };
        }
        return null;
    } catch (error) {
        if (error !== MATE_BUDGET_EXHAUSTED) throw error;
        return null;
    }
}
