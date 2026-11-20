import {readFileSync,writeFileSync} from "node:fs";
import {expect,test} from "vitest";
import {classify} from "@/components/panels/tactics/decisionReport.worker";
import type {DecisionAssessmentInput} from "@/utils/tacticalMotifs/decisionAssessment";

test.skipIf(!process.env.OUTPOST_INPUT)("replays the whole decision report for identical engine lines", () => {
    const cases = JSON.parse(readFileSync(process.env.OUTPOST_INPUT!, "utf8")) as
        Array<DecisionAssessmentInput & {id: string}>;
    expect(new Set(cases.map((row) => row.id)).size).toBe(cases.length);
    const out = cases.map(({id, ...input}) => {
        const start = performance.now();
        const report = classify(input, "Stockfish 19", input.history);
        return {id,report,ms:performance.now()-start};
    });
    writeFileSync(process.env.OUTPOST_OUTPUT!, JSON.stringify(out), {flag:"wx"});
}, 260_000);

function loadCases(name: string): Array<DecisionAssessmentInput & { id: string }> {
    return JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
}

test("reports the retained e4 knight without changing the tactical evidence", () => {
    const [input] = loadCases("development.json");
    const report = classify(input, "Stockfish 19", input.history);
    expect(report?.mistake?.tactical.support).toBe("supported");
    const active = process.env.OUTPOST_ARM === "candidate";
    expect(report?.mistake?.category).toBe(active ? "mixed" : "tactical");
    const proof = (report?.mistake as { exchangeOutpost?: { factor: { squareOrFile: string } } })
        ?.exchangeOutpost;
    expect(proof?.factor.squareOrFile).toBe(active ? "e4" : undefined);
});

test("keeps the traded d5 bishop outside the positional report", () => {
    const input = loadCases("reserve.json").find(({ id }) => id.endsWith("6a6a404d0eaaef02"));
    expect(input).toBeDefined();
    const report = classify(input!, "Stockfish 19", input!.history);
    expect(report?.mistake?.category).toBe("tactical");
    expect(report?.mistake?.positional.support).toBe("unestablished");
});
