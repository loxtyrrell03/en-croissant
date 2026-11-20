import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("replays the same played decisions at each proof budget", () => {
    const input = JSON.parse(readFileSync(process.env.MATE_THREE_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string }
    >;
    expect(new Set(input.map((row) => row.id)).size).toBe(input.length);
    const result = input.map(({ id, ...row }) => {
        const start = performance.now();
        const input = process.env.MATE_THREE_WITHOUT_PLAYED_REPLY
            ? {
                  ...row,
                  replyProbes: row.replyProbes?.filter(
                      (probe) => probe.moveUci !== row.playedMoveUci,
                  ),
              }
            : row;
        const report = classify(input, "Stockfish 19", input.history);
        return { id, report, ms: performance.now() - start };
    });
    writeFileSync(process.env.MATE_THREE_OUTPUT!, JSON.stringify(result), { flag: "wx" });
}, 420_000);
