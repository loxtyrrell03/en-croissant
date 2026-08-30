export type TacticalMotifConfidence = "high" | "medium" | "low";
export type TacticalMotifSource = "allowed" | "missed";

export type TacticalMotifEvidence = {
    id: string;
    label: string;
    confidence: TacticalMotifConfidence;
    evidence: string;
    source: TacticalMotifSource;
    ply: number | null;
    moveUci: string | null;
};

export type MistakeReviewMotifClassification = {
    allowedMotifs: TacticalMotifEvidence[];
    missedMotifs: TacticalMotifEvidence[];
    motifClassifierVersion: string;
};
