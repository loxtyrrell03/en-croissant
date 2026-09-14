import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const sample = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/checking-pawn-development.json", "utf8"),
);
const judgement = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/checking-pawn-initial-judgement.json", "utf8"),
);
const evidence = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/checking-pawn-stockfish-18.json", "utf8"),
);
const searches = evidence.groups.flatMap((g: any) => g.searches);

test("replay the retained baseline's exact inputs and record every change", () => {
    const baseline = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/direct-threat-adapter98-baseline.json", "utf8"),
    );
    const clean = (value: unknown) =>
        JSON.stringify(value, (key, value) =>
            ["version", "motifClassifierVersion"].includes(key) ? undefined : value,
        );
    const cases = baseline.cases.map((row: any) => {
        const { result: priorResult, scan: priorScan, ...input } = row;
        const result = classifyPositionTacticalMotifs(input);
        const scan = buildLiveTacticalScan({
            ...input,
            depth: 16,
            engineName: "Retained baseline",
        });
        return {
            ...input,
            result,
            scan,
            sourceChanged: clean(result) !== clean(priorResult),
            scanChanged: clean(scan) !== clean(priorScan),
        };
    });
    expect(cases[0].result.timeline.some((m: any) => m.id === "attacking_undefended_piece")).toBe(
        false,
    );
    expect(cases[0].sourceChanged).toBe(true);
    if (process.env.TACTICAL_DIRECT_BASELINE_REPORT)
        writeFileSync(
            process.env.TACTICAL_DIRECT_BASELINE_REPORT,
            JSON.stringify(
                {
                    scope: "Exact adapter-98 inputs replayed through the updated source. Unchanged labels are not an accuracy score.",
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
}, 30000);

test("the thirty output-blind candidates retain identity and 105 fresh search lines replay legally", () => {
    expect(sample.cases.map((r: any) => r.id)).toEqual(judgement.cases.map((r: any) => r.id));
    expect(sample.cases).toHaveLength(30);
    expect(searches).toHaveLength(105);
    for (const row of searches)
        for (const line of row.lines) {
            expect({ id: row.id, length: replayTacticalLine(row.fen, line.pvUci).length }).toEqual({
                id: row.id,
                length: line.pvUci.length,
            });
            expect(row.searchMove === undefined || line.pvUci[0] === row.searchMove).toBe(true);
        }
});
test("replay every fixed checking capture and unrestricted engine choice, without counting empty results as correct", () => {
    const cases = sample.cases.map((row: any) => {
        const fixed = searches.find((s: any) => s.id === row.id);
        const best = searches.find((s: any) => s.id === `${row.id}:choice`);
        expect({ id: row.id, fixed: Boolean(fixed), best: Boolean(best) }).toEqual({
            id: row.id,
            fixed: true,
            best: true,
        });
        return {
            ...row,
            fixed: classifyPositionTacticalMotifs({
                fen: row.fen,
                pvUci: fixed.lines[0].pvUci,
                rootCp: fixed.lines[0].cp,
            }),
            scan: buildLiveTacticalScan({
                fen: row.fen,
                pvUci: best.lines[0].pvUci,
                variations: best.lines,
                depth: 16,
                engineName: "Stockfish 18",
            }),
        };
    });
    if (process.env.TACTICAL_CHECKING_PAWN_AUDIT_REPORT)
        writeFileSync(
            process.env.TACTICAL_CHECKING_PAWN_AUDIT_REPORT,
            JSON.stringify(
                {
                    scope: "Thirty development candidates, not an accuracy percentage. Review actual labels separately.",
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
}, 30000);
test("the rejected draft's apparently retained pawn does not validate its losing follow-up", () => {
    const draft = evidence.rejectedDraft.find((r: any) => r.id === "checking-pawn:e0e5088e948b");
    expect(draft.proof.branches.find((b: any) => b.replyUci === "g1f1").holdUci).toBe("h6g5");
    const root = searches.find((r: any) => r.id === "checking-pawn:e0e5088e948b");
    const witness = searches.find((r: any) => r.id === "checking-pawn:e0e5088e948b:hold:g1f1");
    expect(root.lines[0].cp).toBeGreaterThan(300);
    expect(witness.lines[0].cp).toBeLessThan(-300);
    expect(witness.lines[0].pvUci.slice(0, 3)).toEqual(["h6g5", "e3g5", "f6g5"]);
});
