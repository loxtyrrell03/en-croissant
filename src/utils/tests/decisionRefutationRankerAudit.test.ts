import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import {
    compareExtraPositionMove,
    confirmExtraPositionChoice,
    pickExtraPositionMove,
} from "../tacticalMotifs/decisionPositionContrast";

type Search = {
    pair: DecisionEngineLine[];
    attempt: { nodes: number; milliseconds: number };
    reply: {
        lines: DecisionEngineLine[];
        attempt: { nodes: number; milliseconds: number };
    } | null;
};

type BoardSearch = {
    id: string;
    fen: string;
    original: DecisionEngineLine[];
    shortlist: DecisionEngineLine[];
    searches: Record<string, Search>;
};

const searchPath = process.env.DECISION_REFUTATION_SEARCH;
const outputPath = process.env.DECISION_REFUTATION_LABELS;

test.skipIf(!searchPath || !outputPath)(
    "labels short-list moves with the same verifier and query budgets used by the app",
    () => {
        const searchBytes = readFileSync(searchPath!);
        const { results } = JSON.parse(searchBytes.toString("utf8")) as { results: BoardSearch[] };
        const labels = results.map(({ id, fen, original, shortlist, searches }) => {
            const eligible = original[0].depth >= 18 && original[0].cp !== null;
            const baseline = pickExtraPositionMove(fen, original, shortlist);
            expect(baseline).toBe(Object.keys(searches)[0] ?? null);
            const outcomes = Object.entries(searches).map(([move, { pair, reply }]) => {
                const first = shortlist.find((line) => line.pvUci[0] === move)!;
                // Only nomination order changes. The paired and reply evidence is untouched.
                const ordered = [first, ...shortlist.filter((line) => line !== first)];
                expect(pickExtraPositionMove(fen, original, ordered)).toBe(move);
                const compare =
                    eligible && Boolean(compareExtraPositionMove(fen, original[0], move, pair));
                const episode =
                    compare && reply
                        ? confirmExtraPositionChoice(fen, original, {
                              shortlist: ordered,
                              pair,
                              replies: reply.lines,
                          })
                        : null;
                return [
                    move,
                    {
                        proof: Boolean(episode),
                        payoff: episode,
                        requestedNodes: 1_200_000 + (compare && reply ? 1_000_000 : 0),
                    },
                ];
            });
            return { id, eligible, baseline, outcomes: Object.fromEntries(outcomes) };
        });
        writeFileSync(
            outputPath!,
            JSON.stringify({
                protocol: 1,
                searchSha256: createHash("sha256").update(searchBytes).digest("hex"),
                labels,
            }),
            { flag: "wx" },
        );
    },
    120_000,
);
