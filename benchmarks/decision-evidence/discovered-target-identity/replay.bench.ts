import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { assessChessDecision, type DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { extractTacticalSequenceWitnesses } from "@/utils/tacticalMotifs/tacticalSequenceEvidence";

type Frame = DecisionAssessmentInput & { id: string };

test("replays discovery witnesses and the decision assessor with identical engine inputs", () => {
    const rows = JSON.parse(readFileSync(process.env.DISCOVERY_INPUT!, "utf8")) as Frame[];
    const output = rows.map((row) => {
        const start = performance.now();
        const report = assessChessDecision(row);
        const duration = performance.now() - start;
        const variations = new Map<string, Frame["candidates"][number]>();
        for (const line of [
            ...row.candidates,
            ...(row.comparisonCandidates ?? []),
            ...(row.replyProbes ?? []).flatMap((probe) => probe.lines),
        ]) {
            variations.set(line.fen + " " + line.pvUci.join(" "), line);
        }
        const discoveries = [...variations.values()].flatMap((line) =>
            extractTacticalSequenceWitnesses(line.fen, line)
                .filter((witness) => witness.mechanism === "discoveredAttack"),
        );
        return { id: row.id, report, discoveries, duration };
    });
    expect(output.length).toBeGreaterThan(0);
    writeFileSync(process.env.DISCOVERY_OUTPUT!, JSON.stringify(output), { flag: "wx" });
}, 180_000);
