import { makeSquare, opposite, parseUci } from "chessops/util";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { NormalMove } from "chessops/types";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import {
    extractTacticalSequenceWitnesses,
    sameTacticalMechanism,
    type TacticalSequenceWitness,
} from "./tacticalSequenceEvidence";

export type TacticalMistakeEpisode = {
    throughPly: number;
    betterLineUci: string[];
    playedLineUci: string[];
    controlLineUci?: string[];
    mechanisms: TacticalSequenceWitness[];
    explanation: string;
} & (
    | { kind: "comparative"; materialDifferencePoints: number }
    | { kind: "concession"; materialConcededPoints: number }
    | { kind: "forcing-attack" }
    | { kind: "trap"; checkedReplies: number }
);

function capturedSquare(step: TacticalReplayStep) {
    const { before, move } = step;
    return before.epSquare === move.to && before.board.get(move.from)?.role === "pawn"
        ? move.to + (before.turn === "white" ? -8 : 8)
        : move.to;
}

function explainDirectCapture(
    better: TacticalReplayStep,
    reply: TacticalReplayStep,
    counterfactualGain: number,
    captureIsLegal: boolean,
) {
    const square = capturedSquare(reply);
    const target = reply.before.board.get(square);
    const capture = `${reply.san} takes the ${target?.role ?? "pawn"} on ${makeSquare(square)}${square !== reply.move.to ? " en passant" : ""}.`;
    if (!captureIsLegal) {
        const attacker = reply.before.board.get(reply.move.from);
        if (attacker && better.capture && capturedSquare(better) === reply.move.from)
            return `${capture} ${better.san} removes the ${attacker.role} on ${makeSquare(reply.move.from)} that would make this capture.`;
        return `${capture} That capture is unavailable after ${better.san}.`;
    }

    const [alternative] = replayTacticalLine(makeFen(better.after.toSetup()), [reply.uci]);
    if (alternative) {
        if (!alternative.capture)
            return `${capture} After ${better.san}, the same move no longer takes a piece.`;

        const { after, move } = alternative;
        const expectedReturn = alternative.capture - counterfactualGain;
        if (expectedReturn > 0) {
            for (const [from, destinations] of after.allDests()) {
                if (!destinations.has(move.to)) continue;
                const promotion =
                    after.board.get(from)?.role === "pawn" && (move.to < 8 || move.to >= 56)
                        ? "queen"
                        : undefined;
                const recapture = { from, to: move.to, promotion } as const;
                if (tacticalExchangeGain(after, recapture) === expectedReturn)
                    return `${capture} After ${better.san}, ${alternative.san} can be answered by ${makeSan(after, recapture)}.`;
            }
        }
    }

    return `${capture} After ${better.san}, the same capture has a worse material outcome.`;
}

/** Trace the captured piece to its square after the alternative. Legal
 * replies can change attack angle after a piece relocates. A single rejected
 * capture on the old square is insufficient evidence that the piece is safe. */
function savedVictim(
    played: TacticalReplayStep,
    better: TacticalReplayStep,
    take: TacticalReplayStep,
) {
    const taken = capturedSquare(take);
    const origin = played.move.to === taken ? played.move.from : taken;
    const alternativeSquare = better.move.from === origin ? better.move.to : origin;
    const before = played.before.board.get(origin);
    const victim = take.before.board.get(taken);
    const alternative = better.after.board.get(alternativeSquare);
    if (
        !before ||
        !victim ||
        !alternative ||
        before.color !== victim.color ||
        before.color !== alternative.color ||
        before.role !== victim.role ||
        before.role !== alternative.role ||
        before.role === "king"
    )
        return;
    for (const [from, destinations] of better.after.allDests()) {
        const captures: NormalMove[] = [];
        if (destinations.has(alternativeSquare)) captures.push({ from, to: alternativeSquare });
        const ep = better.after.epSquare;
        const pawn = better.after.board.get(from)?.role === "pawn";
        if (
            pawn &&
            ep !== undefined &&
            destinations.has(ep) &&
            ep + (better.after.turn === "white" ? -8 : 8) === alternativeSquare
        )
            captures.push({ from, to: ep });
        for (const capture of captures) {
            if (pawn && (capture.to < 8 || capture.to >= 56)) capture.promotion = "queen";
            const gain = tacticalExchangeGain(better.after, capture);
            if (gain >= MIN_TACTICAL_CAPTURE_GAIN || gain <= -20000) return;
        }
    }
    return victim.role;
}

/** Compare the same early horizon for both choices. An unrelated exchange at
 * the end of either full PV cannot create or erase the earlier cost. The
 * opponent's reply has already passed separate search corroboration. */
