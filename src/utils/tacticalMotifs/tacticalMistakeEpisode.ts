import { makeSquare, opposite, parseUci } from "chessops/util";
import { makeFen } from "chessops/fen";
import { replayTacticalLine, tacticalExchangeGain } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import {
    extractTacticalSequenceWitnesses,
    type TacticalSequenceWitness,
} from "./tacticalSequenceEvidence";

export type TacticalMistakeEpisode = {
    throughPly: number;
    materialDifferencePoints: number;
    betterLineUci: string[];
    playedLineUci: string[];
    mechanisms: TacticalSequenceWitness[];
    explanation: string;
};

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
    if (take && "from" in take && reply.capture > 0 && !take.promotion) {
        const alternative = betterSteps[0].after;
        const reduced = alternative.isLegal(take) ? tacticalExchangeGain(alternative, take) : 0;
        const gained = tacticalExchangeGain(reply.before, take);
        // The same move in the alternative must be an unavailable or
        // unprofitable capture. An unrelated pawn won in both lines is not
        // evidence that the played move caused the loss.
        if (gained >= 90 && reduced >= 0 && gained - reduced >= 90) {
            const target = reply.before.board.get(reply.move.to);
            directCapture = `${reply.san} can take the ${target?.role ?? "pawn"} on ${makeSquare(reply.move.to)}. The same capture does not gain that material after ${betterSteps[0].san}.`;
        } else if (gained >= 90 && alternative.isLegal(take) && reduced > -20000 && reduced < 0) {
            directCapture = `${reply.san} wins an exchange on ${makeSquare(reply.move.to)} that is unfavourable after ${betterSteps[0].san}.`;
        }
    }
    if (!witnesses.length && !directCapture) return null;
    const playedLineUci = [played.uci, ...opponent.pvUci];
    const end = Math.min(13, better.pvUci.length, playedLineUci.length);
    for (let ply = 5; ply <= end; ply++) {
        const confirmed = witnesses.filter((witness) => witness.payoffPly + 4 <= ply);
        if (!directCapture && !confirmed.length) continue;
        const beforeLine = better.pvUci.slice(0, ply);
        const afterLine = playedLineUci.slice(0, ply);
        const good = measureDecisionLine(fen, { ...better, pvUci: beforeLine });
        const bad = measureDecisionLine(fen, { ...actual, pvUci: afterLine });
        const settled = (line: typeof good) =>
            line &&
            !line.drawnEnding &&
            line.quietEndingPlies >= 2 &&
            line.endingMaterialRangeCp[0] === line.endingMaterialRangeCp[1];
        if (!settled(good) || !settled(bad)) continue;
        const difference = good!.materialChangeCp - bad!.materialChangeCp;
        if (bad!.materialChangeCp > -90 || difference < 90) continue;
        return {
            throughPly: ply,
            materialDifferencePoints: difference / 100,
            betterLineUci: beforeLine,
            playedLineUci: afterLine,
            mechanisms: confirmed,
            explanation: directCapture ?? confirmed[0].description,
        };
    }
    return null;
}
