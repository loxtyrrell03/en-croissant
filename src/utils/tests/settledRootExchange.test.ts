import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { settledRootExchangeCases } from "./fixtures/settledRootExchange";
import { replayTacticalLine, tacticalCaptureGain } from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { settledRootCaptureExchange } from "../tacticalMotifs/gameHistory";

test.each(settledRootExchangeCases)(
    "settled root exchange retains the current gain: $id",
    (row) => {
        const root = replayTacticalLine(row.fen, row.pvUci)[0];
        expect(root).toBeDefined();
        const result = classifyPositionTacticalMotifs({ ...row, rootCp: 100 });
        if (row.gain !== null) {
            assert.equal(tacticalCaptureGain(root), row.gain);
            assert.deepEqual(
                [result.motifs[0]?.id, result.motifs[0]?.value, result.motifs[0]?.ply],
                ["hangingPiece", row.gain, 1],
            );
            assert.equal(
                result.motifs[0].label,
                row.gain === 100 ? "Hanging Pawn" : "Winning Recapture",
            );
            assert.match(result.motifs[0].evidence ?? "", /settled/);
        } else assert(!result.motifs.some((m) => m.id === "hangingPiece"));
        const scan = buildLiveTacticalScan({
            ...row,
            engineName: "Constructed, synthetic nomination score",
            depth: 16,
            variations: [{ pvUci: row.pvUci, cp: 100, depth: 16 }],
        });
        expect(scan.motifs).toEqual(result.motifs);
        if (row.gain === 100) assert.equal(scan.variations[0].timeline.length, 1);
    },
);

test("quiet gaps and earlier unequal exchanges do not earn settlement credit", () => {
    const row = settledRootExchangeCases.find(
        (row) => row.id === "settled-bishops-then-queen:false",
    )!;
    for (const tacticalHistory of [
        { ...row.tacticalHistory, moves: [...row.tacticalHistory.moves, "a7a6", "a2a3"] },
        {
            ...row.tacticalHistory,
            fen: row.tacticalHistory.fen.replace("3B1P2", "3R1P2").replace("RNBQ2KR", "BNBQ2KR"),
        },
    ]) {
        const history = replayTacticalLine(tacticalHistory.fen, tacticalHistory.moves);
        expect(history).toHaveLength(tacticalHistory.moves.length);
        const fen = makeFen(history.at(-1)!.after.toSetup());
        const root = replayTacticalLine(fen, row.pvUci)[0];
        expect(root).toBeDefined();
        expect(
            settledRootCaptureExchange(
                tacticalHistory,
                fen,
                root.move,
                makeFen(history.at(-1)!.before.toSetup()),
                tacticalHistory.moves.at(-1)!,
            ),
        ).toBeNull();
    }
});

test.skipIf(!process.env.TACTICAL_SETTLED_ROOT_ENGINE)(
    "retain a public-only fresh engine receipt",
    () => {
        const input = JSON.parse(readFileSync(process.env.TACTICAL_SETTLED_ROOT_ENGINE!, "utf8"));
        expect(input.completed).toBe(input.requested);
        const ids = new Set(settledRootExchangeCases.map((row) => row.id));
        const searches = input.searches
            .filter((row: any) => [...ids].some((id) => row.id.startsWith(`${id}:`)))
            .map((row: any) => ({
                id: row.id,
                fen: row.fen,
                searchMove: row.searchMove,
                lines: row.lines,
            }));
        expect(searches.length).toBeGreaterThan(36);
        expect(searches.some((row: any) => row.id.startsWith("owner:"))).toBe(false);
        const output = "benchmarks/tactical-relevance/settled-root-exchange-stockfish-18.json";
        expect(existsSync(output)).toBe(false);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Constructed complete-history cases and legal recapture controls; not independent games or an accuracy estimate.",
                    searches,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
    },
);

test("fresh engine lines preserve settled exchanges without admitting losing recaptures", () => {
    const report = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/settled-root-exchange-stockfish-18.json",
            "utf8",
        ),
    );
    for (const row of settledRootExchangeCases) {
        const searched = report.searches.find((entry: any) => entry.id === `${row.id}:held`);
        expect(searched.fen).toBe(row.fen);
        expect(searched.searchMove).toBe(row.pvUci[0]);
        const line = searched.lines[0];
        expect(line.depth).toBe(16);
        expect(replayTacticalLine(row.fen, line.pvUci)).toHaveLength(line.pvUci.length);
        const scan = buildLiveTacticalScan({
            ...row,
            ...line,
            variations: [line],
            engineName: "Stockfish 18",
        });
        if (row.gain !== null) {
            assert(line.cp > 0);
            assert.equal(scan.motifs[0]?.value, row.gain);
        } else assert(!scan.motifs.some((m) => m.id === "hangingPiece"));
    }
});

