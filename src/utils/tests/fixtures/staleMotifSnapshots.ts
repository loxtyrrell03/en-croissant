import type { MistakeReviewMotifClassification } from "../../tacticalMotifs/types";

// Actual in-memory output of adapter/core a31f951318e98c3d09ffcd8260da1e4d57b335da
// (site-55.adapter-164), independently replayed in the reader-lifecycle audit.
// This preserves an obsolete classifier claim, NOT an adjudicated gold label.
// No owner deck or private game was used.
export const staleDiscoveryInput = {
    fen: "3r2k1/p4pp1/1p5p/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24",
    bestMoveUci: "e4e8", playedMoveUci: "g1f1",
    pvUci: ["e4e8", "d8e8", "f3d5"], refutationUci: ["h6h5"],
};
const obsoleteDiscovery = {
    id: "discoveredAttack", label: "Discovered Attack", source: "missed" as const,
    confidence: "high" as const, ply: 1, moveUci: "e4e8", value: 100, relevance: "primary" as const,
    evidence: "Re8+ vacates e4, uncovering the queen on f3 against the queen on d5. The moving rook gives check, so the opponent cannot simply ignore the exposed attack. The rook on e8 also attacks the rook on d8. The shared defence cannot save all these targets: after Kh7, Rxd8 removes the defender. Every legal reply permits a local material gain, including exchanges and up to two checking counterattacks; immediate losses elsewhere on the board, mate and promotion replies are checked.",
};
export const staleDiscoveryClassification: MistakeReviewMotifClassification = {
    allowedMotifs: [], missedMotifs: [obsoleteDiscovery], motifClassifierVersion: "site-55.adapter-164",
    allowedTimeline: [], missedTimeline: [
        { ...obsoleteDiscovery, actor: "white" },
        { id: "hangingPiece", label: "Discovery Payoff", confidence: "high", source: "missed",
            evidence: "Qxd5 collects the queen on d5, the material payoff of the earlier discovered attack (Re8+).",
            ply: 3, moveUci: "f3d5", value: 800, relevance: "secondary", actor: "white" },
    ],
};

export const retainedForkInput = {
    fen: "1k1q3r/pppp4/3N3N/8/2B5/8/5PPP/6K1 w - - 0 1",
    bestMoveUci: "d6f7", playedMoveUci: "h6f7",
    pvUci: ["d6f7", "d8e7", "f7h8"], refutationUci: ["d8e7"],
};
const obsoleteMissedFork = {
    id: "fork", label: "Fork", confidence: "high" as const, source: "missed" as const,
    evidence: "Ndf7 forks the queen on d8 and rook on h8. The checked defences retain at least 1.7 pawns of local material gain after captures and exchanges. A defence can exchange pieces instead of losing a forked piece outright; this is not an extra free-piece claim.",
    ply: 1, moveUci: "d6f7", value: 170, relevance: "primary" as const,
};
export const staleForkClassification: MistakeReviewMotifClassification = {
    allowedMotifs: [], missedMotifs: [obsoleteMissedFork], motifClassifierVersion: "site-55.adapter-164",
    allowedTimeline: [], missedTimeline: [
        { ...obsoleteMissedFork, actor: "white" },
        { id: "hangingPiece", label: "Fork Payoff", confidence: "high", source: "missed",
            evidence: "Nxh8 collects the rook on h8, the material payoff of the earlier fork (Ndf7).",
            ply: 3, moveUci: "f7h8", value: 500, relevance: "secondary", actor: "white" },
    ],
};
