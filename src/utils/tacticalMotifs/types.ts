export type TacticalMotifConfidence = "high" | "medium" | "low";
export type TacticalMotifSource = "allowed" | "missed" | "available";

/** Same-search alternatives, scored for the side to move on this exact board.
 * Engine scores nominate candidates; they are not tactical proof. */
export type TacticalReplyCandidate = {
    fen: string;
    pvUci: string[];
    cp: number | null;
    depth: number;
};

export type TacticalMotifEvidence = {
    id: string;
    label: string;
    confidence: TacticalMotifConfidence;
    evidence: string;
    source: TacticalMotifSource;
    ply: number | null;
    moveUci: string | null;
    relevance?: "primary" | "secondary";
    /** Material payoff in centipawns; 10000 represents mate. A proved
     * perpetual uses zero: a drawing resource is not a material gain. */
    value?: number;
    /** Set by an all-defence compound or mating proof, never inferred from
     * a PV tag or score. A material residual may be smaller than a pawn. */
    verifiedCombination?: true;
    actor?: "white" | "black";
    comparison?: "prevented" | "persists" | "reduced";
    comparisonEvidence?: string;
    /** A root missed hanging-piece capture has a comparable positive local
     * exchange alternative in the played move. Not a proof of equal overall
     * value or safety, and not itself an established cause of the mistake. */
    alternativeCapture?: true;
    /** A separately verified reply, not an event in the supplied engine PV.
     * Keep its board and moves together; never merge it into the PV timeline. */
    alternativeLine?: { fen: string; uci: string[]; san: string[] };
};

export type MistakeReviewMotifClassification = {
    allowedMotifs: TacticalMotifEvidence[];
    missedMotifs: TacticalMotifEvidence[];
    allowedTimeline?: TacticalMotifEvidence[];
    missedTimeline?: TacticalMotifEvidence[];
    motifClassifierVersion: string;
};

export type PositionTacticalMotifClassification = {
    motifs: TacticalMotifEvidence[];
    timeline?: TacticalMotifEvidence[];
    motifClassifierVersion: string;
};