test("missing game context keeps the existing conservative non-pawn recapture value", () => {
    const row = settledRootExchangeCases.find(
        (row) => row.id === "settled-bishops-then-queen:false",
    )!;
    expect(
        classifyPositionTacticalMotifs({ ...row, tacticalHistory: undefined, rootCp: 100 })
            .motifs[0],
    ).toMatchObject({ label: "Winning Recapture", value: 570 });
    const root = replayTacticalLine(row.fen, row.pvUci)[0];
    expect(
        settledRootCaptureExchange(
            row.tacticalHistory,
            row.fen,
            root.move,
            row.fen,
            row.previousMoveUci,
        ),
    ).toBeNull();
});

test.skipIf(!process.env.TACTICAL_SETTLED_ROOT_OWNER)(
    "changed real reviews keep the major missed capture and neutral best-play dangers",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_SETTLED_ROOT_OWNER!, "utf8"));
        const review = (id: string) => {
            const row = report.results.find((row: any) => row.id === id);
            expect(row).toBeDefined();
            const side = row.fen.split(" ")[1] === "w" ? 1 : -1;
            return classifyMistakeReviewMotifs({
                ...row,
                bestMoveUci: row.before[0].pvUci[0],
                pvUci: row.before[0].pvUci,
                refutationUci: row.after[0].pvUci,
                cpBefore: row.before[0].cp * side,
                cpAfter: -row.after[0].cp * side,
                cpLoss: Math.max(0, row.before[0].cp + row.after[0].cp),
            });
        };
        const bishop = buildMistakeReviewTacticalExplanation(review("recall:174477890504:ply16"));
        expect(bishop?.primary).toMatchObject({ source: "missed", value: 230, moveUci: "g4h5" });
        expect(bishop?.secondary).toMatchObject({
            source: "allowed",
            value: 100,
            moveUci: "d6e5",
            comparison: "prevented",
        });
        expect(review("recall:174431074004:ply17").allowedMotifs[0]).toMatchObject({
            moveUci: "d4e5",
            value: 900,
            comparison: "prevented",
        });
        for (const id of ["recall:171699189308:ply8", "recall:171699189308:ply90"]) {
            const result = review(id);
            expect(result.missedMotifs).toEqual([]);
            expect(result.allowedMotifs[0].comparison).toBe("persists");
            expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
                "Tactical danger in the position",
            );
        }
    },
);

test.skipIf(!process.env.TACTICAL_SETTLED_ROOT_OWNER)(
    "the real played pawn gain becomes visible without a missed-move accusation",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_SETTLED_ROOT_OWNER!, "utf8"));
        const row = report.results.find((row: any) => row.id === "recall:171699189308:ply9");
        expect(row).toBeDefined();
        const scan = buildLiveTacticalScan({
            ...row,
            ...row.before[0],
            variations: row.before,
            engineName: "Stockfish 18",
        });
        expect(scan.motifs[0]).toMatchObject({
            label: "Hanging Pawn",
            value: 100,
            moveUci: "c6d4",
        });
        expect(scan.variations[0].timeline).toHaveLength(1);
        expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["c6d4"]);
        const result = classifyMistakeReviewMotifs({
            ...row,
            bestMoveUci: "c6d4",
            playedMoveUci: "c6d4",
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            cpBefore: -row.before[0].cp,
            cpAfter: row.after[0].cp,
            cpLoss: 0,
        });
        expect(result.missedMotifs).toEqual([]);
    },
);

