import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import {
    proveCheckingMate,
    proveMateWithinThree,
    proveShortCheckingMate,
    replayTacticalLine,
    tacticalExchangeGain,
} from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import {
    extractTacticalSequenceWitnesses,
    type TacticalSequenceWitness,
} from "./tacticalSequenceEvidence";

/** Two searches agree on the material concession and a fork that claws it
 * back. Its payoff is recovery, including the immediate recapture. */
export function findRecoveringFork(
    fen: string,
    root: DecisionEngineLine,
    corroborated: DecisionEngineLine,
): TacticalSequenceWitness | null {
    const witness = (line: DecisionEngineLine) => {
        const steps = replayTacticalLine(fen, line.pvUci.slice(0, 8));
        const [move, takes, fork, defence, payoff, recapture] = steps;
        if (
            !recapture ||
            takes.capture < 300 ||
            takes.balance > -200 ||
            takes.move.to === move.move.to ||
            fork.capture ||
            defence.capture ||
            !payoff.capture ||
            !recapture.capture ||
            recapture.move.to !== payoff.move.to ||
            Math.abs(recapture.balance) > 110 ||
            steps.slice(6).some((step) => Math.abs(step.balance) > 110)
        )
            return null;
        // A readily available direct recapture would itself recover the
        // piece. It would give this fork little explanatory value.
        if (
            [...takes.after.allDests()].some(
                ([from, squares]) =>
                    squares.has(takes.move.to) &&
                    tacticalExchangeGain(takes.after, { from, to: takes.move.to }) >=
                        takes.capture - 110,
            )
        )
            return null;
        const displaced = fork.after.board.get(defence.move.from);
        const recovered = payoff.before.board.get(payoff.move.to);
        if (!displaced || displaced.role === "pawn" || !recovered) return null;
        const motif = extractTacticalSequenceWitnesses(fen, {
            ...line,
            pvUci: line.pvUci.slice(0, 6),
        }).find(
            (item) =>
                item.mechanism === "fork" &&
                item.mechanismPly === 3 &&
                item.payoffPly === 5 &&
                // Attack validation uses the fork witness above. The piece
                // that stepped away must be the other recorded target.
                item.squares[1] === makeSquare(defence.move.from),
        );
        return motif
            ? { motif, moves: [move, takes, fork, payoff, recapture], displaced, recovered }
            : null;
    };
    const original = witness(root);
    const independent = witness(corroborated);
    if (!original || !independent) return null;
    if (
        !original.moves
            .slice(0, 4)
            .every((step, index) => step.uci === independent.moves[index].uci)
    )
        return null;
    const [move, takes, fork, payoff, recapture] = independent.moves;
    return {
        ...independent.motif,
        lineUci: corroborated.pvUci.slice(0, 6),
        description: `After ${move.san} ${takes.san}, ${fork.san} forks the ${independent.displaced.role} and the ${independent.recovered.role} on ${independent.motif.squares[2]}. Both searches recover material through ${payoff.san} and still offset the loss after ${recapture.san}.`,
    };
}

export type DecisionConditionalMate = {
    fen: string;
    lineUci: string[];
    mateIn: number;
    explanation: string;
};

/** An independently searched defensive reply allows mate. The engine may
 * avoid it in the main line. Verify the continuation against all legal
 * defences before drawing a conclusion about the displayed branch. */
export function findConditionalMate(
    fen: string,
    root: DecisionEngineLine,
    replies: DecisionEngineLine[],
): DecisionConditionalMate | null {
    const best = replies[0];
    if (!best || best.cp === null || best.mate != null || root.cp === null) return null;
    const [move] = replayTacticalLine(fen, root.pvUci.slice(0, 1));
    if (!move?.after.isCheck() || !measureDecisionLine(makeFen(move.after.toSetup()), best))
        return null;
    const [safer] = replayTacticalLine(best.fen, best.pvUci.slice(0, 1));
    for (const reply of replies.slice(1)) {
        const distance = -(reply.mate ?? 0);
        if (reply.depth !== best.depth || distance < 1 || distance > 5) continue;
        const measured = measureDecisionLine(best.fen, reply);
        if (!measured?.checkmate || measured.drawnEnding || measured.plies !== 2 * distance)
            continue;
        const [defence] = replayTacticalLine(best.fen, reply.pvUci.slice(0, 1));
        const mating = replayTacticalLine(makeFen(defence.after.toSetup()), reply.pvUci.slice(1));
        if (distance === 2) {
            const attack = mating[0];
            const proven = attack.after.isCheck()
                ? proveShortCheckingMate(attack)?.maxMoves === 2
                : proveMateWithinThree(mating)?.branches.every((branch) => !branch.replies);
            if (!proven) continue;
        }
        // Long lines must stand up to a bounded proof. An exhausted budget
        // leaves the conditional mate unestablished.
        if (distance >= 3 && !proveCheckingMate(mating, 8_192)) continue;
        return {
            fen,
            lineUci: [move.uci, ...reply.pvUci],
            mateIn: distance,
            explanation: `After ${move.san}, ${defence.san} allows mate in ${distance} starting with ${mating[0].san}. Stockfish prefers ${safer.san}.`,
        };
    }
    return null;
}
