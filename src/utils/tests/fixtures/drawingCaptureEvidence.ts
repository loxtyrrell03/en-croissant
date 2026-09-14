import { readFileSync } from "node:fs";
import type { TablebaseEvidence } from "../../tacticalMotifs/tablebaseEvidence";

const receipt = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/drawing-capture-tablebase-verified.json", "utf8"),
) as {
    cases: { id: string; fen: string; move: string; judgement: string; result: unknown }[];
};
const positives = new Set([
    "equivalent-saving-captures",
    "allowed-rook-rescue",
    "black-rook-rescue",
    "king-rook-rescue",
    "king-queen-rescue",
    "knight-queen-rescue",
    "knight-pawn-rescue",
]);
export const drawingCaptureEvidenceCases = receipt.cases.map((row) => ({
    ...row,
    expected: positives.has(row.id),
    evidence: {
        provider: "lichess-syzygy",
        records: [{ fen: row.fen, result: row.result }],
    } satisfies TablebaseEvidence,
}));
