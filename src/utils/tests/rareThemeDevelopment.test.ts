import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fixture = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/rare-theme-development.json", "utf8"),
);

test("replays the fixed rare-theme real-game sample without treating supplied tags as truth", () => {
    expect(fixture.cases).toHaveLength(20);
    const report = fixture.cases.map(
        (row: { id: string; startFen: string; bestLine: string[]; initialJudgement: string }) => {
            const steps = replayTacticalLine(row.startFen, row.bestLine);
            expect({ id: row.id, length: steps.length }).toEqual({
                id: row.id,
                length: row.bestLine.length,
            });
            return {
                ...row,
                san: steps.map((s) => s.san),
                result: classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine }),
                scan: buildLiveTacticalScan({
                    fen: row.startFen,
                    pvUci: row.bestLine,
                    depth: 16,
                    engineName: "Source continuation",
                }),
            };
        },
    );
    if (process.env.TACTICAL_RARE_THEME_REPORT)
        writeFileSync(
            process.env.TACTICAL_RARE_THEME_REPORT,
            JSON.stringify(
                {
                    scope: "Legal replay and current development outputs, not twenty correct answers.",
                    cases: report,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});

test.skipIf(
    !process.env.TACTICAL_PRIVATE_REPLAY_INPUT || !process.env.TACTICAL_PRIVATE_REPLAY_REPORT,
)(
    "audit exact prior source and engine inputs without mistaking changed PVs for classifier changes",
    () => {
        const paths: string[] = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_REPLAY_INPUT!, "utf8"),
        );
        expect(paths.length).toBeGreaterThan(0);
        const results = paths.map((path) => {
            const before = JSON.parse(readFileSync(path, "utf8"));
            expect(before.cases.length).toBeGreaterThan(0);
            const changes: { id: string; source: boolean; live: boolean }[] = [];
            const clean = (data: unknown) =>
                JSON.stringify(data, (key, value) =>
                    ["motifClassifierVersion", "version"].includes(key) ? undefined : value,
                );
            const cases = before.cases.map((row: any) => {
                const sourceResult = classifyPositionTacticalMotifs({
                    fen: row.fen,
                    pvUci: row.sourceUci,
                    pvSan: row.sourceSan,
                    rootCp: row.sourceEngine.cp,
                });
                const scan = buildLiveTacticalScan({
                    fen: row.fen,
                    pvUci: row.engineLines[0].pvUci,
                    variations: row.engineLines,
                    depth: 16,
                    engineName: "Stockfish 18",
                });
                const source = clean(sourceResult) !== clean(row.sourceResult),
                    live = clean(scan) !== clean(row.scan);
                if (source || live) changes.push({ id: row.id, source, live });
                return { ...row, sourceResult, scan };
            });
            return { path, changes, cases };
        });
        writeFileSync(
            process.env.TACTICAL_PRIVATE_REPLAY_REPORT!,
            JSON.stringify(
                {
                    scope: "Exact-input replay differential. No new engine searches or correctness claims. Paid inputs must stay private.",
                    results,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
    120000,
);
