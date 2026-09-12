export type TacticalMotifConfidence = "high" | "medium" | "low";
export type TacticalMotifSource = "allowed" | "missed" | "available";

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
