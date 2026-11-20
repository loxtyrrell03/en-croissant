import { attacks, between } from "chessops/attacks";
import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Piece, Square } from "chessops/types";
import { makeSquare } from "chessops/util";
import {
    replayTacticalLine,
    tacticalCaptureGain,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";
import { findInterferenceInLine } from "./interferenceInLine";
import type { TacticalGameHistory } from "./gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";
import type { TacticalMotifEvidence } from "./types";

const MAX_PLIES = 9;
const MIN_GAIN = 100;

function samePiece(actual: Piece | undefined, expected: Piece | undefined) {
    return (
        !!actual && !!expected && actual.role === expected.role && actual.color === expected.color
    );
}

function captureGain(step: TacticalReplayStep) {
    if (step.capture < 300 || step.after.isEnd()) return null;
    const gain = tacticalCaptureGain(step, 2048);
    return gain !== null && gain >= MIN_GAIN ? gain : null;
}

function staysOnInitialSquare(steps: TacticalReplayStep[], until: number, square: Square) {
    return steps
        .slice(0, until)
        .every(
            ({ before, move }) =>
                !castlingSide(before, move) && move.from !== square && move.to !== square,
        );
}

function reliablePrefix(steps: TacticalReplayStep[], history?: TacticalGameHistory | null) {
    let context = history
        ? readTacticalRepetitionContext(makeFen(steps[0].before.toSetup()), history)
        : null;
    if (history && !context) return 0;
    for (const [index, step] of steps.entries()) {
        if (
            step.before.halfmoves >= 100 ||
            step.before.isEnd() ||
            (context && tacticalRepetitionClaim(context))
        )
            return index;
        if (context) {
            context = advanceTacticalRepetitionContext(context, step.uci);
            if (!context || context.endedAtPly !== undefined) return index;
        }
    }
    return steps.length;
}

/** What did moving this exact defender change about this exact follow-up? */
function displacedDuty(
    root: TacticalReplayStep,
    reply: TacticalReplayStep,
    payoff: TacticalReplayStep,
) {
    const before = root.before;
    const { move } = payoff;
    const guard = before.board.get(reply.move.from);
    const attacker = before.board.get(move.from);
    if (
        !guard ||
        !attacker ||
        !samePiece(attacker, payoff.before.board.get(move.from)) ||
        !samePiece(guard, reply.before.board.get(reply.move.from)) ||
        move.from === root.move.from
    )
        return null;
    if (
        ["queen", "rook", "bishop"].includes(attacker.role) &&
        between(move.from, move.to).has(reply.move.from)
    ) {
        const beforeWithoutGuard = before.clone();
        beforeWithoutGuard.board.take(reply.move.from);
        return !before.isLegal(move) && beforeWithoutGuard.isLegal(move) ? "blocks" : null;
    }
    if (!before.isLegal(move)) return null;
    const premature = before.clone();
    premature.play(move);
    const recapture = { from: reply.move.from, to: move.to };
    if (!premature.isLegal(recapture)) return null;
    if (payoff.after.isCheckmate()) return "guards";
    const relocated = { from: reply.move.to, to: move.to };
    return tacticalExchangeGain(premature, recapture) >= MIN_GAIN &&
        tacticalExchangeGain(payoff.before, move) - tacticalExchangeGain(before, move) >=
            MIN_GAIN &&
        (!payoff.after.isLegal(relocated) ||
            tacticalExchangeGain(payoff.after, relocated) < MIN_GAIN)
        ? "guards"
        : null;
}

type Route = {
    id: "deflection" | "clearance" | "interference";
    through: number;
    text: string;
    squares: Square[];
    outcome: { mate: true } | { gain: number };
};

function deflection(
    steps: TacticalReplayStep[],
    scoredMaterial: boolean,
    scoredMate: boolean,
): Route | null {
    const [root, reply, firstPayoff] = steps;
    const guard = reply.before.board.get(reply.move.from);
    if (
        !reply.capture ||
        reply.move.to !== root.move.to ||
        reply.move.promotion ||
        guard?.role === "king" ||
        !guard
    )
        return null;
    const mate =
        scoredMate &&
        root.after.isCheck() &&
        steps.at(-1)?.after.isCheckmate() &&
        steps.length % 2 === 1 &&
        steps.filter((_, index) => index % 2 === 0).every((step) => step.after.isCheck())
            ? steps.at(-1)
            : undefined;
    const payoff = mate ?? firstPayoff;
    if (!staysOnInitialSquare(steps, mate ? steps.length - 1 : 2, payoff.move.from)) return null;
    if (
        !mate &&
        (!scoredMaterial ||
            !samePiece(
                root.before.board.get(payoff.move.to),
                payoff.before.board.get(payoff.move.to),
            ) ||
            payoff.capture < 300)
    )
        return null;
    const duty = displacedDuty(root, reply, payoff);
    if (!duty) return null;
    const guardSquare = makeSquare(reply.move.from);
    const destination = makeSquare(payoff.move.to);
    const outcome =
        duty === "blocks"
            ? `opens the route to ${destination}`
            : `removes its defence of ${destination}`;
    const start = `In this line, ${root.san} draws the ${guard.role} from ${guardSquare} with ${reply.san} and ${outcome}.`;
    const squares = [reply.move.from, reply.move.to, payoff.move.from, payoff.move.to];
    if (mate)
        return {
            id: "deflection",
            through: steps.length,
            text: `${start} The checking continuation ends with ${mate.san}.`,
            squares,
            outcome: { mate: true },
        };
    const gain = captureGain(payoff);
    if (gain !== null && reply.balance + gain >= MIN_GAIN)
        return {
            id: "deflection",
            through: 3,
            text: `${start} ${payoff.san} recovers the offer with material to spare.`,
            squares,
            outcome: { gain: reply.balance + gain },
        };
    // If the first capture is short of recovering the offer, require the
    // same displaced defender to be collected on the shown checking route.
    for (let index = 4; index < steps.length; index += 2) {
        const answer = steps[index];
        if (!steps[index - 2].after.isCheck()) break;
        if (steps[index - 1].move.from === reply.move.to) break;
        if (
            answer.move.to !== reply.move.to ||
            !samePiece(guard, answer.before.board.get(reply.move.to))
        )
            continue;
        const recovery = captureGain(answer);
        if (recovery !== null && steps[index - 1].balance + recovery >= MIN_GAIN)
            return {
                id: "deflection",
                through: index + 1,
                text: `${start} ${payoff.san} uses that route, and ${answer.san} takes the displaced ${guard.role} to recover the offer.`,
                squares,
                outcome: { gain: steps[index - 1].balance + recovery },
            };
        break;
    }
    return null;
}

function clearance(steps: TacticalReplayStep[], scoredMate: boolean): Route | null {
    const root = steps[0];
    const square = root.move.from;
    const old = root.before.board.get(square);
    if (!old) return null;
    const vacancy = makeSquare(square);
    for (const index of [2, 4]) {
        const entry = steps[index];
        if (
            !entry ||
            castlingSide(entry.before, entry.move) ||
            entry.before.board.has(square) ||
            !staysOnInitialSquare(steps, index, entry.move.from)
        )
            continue;
        const entrant = entry.before.board.get(entry.move.from);
        if (!entrant || !samePiece(entrant, root.before.board.get(entry.move.from))) continue;
        if (
            entry.move.to !== square &&
            !(
                ["bishop", "rook", "queen"].includes(entrant.role) &&
                between(entry.move.from, entry.move.to).has(square)
            )
        )
            continue;
        const blocked = entry.before.clone();
        blocked.board.set(square, old);
        if (blocked.isLegal(entry.move)) continue;
        const start = `In this line, ${root.san} clears ${vacancy}. The ${entrant.role} from ${makeSquare(entry.move.from)} uses the opening with ${entry.san}.`;
        const squares = [square, entry.move.from, entry.move.to];
        if (scoredMate && entry.after.isCheckmate())
            return {
                id: "clearance",
                through: index + 1,
                text: `${start} That move gives mate.`,
                squares,
                outcome: { mate: true },
            };
        const entryGain = captureGain(entry);
        if (entryGain !== null && steps[index - 1].balance + entryGain >= MIN_GAIN)
            return {
                id: "clearance",
                through: index + 1,
                text: `${start} That capture gains material along the cleared route.`,
                squares,
                outcome: { gain: steps[index - 1].balance + entryGain },
            };
        const payoff = steps[index + 2];
        if (
            !payoff ||
            payoff.move.from !== entry.move.to ||
            steps[index + 1].move.to === entry.move.to ||
            steps[index + 1].move.from === payoff.move.to ||
            !attacks(entrant, entry.move.to, entry.after.board.occupied).has(payoff.move.to) ||
            attacks(entrant, entry.move.from, entry.before.board.occupied).has(payoff.move.to)
        )
            continue;
        const payoffGain = captureGain(payoff);
        if (payoffGain !== null && steps[index + 1].balance + payoffGain >= 0)
            return {
                id: "clearance",
                through: index + 3,
                text: `${start} From there it can attack the ${payoff.before.board.get(payoff.move.to)!.role} on ${makeSquare(payoff.move.to)}, which it captures with ${payoff.san}.`,
                squares: [...squares, payoff.move.to],
                outcome: { gain: steps[index + 1].balance + payoffGain },
            };
    }
    return null;
}

/** Checked witnesses from one viable scored variation. Their scope is
 * explicitly local to its replies, including the actual route to the payoff. */
export function findScoredLineRoutes(
    fen: string,
    pv: string[],
    cp: number | null | undefined,
    mate: number | null | undefined,
    depth: number | undefined,
    history?: TacticalGameHistory | null,
) {
    const scoredMaterial =
        typeof cp === "number" && Number.isFinite(cp) && cp >= MIN_GAIN && mate == null;
    const scoredMate =
        cp == null && typeof mate === "number" && mate > 0 && mate <= (MAX_PLIES + 1) / 2;
    if (!depth || depth < 16 || pv.length < 3 || (!scoredMaterial && !scoredMate)) return [];
    const steps = replayTacticalLine(fen, pv.slice(0, MAX_PLIES));
    if (steps.length < 3 || castlingSide(steps[0].before, steps[0].move)) return [];
    const verified = steps.slice(0, reliablePrefix(steps, history));
    if (verified.length < 3) return [];
    return [
        deflection(verified, scoredMaterial, scoredMate),
        clearance(verified, scoredMate),
        findInterferenceInLine(verified, scoredMaterial, scoredMate),
    ]
        .filter((route): route is Route => route !== null)
        .map((route) => ({ ...route, moveUci: verified[0].uci }));
}

export function findLineRouteEvidence(
    fen: string,
    pv: string[],
    cp: number | null | undefined,
    mate: number | null | undefined,
    depth: number | undefined,
    history?: TacticalGameHistory | null,
): TacticalMotifEvidence[] {
    return findScoredLineRoutes(fen, pv, cp, mate, depth, history).map((route) => ({
        id: route.id,
        label: {
            deflection: "Deflection in this line",
            clearance: "Clearance in this line",
            interference: "Interference in this line",
        }[route.id],
        confidence: "high",
        source: "available",
        ply: 1,
        moveUci: route.moveUci,
        relevance: "secondary",
        lineThroughPly: route.through,
        evidence: route.text,
    }));
}
