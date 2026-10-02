import type { TacticalGameHistory } from "./gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
    type TacticalRepetitionContext,
} from "./repetitionHistory";
import { isTacticalObservation, type TacticalMotifEvidence } from "./types";

/** Claims do not refute a proved drawing resource or non-forcing observation. */
export function survivesOptionalDraw(motif: TacticalMotifEvidence): boolean {
    return (
        isTacticalObservation(motif) ||
        motif.id === "perpetualCheck" ||
        motif.id === "drawingCapture" ||
        (motif.id === "zugzwang" && motif.label === "Drawing Zugzwang")
    );
}

/** A later event belongs to its legally reached board, not the root board.
 * A defender's positive draw claim along that supplied prefix defeats its
 * forced-win/payoff story. It does not refute an independent root certificate
 * on another route, or prevent a fresh scan after a player declined the claim.
 * Missing history is unknown. This is a path boundary, not all-branch material
 * proof: no other search branch is silently certified repetition-free here. */
export function filterContinuationHistory(
    fen: string,
    line: readonly string[],
    history: TacticalGameHistory,
    motifs: TacticalMotifEvidence[],
): TacticalMotifEvidence[] {
    const initial = readTacticalRepetitionContext(fen, history);
    if (!initial || !motifs.some((m) => (m.ply ?? 1) > 1)) return motifs;
    const states: TacticalRepetitionContext[] = [initial];
    const claimants = new Set<string>();
    const claimsByPly: Set<string>[] = [];
    for (let index = 0; index <= line.length; index++) {
        const state = states[index];
        if (!state) break;
        if (tacticalRepetitionClaim(state)) claimants.add(state.fen.split(" ")[1]);
        claimsByPly.push(new Set(claimants));
        if (index < line.length) {
            const next = advanceTacticalRepetitionContext(state, line[index]);
            if (!next) break;
            states.push(next);
        }
    }
    return motifs.filter((motif) => {
        const ply = motif.ply ?? 1;
        // The existing root and mating-all-reply qualifiers own these.
        if (ply <= 1) return true;
        const before = states[ply - 1];
        if (!before || before.endedAtPly !== undefined) return false;
        // An unrelated alternative board cannot inherit this prefix's claim.
        // Its own classifier/history qualifier remains responsible for it.
        if (
            motif.alternativeLine &&
            motif.alternativeLine.fen.trim().split(/\s+/).join(" ") !== before.fen
        )
            return true;
        const alternate = motif.alternativeLine?.uci[0];
        const after = alternate ? advanceTacticalRepetitionContext(before, alternate) : states[ply];
        if (!after || after.endedAtPly !== undefined) return false;
        const actor = before.fen.split(" ")[1];
        // Self-interference is a concession to the opponent, not the mover's win.
        const defender = motif.id === "selfInterference" ? actor : actor === "w" ? "b" : "w";
        const priorClaim = claimsByPly[ply - 1]?.has(defender);
        const eventClaim = after.fen.split(" ")[1] === defender && tacticalRepetitionClaim(after);
        return survivesOptionalDraw(motif) || (!priorClaim && !eventClaim);
    });
}
