import { readFileSync } from "node:fs";
import type { TablebaseEvidence } from "../../tacticalMotifs/tablebaseEvidence";

type Receipt = {
    cases: {
        id: string;
        fen: string;
        move: string;
        judgement: string;
        actualFen: string;
        passedFen: string;
    }[];
    queries: { id: string; fen: string; result: unknown }[];
};
const reports = [
    "tablebase-relevance-verified.json",
    "tablebase-relevance-supplementary.json",
    "tablebase-relevance-reciprocal.json",
].map(
    (name) => JSON.parse(readFileSync(`benchmarks/tactical-relevance/${name}`, "utf8")) as Receipt,
);
// Judgements use the independent outcomes and reviewed position, not this
// classifier's output. Source-tagged infiltration and pawn wins stay negative.
const positive = new Set([
    "EKWHC:g4f4",
    "6fO6p",
    "EKWHC-black-reflection",
    "EKWHC-reciprocal-draw",
]);
export const tablebaseCases = [
    ...new Map(
        reports.flatMap((report) =>
            report.cases.map(
                (row) =>
                    [
                        row.id,
                        {
                            ...row,
                            expectedZugzwang: positive.has(row.id),
                            evidence: {
                                provider: "lichess-syzygy",
                                records: report.queries
                                    .filter((q) => q.id === row.id)
                                    .map((q) => ({ fen: q.fen, result: q.result })),
                            } satisfies TablebaseEvidence,
                        },
                    ] as const,
            ),
        ),
    ).values(),
];
