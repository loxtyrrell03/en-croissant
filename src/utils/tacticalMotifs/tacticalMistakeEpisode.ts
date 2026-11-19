import { makeSquare, opposite, parseUci } from "chessops/util";
import { makeFen } from "chessops/fen";
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
    type TacticalSequenceWitness,
} from "./tacticalSequenceEvidence";

export type TacticalMistakeEpisode = {
    throughPly: number;
    betterLineUci: string[];
    playedLineUci: string[];
    mechanisms: TacticalSequenceWitness[];
    explanation: string;
} & (
    | { kind: "comparative"; materialDifferencePoints: number }
    | { kind: "concession"; materialConcededPoints: number }
    | { kind: "forcing-attack" }
);

function capturedSquare(step: TacticalReplayStep) {
    const { before, move } = step;
    return before.epSquare === move.to && before.board.get(move.from)?.role === "pawn"
        ? move.to + (before.turn === "white" ? -8 : 8)
        : move.to;
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
            witness.payoffPly <= 9 &&
            !antis.some(
                (other) =>
                    other.actor === witness.actor &&
                    other.mechanism === witness.mechanism &&
                    other.squares.some((square) => witness.squares.includes(square)),
            ),
    );
    const take = parseUci(reply.uci);
    let directCapture: string | undefined;
    let concession: TacticalMistakeEpisode | null = null;
    let netLossPersists = true;
    let victim: ReturnType<typeof savedVictim>;
    if (take && "from" in take && reply.capture > 0 && !take.promotion) {
        const alternative = betterSteps[0].after;
        const reduced = alternative.isLegal(take) ? tacticalExchangeGain(alternative, take) : 0;
        const gained = tacticalExchangeGain(reply.before, take);
        const square = capturedSquare(reply);
        const target = reply.before.board.get(square);
        // The same move in the alternative must be an unavailable or
        // unprofitable capture. An unrelated pawn won in both lines is not
        // evidence that the played move caused the loss.
        if (gained >= 90 && reduced >= 0 && gained - reduced >= 90) {
            directCapture = `${reply.san} can take the ${target?.role ?? "pawn"} on ${makeSquare(square)}${square !== reply.move.to ? " en passant" : ""}. The same capture does not gain that material after ${betterSteps[0].san}.`;
        } else if (gained >= 90 && alternative.isLegal(take) && reduced > -20000 && reduced < 0) {
            directCapture = `${reply.san} wins an exchange on ${makeSquare(reply.move.to)} that is unfavourable after ${betterSteps[0].san}.`;
        }
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
                    explanation: `${reply.san} takes the ${victim} on ${makeSquare(capturedSquare(reply))}. After ${betterSteps[0].san}, that piece is safe in the immediate exchange check.`,
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
