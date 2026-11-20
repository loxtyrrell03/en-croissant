import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import { legalMoves, replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { QuietMateThreat } from "./decisionQuietMateThreat";
import type { TacticalGameHistory } from "./gameHistory";
import { proveHistoryAwareMate } from "./historyAwareMate";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";

import {
    MATE_BUDGET_EXHAUSTED,
    mateInTwoFromMove,
    mateOnNextMove,
    playShortMateMove,
    type MateBudget,
} from "./shortMateProof";

type ThreatSearch = "searched" | "legal-example";
const PROOF_BUDGET = 3072;

function checkingStarts(position: Chess, budget: MateBudget) {
    return legalMoves(position).filter((move) => mateInTwoFromMove(position, move, budget, true));
}

/** Certify a new threat after a quiet move. Changing the turn only
 * nominates a check. A separate legal branch must actually allow it
 * to force mate, and both leading defences must stop it. */
export function findQuietMateInTwoThreat(
    fen: string,
    root: DecisionEngineLine,
    replies: DecisionEngineLine[],
    history?: TacticalGameHistory,
    method: ThreatSearch = "legal-example",
): QuietMateThreat | null {
    const [main, ...alternatives] = replies;
    if (
        root.depth < 16 ||
        root.cp === null ||
        root.cp < -100 ||
        root.mate != null ||
        main?.cp == null ||
        main.mate != null ||
        main.depth < 16 ||
        Math.abs(root.cp + main.cp) > 90 ||
        !root.pvUci[1] ||
        !measureDecisionLine(fen, root)
    )
        return null;
    const [quiet] = replayTacticalLine(fen, [root.pvUci[0]]);
    if (
        !quiet ||
        quiet.capture ||
        quiet.move.promotion ||
        quiet.before.isCheck() ||
        quiet.after.isCheck() ||
        quiet.before.halfmoves >= 95 ||
        quiet.after.isEnd()
    )
        return null;
    const reachedFen = makeFen(quiet.after.toSetup());
    if (!measureDecisionLine(reachedFen, main)) return null;

    const context = history ? readTacticalRepetitionContext(fen, history) : null;
    const defended = context && advanceTacticalRepetitionContext(context, quiet.uci);
    if (history && (!defended || tacticalRepetitionClaim(defended))) return null;

    const budget = { remaining: PROOF_BUDGET };
    try {
        const stand = quiet.after.clone();
        stand.turn = quiet.before.turn;
        stand.epSquare = undefined;
        if (mateOnNextMove(stand, budget)) return null;
        const threats = checkingStarts(stand, budget);
        if (
            !threats.length ||
            mateOnNextMove(quiet.before, budget) ||
            checkingStarts(quiet.before, budget).length
        )
            return null;

        const responses = [...new Set([root.pvUci[1], main.pvUci[0]])];
        for (const uci of responses) {
            const [response] = replayTacticalLine(reachedFen, [uci]);
            if (
                !response ||
                response.after.isEnd() ||
                mateOnNextMove(response.after, budget) ||
                checkingStarts(response.after, budget).length
            )
                return null;
        }
        const witness = (reply: NormalMove, searched: boolean) => {
            const board = playShortMateMove(quiet.after, reply, budget);
            if (board.isEnd()) return null;
            const next = threats
                .map((move) => mateInTwoFromMove(board, move, budget, true))
                .find(Boolean);
            if (!next) return null;
            const [check, evasion, mate] = next;
            const continuation = [makeUci(check), makeUci(evasion), makeUci(mate)];
            if (history) {
                const arrived = advanceTacticalRepetitionContext(defended!, makeUci(reply));
                if (
                    !arrived ||
                    arrived.endedAtPly !== undefined ||
                    (arrived.hasRepeatedPositions &&
                        proveHistoryAwareMate(
                            makeFen(board.toSetup()),
                            continuation,
                            {
                                fen: history.fen,
                                moves: [...history.moves, quiet.uci, makeUci(reply)],
                            },
                            2,
                            PROOF_BUDGET,
                        ).status !== "proven")
                )
                    return null;
            }
            const defences = responses.map((uci) => makeSan(quiet.after, parseUci(uci)!));
            const ignored = makeSan(quiet.after, reply);
            const attack = makeSan(board, check);
            return {
                fen,
                defenceLinesUci: responses.map((uci): [string, string] => [quiet.uci, uci]),
                ignoredLineUci: [quiet.uci, makeUci(reply), ...continuation] as [
                    string,
                    string,
                    string,
                    ...string[],
                ],
                exampleWasSearched: searched,
                mateIn: 2 as const,
                explanation: `${quiet.san} sets up a mate-in-two threat. For example, ${ignored} allows ${attack}, which forces mate on the next move. ${defences.join(" and ")} stop${defences.length === 1 ? "s" : ""} that attack.`,
            };
        };
        const tried = new Set(responses);
        for (const line of alternatives) {
            if (
                tried.has(line.pvUci[0]) ||
                line.mate !== -2 ||
                !measureDecisionLine(reachedFen, line)
            )
                continue;
            const reply = parseUci(line.pvUci[0]);
            if (!reply || !("from" in reply)) continue;
            tried.add(line.pvUci[0]);
            const verified = witness(reply, true);
            if (verified) return verified;
        }
        if (method === "searched") return null;

        for (const reply of legalMoves(quiet.after)) {
            if (
                tried.has(makeUci(reply)) ||
                reply.promotion ||
                quiet.after.board.get(reply.to) ||
                (quiet.after.epSquare === reply.to &&
                    quiet.after.board.get(reply.from)?.role === "pawn")
            )
                continue;
            const verified = witness(reply, false);
            if (verified) return verified;
        }
        return null;
    } catch (error) {
        if (error !== MATE_BUDGET_EXHAUSTED) throw error;
        return null;
    }
}
