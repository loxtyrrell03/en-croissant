import { makeSquare } from "chessops/util";
import { type Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import { type TacticalGameHistory } from "./gameHistory";
import { findScoredLineRoutes } from "./lineRouteEvidence";
import type { ComparativePositionalEvidence } from "./positionalTransitions";
import { type TacticalSequenceWitness } from "./tacticalSequenceEvidence";

function retainedPayoff(
    fen: string,
    line: DecisionEngineLine,
    through: number,
    allowRetained: boolean,
) {
    const steps = replayTacticalLine(fen, line.pvUci.slice(0, through + 8));
    const payoff = steps[through - 1];
    if (!payoff) return null;
    if (payoff.after.isCheckmate()) return through;
    let settledAt = through - 1;
    while (steps[settledAt + 1]?.move.to === payoff.move.to && steps[settledAt + 1].capture)
        settledAt++;
    const target = Math.max(100, steps[through - 2].balance + 100);
    if (steps[settledAt].balance < target) return null;
    const following = steps.slice(settledAt + 1, settledAt + 3);
    if (
        allowRetained &&
        following.length === 2 &&
        following.every((step) => step.balance >= target)
    )
        return settledAt + 1;
    for (let index = settledAt + 2; index < steps.length; index++) {
        const window = steps.slice(index - 1, index + 1);
        if (
            window.every((step) => !step.capture && !step.move.promotion && !step.after.isCheck())
        ) {
            return window.every((step) => step.balance >= target) ? settledAt + 1 : null;
        }
    }
    return null;
}

function witnesses(
    fen: string,
    line: DecisionEngineLine,
    turn: Chess["turn"],
    history: TacticalGameHistory | undefined,
    method: RouteMethod,
) {
    return findScoredLineRoutes(fen, line.pvUci, line.cp, line.mate, line.depth, history)
        .filter((route) => "mate" in route.outcome || route.outcome.gain >= 100)
        .flatMap((route) => {
            const through =
                method === "leading-reply" || method === "repeated"
                    ? route.through
                    : retainedPayoff(fen, line, route.through, method === "retained");
            if (through === null) return [];
            return [
                {
                    fen,
                    mechanism: route.id,
                    actor: turn,
                    mechanismPly: 1,
                    payoffPly: route.through,
                    squares: route.squares.map(makeSquare),
                    description: route.text,
                    support: "legal-continuation" as const,
                    rootMoveInvolved: true,
                    lineUci: line.pvUci.slice(0, through),
                },
            ];
        });
}

type RouteMethod = "repeated" | "leading-reply" | "settled" | "retained";

/** Match a legal tactical dependency in independently searched lines.
 * Keep each witness attached to the exact continuation and payoff. */
export function corroborateDecisionLineRoutes(
    fen: string,
    root: DecisionEngineLine,
    reply: DecisionEngineLine,
    history?: TacticalGameHistory,
    method: RouteMethod = "retained",
): TacticalSequenceWitness[] {
    const agrees =
        root.mate == null
            ? root.cp !== null &&
              root.cp >= 100 &&
              reply.mate == null &&
              reply.cp !== null &&
              reply.cp <= -100 &&
              Math.abs(root.cp + reply.cp) <= 90
            : root.mate > 0 && reply.mate != null && reply.mate < 0;
    if (!agrees || root.depth < 16 || reply.depth < 16) return [];
    const entry = replayTacticalLine(fen, root.pvUci.slice(0, 1))[0];
    if (
        !entry ||
        measureDecisionLine(fen, root)?.drawnEnding !== false ||
        measureDecisionLine(makeFen(entry.after.toSetup()), reply)?.drawnEnding !== false
    )
        return [];

    const after = witnesses(
        fen,
        {
            ...reply,
            fen,
            cp: reply.cp === null ? null : -reply.cp,
            mate: reply.mate == null ? null : -reply.mate,
            pvUci: [root.pvUci[0], ...reply.pvUci],
        },
        entry.before.turn,
        history,
        method,
    );
    if (!after.length || method === "leading-reply") return after;

    const before = witnesses(fen, root, entry.before.turn, history, method);
    return after.filter((route) =>
        before.some(
            (previous) =>
                route.mechanism === previous.mechanism &&
                route.squares.length === previous.squares.length &&
                route.squares.every((square, index) => square === previous.squares[index]),
        ),
    );
}

/** Losing a pawn or bishop can change structure as part of the material
 * event. A separate comparison can corroborate its strategic relevance. */
export function isStructuralEffectFromTacticalCapture(
    fen: string,
    moveUci: string,
    factor: ComparativePositionalEvidence,
) {
    if (
        factor.firstPly !== 1 ||
        factor.comparison !== "separate-reply-search" ||
        factor.materialWindowPlies !== undefined
    )
        return false;
    const [step] = replayTacticalLine(fen, [moveUci]);
    if (!step?.capture) return false;
    const enPassant =
        step.before.epSquare === step.move.to &&
        step.before.board.get(step.move.from)?.role === "pawn";
    const target = enPassant
        ? step.move.to + (step.before.turn === "white" ? -8 : 8)
        : step.move.to;
    const taken = step.before.board.get(target);
    if (!taken || taken.color !== factor.side) return false;
    if (factor.feature === "bishop-pair-removal") return taken.role === "bishop";
    if (factor.feature !== "isolated-pawn" || taken.role !== "pawn") return false;
    return Math.abs(factor.squareOrFile.charCodeAt(0) - makeSquare(target).charCodeAt(0)) === 1;
}
