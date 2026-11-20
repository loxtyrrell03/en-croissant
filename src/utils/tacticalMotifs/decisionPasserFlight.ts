import { attacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { makeSquare, makeUci, opposite } from "chessops/util";
import { legalMoves, replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import type { DecisionCheckpoint } from "./decisionCheckingDefence";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import { followPieceIdentities, initialPieceIdentities } from "./decisionPieceIdentity";
import type { TacticalGameHistory } from "./gameHistory";
import { extractPositionalBoardFacts } from "./positionalEvidence";
import { tacticalRepetitionBoundary } from "./repetitionHistory";
import type { TacticalMistakeEpisode } from "./tacticalMistakeEpisode";

export type PasserFlightProbe = {
    better: DecisionEngineLine[];
    played: DecisionEngineLine;
};

type PasserFlightRequest = {
    better: DecisionCheckpoint;
    played: DecisionCheckpoint;
    betterSan: string;
    playedSan: string;
    betterCp: number;
    movedSquare: Square;
    pawn: Square;
    flights: Map<string, Square[]>;
};

function exactScore(
    fen: string,
    line: DecisionEngineLine | undefined,
): line is DecisionEngineLine & { cp: number } {
    return (
        !!line &&
        line.depth >= 16 &&
        line.cp !== null &&
        line.mate == null &&
        measureDecisionLine(fen, line)?.drawnEnding === false
    );
}

function checkpoint(steps: TacticalReplayStep[]): DecisionCheckpoint {
    return { fen: makeFen(steps.at(-1)!.after.toSetup()), prefix: steps.map((step) => step.uci) };
}

/** A geometric contrast only schedules a query. It cannot establish a tactic. */
export function nominatePasserFlight(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    replies: DecisionEngineLine[],
    history?: TacticalGameHistory,
): PasserFlightRequest | null {
    if (
        better.depth !== played.depth ||
        better.cp === null ||
        played.cp === null ||
        better.cp - played.cp < 120
    )
        return null;
    const [choice] = replayTacticalLine(fen, better.pvUci.slice(0, 1));
    const [actual] = replayTacticalLine(fen, played.pvUci.slice(0, 1));
    if (
        !choice ||
        !actual ||
        choice.uci === actual.uci ||
        choice.move.from !== actual.move.from ||
        choice.capture ||
        actual.capture ||
        choice.after.isCheck() ||
        actual.after.isCheck()
    )
        return null;
    const piece = choice.before.board.get(choice.move.from)!;
    if (!["rook", "bishop", "queen"].includes(piece.role)) return null;
    const enemy = opposite(piece.color);
    const actualFen = makeFen(actual.after.toSetup());
    const repliesByScore = [
        { uci: played.pvUci[1], cp: -played.cp },
        ...replies
            .filter((line) => line.cp !== null && line.mate == null && line.depth >= 16)
            .map((line) => ({ uci: line.pvUci[0], cp: line.cp!, line })),
    ];
    const passers = extractPositionalBoardFacts(fen)?.[enemy].passedPawns;
    if (!passers?.length) return null;
    for (const reply of repliesByScore) {
        if (!reply.uci || reply.cp + better.cp < 120) continue;
        const strong = replayTacticalLine(fen, [choice.uci, reply.uci]);
        const weak = replayTacticalLine(fen, [actual.uci, reply.uci]);
        const advance = strong[1];
        if (
            !advance ||
            !weak[1] ||
            advance.capture ||
            weak[1].capture ||
            advance.move.from >> 3 !== (enemy === "white" ? 5 : 2) ||
            advance.move.to - advance.move.from !== (enemy === "white" ? 8 : -8) ||
            !passers.includes(makeSquare(advance.move.from)) ||
            choice.before.board.get(advance.move.from)?.color !== enemy ||
            choice.before.board.get(advance.move.from)?.role !== "pawn"
        )
            continue;
        const flights = new Map<string, Square[]>();
        const onBetter = advance.after;
        const onPlayed = weak[1].after;
        for (const move of legalMoves(onPlayed)) {
            if (move.from === choice.move.to || move.promotion || !onBetter.isLegal(move)) continue;
            const lower = onPlayed.clone();
            lower.play(move);
            if (!lower.ctx().checkers.has(move.to)) continue;
            const upper = onBetter.clone();
            upper.play(move);
            if (!upper.ctx().checkers.has(move.to)) continue;
            const king = lower.board.kingOf(enemy);
            if (king === undefined || king !== upper.board.kingOf(enemy)) continue;
            const covering = upper.board.get(choice.move.to);
            if (!covering || covering.color !== piece.color || covering.role !== piece.role)
                continue;
            const lost = lower
                .dests(king)
                .diff(upper.dests(king))
                .intersect(attacks(covering, choice.move.to, upper.board.occupied));
            if (lost.nonEmpty()) flights.set(makeUci(move), [...lost]);
        }
        if (
            !flights.size ||
            !exactScore(fen, better) ||
            !exactScore(fen, played) ||
            ("line" in reply && !exactScore(actualFen, reply.line)) ||
            tacticalRepetitionBoundary(fen, choice.uci, history) ||
            tacticalRepetitionBoundary(fen, actual.uci, history)
        )
            continue;
        return {
            better: checkpoint(strong),
            played: checkpoint(weak),
            betterSan: choice.san,
            playedSan: actual.san,
            betterCp: better.cp,
            movedSquare: choice.move.to,
            pawn: advance.move.to,
            flights,
        };
    }
    return null;
}

export function selectPasserFlightCheck(request: PasserFlightRequest, lines: DecisionEngineLine[]) {
    const top = lines[0];
    if (!exactScore(request.better.fen, top)) return null;
    return (
        lines.find(
            (line) =>
                line.depth === top.depth &&
                request.flights.has(line.pvUci[0]) &&
                exactScore(request.better.fen, line) &&
                line.cp >= top.cp - 50 &&
                line.cp <= top.cp &&
                line.cp >= request.betterCp - 90,
        ) ?? null
    );
}

function pawnIntercepted(steps: TacticalReplayStep[], pawn: Square) {
    const identities = initialPieceIdentities(steps[0].before);
    for (const [index, step] of steps.entries()) {
        const captor = identities.get(step.move.from);
        if (followPieceIdentities(identities, step) === pawn)
            return { through: index + 1, captor, step };
    }
}

function counterplay(steps: TacticalReplayStep[], checker: Square, pawn: Square) {
    const identities = initialPieceIdentities(steps[0].before);
    let promotedAt: number | undefined;
    for (const [index, step] of steps.entries()) {
        if (step.move.promotion && identities.get(step.move.from) === pawn) promotedAt = index;
        const captured = followPieceIdentities(identities, step);
        if (
            index < 6 &&
            captured === checker &&
            step.before.board.get(step.move.from)?.role === "king"
        )
            return { through: index + 1, description: `${step.san} takes the checking piece` };
        if (captured === pawn) return;
        if (promotedAt !== undefined && index === promotedAt + 4)
            return {
                through: index + 1,
                description: `${steps[promotedAt].san} promotes the pawn`,
            };
    }
}

export function confirmPasserFlight(request: PasserFlightRequest, probe: PasserFlightProbe) {
    const better = selectPasserFlightCheck(request, probe.better);
    const played = probe.played;
    if (
        !better ||
        !exactScore(request.played.fen, played) ||
        better.cp === null ||
        played.pvUci[0] !== better.pvUci[0] ||
        better.cp - played.cp < 120
    )
        return null;
    const strong = replayTacticalLine(request.better.fen, better.pvUci.slice(0, 12));
    const weak = replayTacticalLine(request.played.fen, played.pvUci.slice(0, 12));
    const flight = weak[1];
    if (
        !flight ||
        flight.before.board.get(flight.move.from)?.role !== "king" ||
        !request.flights.get(better.pvUci[0])?.includes(flight.move.to)
    )
        return null;
    const stop = pawnIntercepted(strong, request.pawn);
    const survives = counterplay(weak, weak[0].move.from, request.pawn);
    if (!stop || !survives || stop.step.before.board.get(stop.step.move.to)?.role !== "pawn")
        return null;
    const betterLineUci = [...request.better.prefix, ...better.pvUci.slice(0, stop.through)];
    const playedLineUci = [...request.played.prefix, ...played.pvUci.slice(0, survives.through)];
    const square = makeSquare(flight.move.to);
    const episode: TacticalMistakeEpisode = {
        kind: "forcing-attack",
        mechanisms: [],
        betterLineUci,
        playedLineUci,
        throughPly: Math.max(betterLineUci.length, playedLineUci.length),
        explanation: `${request.betterSan} covers ${square}. After the same pawn push, ${strong[0].san} gives check and ${flight.san} is unavailable. The searched line stops the passer with ${stop.step.san}. After ${request.playedSan}, ${flight.san} is legal and ${survives.description}.`,
    };
    const rookPlan =
        stop.captor === request.movedSquare &&
        stop.step.before.board.get(stop.step.move.from)?.role === "rook" &&
        request.movedSquare % 8 === request.pawn % 8
            ? `The rook on ${makeSquare(request.movedSquare)} works along the passed pawn's file and takes it in the searched continuation.`
            : undefined;
    return { episode, rookPlan };
}