test.skipIf(!process.env.TACTICAL_SETTLED_ROOT_OWNER || !process.env.TACTICAL_SETTLED_ROOT_PROBES)(
    "export constructed controls and real capture defences for fresh engine judgement",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_SETTLED_ROOT_PROBES!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_SETTLED_ROOT_OWNER!, "utf8"));
        const owner = input.results.find((row: any) => row.id === "recall:171699189308:ply9");
        expect(owner).toBeDefined();
        const probes: any[] = [];
        for (const row of [
            ...settledRootExchangeCases,
            { ...owner, id: "owner", pvUci: ["c6d4"] },
        ]) {
            const root = replayTacticalLine(row.fen, row.pvUci)[0];
            expect(root).toBeDefined();
            const afterFen = makeFen(root.after.toSetup());
            probes.push(
                { id: `${row.id}:best`, fen: row.fen },
                { id: `${row.id}:held`, fen: row.fen, searchMove: row.pvUci[0] },
                { id: `${row.id}:after`, fen: afterFen },
            );
            for (const [from, tos] of root.after.allDests())
                for (const to of tos) {
                    if (row.id !== "owner" && to !== root.move.to) continue;
                    const move = { from, to };
                    expect(root.after.isLegal(move)).toBe(true);
                    const next = root.after.clone();
                    next.play(move);
                    probes.push(
                        {
                            id: `${row.id}:reply-${makeUci(move)}`,
                            fen: afterFen,
                            searchMove: makeUci(move),
                        },
                        { id: `${row.id}:answer-${makeUci(move)}`, fen: makeFen(next.toSetup()) },
                    );
                }
        }
        expect(new Set(probes.map((p) => p.id)).size).toBe(probes.length);
        writeFileSync(
            output,
            JSON.stringify(
                { samplePath: process.env.TACTICAL_SETTLED_ROOT_OWNER, probes },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(
    !process.env.TACTICAL_SETTLED_ROOT_CHANGED || !process.env.TACTICAL_SETTLED_ROOT_CHANGED_PROBES,
)("audit additional changed real roots and their capturing defences", async () => {
    const { privateReportPath } =
        await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const input = JSON.parse(readFileSync(process.env.TACTICAL_SETTLED_ROOT_CHANGED!, "utf8"));
    const output = privateReportPath(process.env.TACTICAL_SETTLED_ROOT_CHANGED_PROBES!);
    expect(existsSync(output)).toBe(false);
    const selected = [
        ["recall:174477890504:ply17", "d6e5"],
        ["recall:174431074004:ply18", "d4e5"],
        ["recall:171699189308:ply91", "f2h4"],
        ["recall:171698935834:ply19", "d6e5"],
    ];
    const probes: any[] = [];
    for (const [id, moveUci] of selected) {
        const row = input.results.find((r: any) => r.id === id);
        expect(row).toBeDefined();
        const root = replayTacticalLine(row.fen, [moveUci])[0];
        expect(root).toBeDefined();
        const afterFen = makeFen(root.after.toSetup());
        probes.push(
            { id: `${id}:best`, fen: row.fen },
            { id: `${id}:held`, fen: row.fen, searchMove: moveUci },
            { id: `${id}:after`, fen: afterFen },
        );
        for (const [from, tos] of root.after.allDests())
            for (const to of tos) {
                if (!root.after.board.get(to)) continue;
                const move = { from, to };
                const next = root.after.clone();
                next.play(move);
                probes.push(
                    {
                        id: `${id}:capture-${makeUci(move)}`,
                        fen: afterFen,
                        searchMove: makeUci(move),
                    },
                    { id: `${id}:answer-${makeUci(move)}`, fen: makeFen(next.toSetup()) },
                );
            }
    }
    for (const changed of input.changed.filter((row: any) => row.keys.includes("classification"))) {
        const row = input.results.find((r: any) => r.id === changed.id);
        probes.push(
            { id: `${row.id}:choice-best`, fen: row.fen },
            { id: `${row.id}:choice-played`, fen: row.fen, searchMove: row.playedMoveUci },
        );
    }
    expect(new Set(probes.map((p) => p.id)).size).toBe(probes.length);
    writeFileSync(
        output,
        JSON.stringify({ samplePath: process.env.TACTICAL_SETTLED_ROOT_CHANGED, probes }, null, 2),
        { flag: "wx" },
    );
});

test("missing or shortened exchange history cannot claim a settled pawn trade", () => {
    const row = settledRootExchangeCases[0];
    const history = replayTacticalLine(row.tacticalHistory.fen, row.tacticalHistory.moves);
    for (const tacticalHistory of [
        undefined,
        { fen: makeFen(history.at(-1)!.before.toSetup()), moves: [row.previousMoveUci] },
        { ...row.tacticalHistory, moves: row.tacticalHistory.moves.slice(0, -1) },
    ]) {
        expect(
            classifyPositionTacticalMotifs({ ...row, tacticalHistory, rootCp: 100 }).motifs,
        ).toEqual([]);
    }
});
