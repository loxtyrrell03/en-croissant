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
    /** Material payoff in centipawns; 10000 represents a mating continuation. */
    value?: number;
};

export type MistakeReviewMotifClassification = {
    allowedMotifs: TacticalMotifEvidence[];
    missedMotifs: TacticalMotifEvidence[];
    motifClassifierVersion: string;
};

export type PositionTacticalMotifClassification = {
    motifs: TacticalMotifEvidence[];
    motifClassifierVersion: string;
};
