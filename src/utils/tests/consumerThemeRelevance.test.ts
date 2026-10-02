import { expect, test } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import type { Position } from "@/components/files/opening";
import { getMistakeReviewNatureBatch, getMistakeReviewNatureCounts } from "../mistakeReview";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { classifyProvedMistakeNature } from "../tacticalMotifs/mistakeNature";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { defensibleMateThreatFen } from "./fixtures/defensibleMateThreat";
import { captureAttractionIdeaFen, captureAttractionIdeaLine } from "./fixtures/captureAttractionIdea";

type Input = {
    fen: string; bestMoveUci: string; playedMoveUci: string; pvUci: string[];
    refutationUci?: string[]; cpBefore?: number; cpAfter?: number;
    cpLoss?: number; winProbabilityDrop?: number; reachedDepth?: number;
};
type Contract = {
    id: string;
    intent: string;
    input: Input;
    nature: "tactical" | "positional" | "unknown";
    confidence: "high" | "medium" | "low";
    primary?: { id: string; ply: number; value: number };
};
const quiet: Input = {
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    bestMoveUci: "g1f3", playedMoveUci: "h2h3",
    pvUci: ["g1f3", "g8f6", "g2g3", "g7g6"],
    refutationUci: ["g8f6", "g1f3", "g7g6", "g2g3"],
    cpLoss: 60, winProbabilityDrop: 4, reachedDepth: 18,
};

// These ten intentions were frozen before observing the current consumer
// outputs. Scores are controlled relevance inputs, not chess-quality gold.
// Unknown describes the supported proof scope, not absence of a real tactic.
const contracts: Contract[] = [
    { id: "answerable-mate-threat", intent: "A parryable mate threat is neutral context, not a forced win or mistake cause.",
        input: { fen: defensibleMateThreatFen, bestMoveUci: "d1h5", playedMoveUci: "g1f3",
            pvUci: ["d1h5", "g7g6", "h5f3"], refutationUci: ["g8f6"], cpBefore: 0, cpAfter: -300, cpLoss: 300 },
        nature: "unknown", confidence: "low", primary: { id: "matingThreat", ply: 1, value: 0 } },
    { id: "unsafe-mate-threat", intent: "A capturable queen is not a useful threat merely because a favourable score was supplied.",
        input: { fen: defensibleMateThreatFen.replace("2n5", "2n2n2").replace("kbnr", "kb1r"),
            bestMoveUci: "d1h5", playedMoveUci: "b1c3", pvUci: ["d1h5", "f6h5"], refutationUci: ["f6g8"],
            cpBefore: 900, cpAfter: 0, cpLoss: 900 }, nature: "unknown", confidence: "low" },
    { id: "conditional-attraction", intent: "An accepting exchange branch is a conditional idea, not a proved missed win.",
        input: { fen: captureAttractionIdeaFen, bestMoveUci: "f1a6", playedMoveUci: "c1d2",
            pvUci: captureAttractionIdeaLine, refutationUci: ["b7c8"], cpBefore: 300, cpAfter: 0, cpLoss: 300 },
        nature: "unknown", confidence: "low", primary: { id: "attractionIdea", ply: 1, value: 0 } },
    { id: "proved-fork-preparation", intent: "Removing the independent escape resource permits the genuine separately proved preparation.",
        input: { fen: captureAttractionIdeaFen.replace("np6", "n7"), bestMoveUci: "f1a6", playedMoveUci: "c1d2",
            pvUci: captureAttractionIdeaLine, refutationUci: ["b7c8"], cpBefore: 300, cpAfter: 0, cpLoss: 300 },
        nature: "tactical", confidence: "high", primary: { id: "forkPreparation", ply: 1, value: 220 } },
    { id: "later-fork", intent: "A valid ply-three fork may survive in the timeline but does not itself prove a root mistake.",
        input: { fen: "2k4r/1p3p2/2p3q1/P1Q3p1/3R4/8/6B1/6K1 w - - 0 1", bestMoveUci: "g2h3", playedMoveUci: "a5a6",
            pvUci: ["g2h3", "c8b8", "c5e5", "g6d6", "e5h8"], cpLoss: 200 },
        nature: "unknown", confidence: "low", primary: { id: "fork", ply: 3, value: 500 } },
    { id: "conditional-later-mate", intent: "A supplied mating branch does not survive an immediate legal capture of the offered queen.",
        input: { fen: "5rk1/5p1p/5K2/5B2/7Q/8/8/7q w - - 0 1", bestMoveUci: "h4h5", playedMoveUci: "h4f4",
            pvUci: ["h4h5", "h1c1", "h5h7"], refutationUci: ["h1f1"], cpLoss: 200 },
        nature: "unknown", confidence: "low" },
    { id: "proved-root-mate-support", intent: "Gtvlx's complete root mate outranks deflection support without invented material value.",
        input: { fen: "1r3rk1/p1pn1ppp/b4b2/6q1/3PB3/1P2P2P/PBPN1P2/R2QK2R b KQ - 2 15",
            bestMoveUci: "g5e3", playedMoveUci: "g5h5", pvUci: ["g5e3", "f2e3", "f6h4"], refutationUci: ["a2a3"], cpLoss: 600 },
        nature: "tactical", confidence: "high", primary: { id: "mateIn2", ply: 1, value: 10000 } },
    { id: "drawing-opposition", intent: "An exact drawing resource may be tactical at zero material value; do not blanket-suppress it.",
        input: { fen: "8/2k5/8/8/2K5/2P5/8/8 b - - 0 1", bestMoveUci: "c7c6", playedMoveUci: "c7d6",
            pvUci: ["c7c6"], refutationUci: ["c4d4"], cpLoss: 300 },
        nature: "tactical", confidence: "high", primary: { id: "zugzwang", ply: 1, value: 0 } },
    { id: "quiet-complete", intent: "Complete quiet lines retain a qualified likely-positional estimate, not proof of tactical absence.",
        input: quiet, nature: "positional", confidence: "medium" },
    { id: "quiet-missing-reply", intent: "Removing the reply evidence leaves unknown, not positional.",
        input: { ...quiet, refutationUci: [] }, nature: "unknown", confidence: "low" },
];

