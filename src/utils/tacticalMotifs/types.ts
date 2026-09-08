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
    actor?: "white" | "black";
    comparison?: "prevented" | "persists";
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
