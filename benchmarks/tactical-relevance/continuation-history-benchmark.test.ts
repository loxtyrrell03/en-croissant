import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    classifyPositionTacticalMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import {
    repetitionHistory,
    repetitionFlip,
} from "../../src/utils/tests/fixtures/repetitionHistory";
import {
    continuationOrigin,
    continuationCycle,
    continuationClean,
    continuationApproach,
    continuationLine,
} from "../../src/utils/tests/fixtures/continuationHistory";

test("fixed paired continuation-history contracts; no source labels or engine adjudication", () => {
    const rows = [];
    for (const mirrored of [false, true])
        for (const repeated of [false, true])
            for (const length of [3, 5]) {
                const row = repetitionHistory(
                    continuationOrigin,
                    [
                        ...(repeated
                            ? [...continuationCycle, ...continuationCycle]
                            : continuationClean),
                        ...continuationApproach,
                    ],
                    mirrored,
                );
                const pvUci = continuationLine
                    .slice(0, length)
                    .map((move) => (mirrored ? repetitionFlip(move) : move));
                const output = classifyPositionTacticalMotifs({ ...row, pvUci });
                const expected = !repeated && length === 5;
                const actual = output.motifs.some((m) => m.id === "fork");
                const actualPayoff =
                    output.timeline?.some((m) => m.label === "Fork Payoff") ?? false;
                rows.push({
                    mirrored,
                    repeated,
                    length,
                    input: { ...row, pvUci },
                    expectedFork: expected,
                    actualFork: actual,
                    expectedPayoff: expected,
                    actualPayoff,
                    passed: expected === actual && expected === actualPayoff,
                    output,
                });
            }
    const report = {
        schema: 1,
        classifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        sourceRef: process.env.CONTINUATION_HISTORY_REF ?? "working-tree",
        scope: "Eight paired history/colour/prefix variants of one constructed mechanism, not population accuracy",
        passed: rows.filter((row) => row.passed).length,
        total: rows.length,
        rows,
    };
    if (process.env.CONTINUATION_HISTORY_REPORT)
        writeFileSync(
            process.env.CONTINUATION_HISTORY_REPORT,
            JSON.stringify(report, null, 2) + "\n",
            { flag: "wx" },
        );
    expect(rows).toHaveLength(8);
    expect(report.passed).toBe(process.env.CONTINUATION_HISTORY_REF ? 6 : report.total);
});