test.each(contracts)("$id: $intent", row => {
    const input = row.input;
    const best = replayTacticalLine(input.fen, input.pvUci);
    const playedLine = [input.playedMoveUci, ...(input.refutationUci ?? [])];
    expect(best).toHaveLength(input.pvUci.length);
    expect(replayTacticalLine(input.fen, playedLine)).toHaveLength(playedLine.length);
    const review = classifyMistakeReviewMotifs(input);
    const explanation = buildMistakeReviewTacticalExplanation(review);
    const nature = classifyProvedMistakeNature(input);
    const scan = buildLiveTacticalScan({ fen: input.fen, pvUci: input.pvUci, engineName: "Controlled contrast", depth: 18,
        variations: [{ pvUci: input.pvUci, cp: input.cpBefore }] });
    const project = (motif: { id: string; ply: number | null; value?: number } | undefined) => motif &&
        ({ id: motif.id, ply: motif.ply, value: motif.value });
    expect(project(explanation?.primary)).toEqual(row.primary);
    expect(project(scan.motifs[0])).toEqual(row.primary);
    expect(nature).toMatchObject({ nature: row.nature, confidence: row.confidence });
    expect(row.nature !== "unknown" || !/What you missed|Why the move was tactically bad|Missed alternative/.test(explanation?.title ?? "")).toBe(true);
    expect(explanation?.secondary).toBeUndefined();
    const saved: Position = { fen: input.fen, answer: "", answerUci: input.bestMoveUci,
        reviewKey: row.id, card: createEmptyCard(), mistakeReview: { ...input, ...review } };
    expect(getMistakeReviewNatureCounts([saved])[row.nature].total).toBe(1);
    for (const natureKind of ["tactical", "positional", "unknown"] as const)
        expect(getMistakeReviewNatureBatch([saved], natureKind, { includeScheduled: true })).toHaveLength(natureKind === row.nature ? 1 : 0);
});

test("the optional mate has a legal immediate queen-capture refutation, not just a missing proof", () => {
    const row = contracts.find(contract => contract.id === "conditional-later-mate")!;
    const decline = replayTacticalLine(row.input.fen, ["h4h5", "h1h5"]);
    expect(decline).toHaveLength(2);
    expect(decline[1].balance).toBe(-900);
    expect(replayTacticalLine(row.input.fen, row.input.pvUci).at(-1)!.after.isCheckmate()).toBe(true);
});