export function compareTacticalMistakeEpisode(
    fen: string,
    better: DecisionEngineLine,
    actual: DecisionEngineLine,
    opponent: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    maxReplyPayoffPly = 9,
): TacticalMistakeEpisode | null {
    if (better.cp === null || actual.cp === null || better.cp - actual.cp < 100) return null;
    const betterSteps = replayTacticalLine(fen, better.pvUci);
    const played = replayTacticalLine(fen, actual.pvUci.slice(0, 1))[0];
    const opponentSteps = replayTacticalLine(opponent.fen, opponent.pvUci);
    const reply = opponentSteps[0];
    if (
        !played ||
        !reply ||
        !betterSteps[0] ||
        !measureDecisionLine(makeFen(played.after.toSetup()), opponent) ||
        !measureDecisionLine(makeFen(betterSteps[0].after.toSetup()), betterReply)
    )
        return null;
    const antis = extractTacticalSequenceWitnesses(betterReply.fen, betterReply);
    const witnesses = extractTacticalSequenceWitnesses(opponent.fen, opponent).filter(
        (witness) =>
            witness.actor === opposite(played.before.turn) &&
            witness.mechanismPly <= 5 &&
            witness.payoffPly <= maxReplyPayoffPly &&
            !antis.some((other) => sameTacticalMechanism(witness, other)),
    );
    const take = parseUci(reply.uci);
    let directCapture: string | undefined;
    let concession: TacticalMistakeEpisode | null = null;
    let netLossPersists = true;
    let victim: ReturnType<typeof savedVictim>;
    if (take && "from" in take && reply.capture > 0 && !take.promotion) {
        const alternative = betterSteps[0].after;
        const legal = alternative.isLegal(take);
        const reduced = legal ? tacticalExchangeGain(alternative, take) : 0;
        const gained = tacticalExchangeGain(reply.before, take);
        // The same capture must be unavailable or materially worse after the
        // better choice. A pawn won in both lines is not evidence of the cause.
        if (gained >= 90 && reduced > -20000 && gained - reduced >= 90)
            directCapture = explainDirectCapture(betterSteps[0], reply, reduced, legal);
        if (gained >= MIN_TACTICAL_CAPTURE_GAIN && actual.pvUci[1] === reply.uci)
            victim = savedVictim(played, betterSteps[0], reply);
    }
    if (!witnesses.length && !directCapture && !victim) return null;
    const playedLineUci = [played.uci, ...opponent.pvUci];
    const end = Math.min(13, better.pvUci.length, playedLineUci.length);
    const settled = (line: ReturnType<typeof measureDecisionLine>) =>
        line &&
        !line.drawnEnding &&
        line.quietEndingPlies >= 2 &&
        line.endingMaterialRangeCp[0] === line.endingMaterialRangeCp[1];
    for (let ply = 5; ply <= end; ply++) {
        const confirmed = witnesses.filter((witness) => witness.payoffPly + 4 <= ply);
        if (!directCapture && !confirmed.length && !victim) continue;
        const beforeLine = better.pvUci.slice(0, ply);
        const afterLine = playedLineUci.slice(0, ply);
        const good = measureDecisionLine(fen, { ...better, pvUci: beforeLine });
        const bad = measureDecisionLine(fen, { ...actual, pvUci: afterLine });
        const gameLine =
            victim &&
            ply <= actual.pvUci.length &&
            measureDecisionLine(fen, { ...actual, pvUci: actual.pvUci.slice(0, ply) });
        if (gameLine && settled(gameLine) && gameLine.materialChangeCp > -90)
            netLossPersists = false;
        if (!bad || !settled(bad)) continue;
        if (bad.materialChangeCp > -90) netLossPersists = false;
        if (gameLine && settled(gameLine)) {
            // Independent searches must show the same net cost after the
            // immediate exchange. A later stable recovery rules out this claim.
            if (
                !concession &&
                netLossPersists &&
                bad.materialChangeCp === gameLine.materialChangeCp
            )
                concession = {
                    kind: "concession",
                    throughPly: ply,
                    materialConcededPoints: -bad.materialChangeCp / 100,
                    betterLineUci: beforeLine,
                    playedLineUci: afterLine,
                    mechanisms: confirmed,
                    explanation: directCapture ??
                        `${reply.san} takes the ${victim} on ${makeSquare(capturedSquare(reply))}. After ${betterSteps[0].san}, no immediate capture of that piece passes the exchange check.`,
                };
        }
        if (good && settled(good) && (directCapture || confirmed.length)) {
            const difference = good.materialChangeCp - bad.materialChangeCp;
            if (bad.materialChangeCp <= -90 && difference >= 90)
                return {
                    kind: "comparative",
                    throughPly: ply,
                    materialDifferencePoints: difference / 100,
                    betterLineUci: beforeLine,
                    playedLineUci: afterLine,
                    mechanisms: confirmed,
                    explanation: directCapture ?? confirmed[0].description,
                };
        }
    }
    return netLossPersists ? concession : null;
}
