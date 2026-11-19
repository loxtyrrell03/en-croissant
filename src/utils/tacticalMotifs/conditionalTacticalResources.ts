import { makeFen } from "chessops/fen";
import type { Role } from "chessops/types";
import { replayTacticalLine } from "./causalTactics";
import {
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "./decisionEvidence";
import {
    extractTacticalSequenceWitnesses,
    type TacticalSequenceWitness,
} from "./tacticalSequenceEvidence";

const VALUE: Record<Role, number> = {
    pawn: 100,
    knight: 320,
    bishop: 330,
    rook: 500,
    queen: 900,
    king: 20000,
};

export type ConditionalTacticalResource = {
    fen: string;
    moveUci: string;
    replyFen: string;
    captureUci: string;
    captureSan: string;
    /** A separately searched conditional branch, never the principal continuation. */
    lineUci: string[];
    depth: number;
    evaluationDisadvantageCp: number | null;
    outcome: { kind: "checkmate" } | { kind: "material"; gainPoints: number; throughPly: number };
    /** Motifs belong to the refutation's own FEN/plies, not the original root. */
    refutationMechanisms: TacticalSequenceWitness[];
    support: "engine-supported";
    description: string;
    limitation: string;
};

/** Check a tempting capture of the moved piece, including en passant. A queen
 * taking an ordinarily defended pawn is deliberately not a tactical resource. */
export function findConditionalCaptureResources(
    fen: string,
    root: DecisionEngineLine,
    bestReplies: DecisionEngineLine[],
    captures: DecisionEngineLine[],
): ConditionalTacticalResource[] {
    if (!measureDecisionLine(fen, root) || root.depth < 16) return [];
    const rootStep = replayTacticalLine(fen, [root.pvUci[0]])[0];
    if (!rootStep) return [];
    const replyFen = makeFen(rootStep.after.toSetup());
    const replies = measurePositionDecision(replyFen, bestReplies);
    const best = bestReplies[0];
    if (
        !replies ||
        replies.lines.length !== bestReplies.length ||
        !best ||
        best.depth < 16 ||
        bestReplies.some((line) => line.depth !== best.depth) ||
        bestReplies.some(
            (line, index) =>
                index > 0 &&
                line.cp !== null &&
                bestReplies[index - 1].cp !== null &&
                line.cp > bestReplies[index - 1].cp!,
        )
    )
        return [];
    const converged =
        root.cp !== null &&
        root.mate == null &&
        best.cp !== null &&
        best.mate == null &&
        Math.abs(root.cp + best.cp) <= 90;
    // The useful counterfactual here is a capture that changes a non-mating
    // best defence into a losing tactical branch. Already-lost mate branches
    // do not establish that this particular capture is the reason.
    if (!converged) return [];
    const offered = rootStep.after.board.get(rootStep.move.to);
    if (!offered || offered.color !== rootStep.before.turn || offered.role === "king") return [];
    const found: ConditionalTacticalResource[] = [];
    for (const line of captures) {
        const measured = measureDecisionLine(replyFen, line);
        if (
            !measured ||
            measured.drawnEnding ||
            line.depth < 16 ||
            found.some((r) => r.captureUci === line.pvUci[0])
        )
            continue;
        const steps = replayTacticalLine(replyFen, line.pvUci);
        const take = steps[0];
        const taker = take.before.board.get(take.move.from)!;
        const ep =
            taker.role === "pawn" &&
            take.before.epSquare === take.move.to &&
            !take.before.board.get(take.move.to);
        const takenSquare = ep
            ? take.move.to + (take.before.turn === "white" ? -8 : 8)
            : take.move.to;
        if (!take.capture || takenSquare !== rootStep.move.to) continue;
        const recapturable = [...take.after.allDests()].some(([from, dests]) => {
            if (!dests.has(take.move.to)) return false;
            const pawn = take.after.board.get(from)?.role === "pawn";
            const promotes = pawn && (take.move.to < 8 || take.move.to >= 56);
            return take.after.isLegal({
                from,
                to: take.move.to,
                ...(promotes ? { promotion: "queen" as const } : {}),
            });
        });
        if (VALUE[offered.role] < VALUE[taker.role] && recapturable) continue;
        const disadvantage = line.cp !== null && line.mate == null ? best.cp! - line.cp : null;
        const mating =
            (line.mate ?? 0) < 0 &&
            measured.checkmate &&
            steps.at(-1)!.after.turn === take.before.turn;
        if (!mating && (disadvantage === null || disadvantage < 100)) continue;
        const refutationFen = makeFen(take.after.toSetup());
        const refutation: DecisionEngineLine = {
            ...line,
            fen: refutationFen,
            cp: line.cp === null ? null : -line.cp,
            mate: line.mate == null ? null : -line.mate,
            pvUci: line.pvUci.slice(1),
        };
        const witnesses = extractTacticalSequenceWitnesses(refutationFen, refutation).filter(
            (w) => w.rootMoveInvolved && w.actor === rootStep.before.turn,
        );
        let outcome: ConditionalTacticalResource["outcome"] | null = mating
            ? { kind: "checkmate" }
            : null;
        let throughPly = line.pvUci.length;
        if (!outcome) {
            // Material is measured BEFORE the tempting capture, so merely
            // recovering the offered piece cannot masquerade as a net gain.
            for (const witness of witnesses) {
                for (
                    let end = witness.payoffPly + 4;
                    end <= Math.min(line.pvUci.length, witness.payoffPly + 7);
                    end++
                ) {
                    const episode = measureDecisionLine(replyFen, {
                        ...line,
                        pvUci: line.pvUci.slice(0, end),
                    });
                    if (
                        episode &&
                        !episode.drawnEnding &&
                        episode.quietEndingPlies >= 2 &&
                        episode.endingMaterialRangeCp[0] === episode.endingMaterialRangeCp[1] &&
                        episode.materialChangeCp <= -90
                    ) {
                        outcome = {
                            kind: "material",
                            gainPoints: -episode.materialChangeCp / 100,
                            throughPly: end,
                        };
                        throughPly = end;
                        break;
                    }
                }
                if (outcome) break;
            }
        }
        if (!outcome) continue;
        found.push({
            fen,
            moveUci: root.pvUci[0],
            replyFen,
            captureUci: line.pvUci[0],
            captureSan: take.san,
            lineUci: line.pvUci.slice(0, throughPly),
            depth: line.depth,
            evaluationDisadvantageCp: disadvantage,
            outcome,
            refutationMechanisms: witnesses.filter((w) => w.payoffPly < throughPly),
            support: "engine-supported",
            description: `The tempting capture ${take.san} is refuted in a separate engine line: ${outcome.kind === "checkmate" ? "the capturing side is checkmated" : `the original mover gains ${outcome.gainPoints.toFixed(1)} material points after the tactical exchange settles`}.`,
            limitation:
                "This resource applies if the opponent chooses this capture. It does not mean the capture is forced, that every defence loses, or that this is the move's only justification.",
        });
    }
    return found;
}
