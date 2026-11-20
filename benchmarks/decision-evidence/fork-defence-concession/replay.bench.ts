import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { findForkWithPaidDefence } from "./candidate";

type Frame = {
    id: string;
    move: string;
    fen: string;
    paired: DecisionAssessmentInput["candidates"];
    withReplies: NonNullable<DecisionAssessmentInput["replyProbes"]>;
};
type ArchiveFrame = DecisionAssessmentInput & { id: string };

test.runIf(process.env.FORK_INPUT && process.env.FORK_OUTPUT)(
    "replays the exact move in the En Croissant decision worker",
    () => {
        const rows = JSON.parse(readFileSync(process.env.FORK_INPUT!, "utf8")) as
            (Frame | ArchiveFrame)[] | { cases: Frame[] };
        const cases = Array.isArray(rows) ? rows : rows.cases;
        expect(cases.length).toBeGreaterThan(0);
        expect(new Set(cases.map((row) => row.id)).size).toBe(cases.length);
        const result = cases.map(({ id, ...frame }) => {
            if (!("paired" in frame)) {
                if (!frame.candidates.length) return { id, report: null };
                const start = performance.now();
                const report = classify(frame, "Stockfish 19", frame.history);
                return { id, report, elapsedMs: performance.now() - start };
            }
            const { fen, move, paired, withReplies } = frame;
            const exact = paired.find((line) => line.pvUci[0] === move);
            const replies = withReplies.find((probe) => probe.moveUci === move)?.lines;
            if (!exact || !replies?.length) return { id, report: null };
            const start = performance.now();
            const report = classify({ fen, candidates: paired, replyProbes: withReplies, playedMoveUci: move }, "Stockfish 19");
            const elapsedMs = performance.now() - start;
            const proposed = findForkWithPaidDefence(fen, exact, replies);
            return { id, move, report, elapsedMs, proposed };
        });
        writeFileSync(process.env.FORK_OUTPUT!, JSON.stringify(result), { flag: "wx" });
    },
    450_000,
);
