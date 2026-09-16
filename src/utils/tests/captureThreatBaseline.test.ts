import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import {
    proveMatingCaptureAttack,
    provePersistentPawnCapture,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import { persistentPawnExchangeContext } from "../tacticalMotifs/gameHistory";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { captureMatingGuardCases } from "./fixtures/captureMatingGuard";

const cases = captureMatingGuardCases.flatMap((row) =>
    [false, true].map((reflected) => ({
        ...row,
        id: `${row.id}:${reflected}`,
        reflected,
        fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
        move: reflected ? reflectMixedForkMove("c8c3") : "c8c3",
    })),
);

const publicReceiptPath = "benchmarks/tactical-relevance/capture-mating-guard-stockfish-18.json";

test.skipIf(!process.env.TACTICAL_CAPTURE_THREAT_ENGINE)(
    "export only constructed capture-threat engine evidence",
    () => {
        const input = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_THREAT_ENGINE!, "utf8"));
        expect(input.completed).toBe(input.requested);
        const searches = input.searches.filter((r: any) =>
            cases.some(row => r.id.startsWith(`${row.id}:`)),
        ).map(({ id, fen, searchMove, lines }: any) => ({ id, fen, searchMove, lines }));
        expect(searches).toHaveLength(372);
        expect(existsSync(publicReceiptPath)).toBe(false);
        writeFileSync(publicReceiptPath, JSON.stringify({
            scope: "Constructed mating-guard concessions, both colours and contrary controls. Not independent real games or an accuracy estimate.",
            searches,
        }, null, 2) + "\n", { flag: "wx" });
    },
);

test("fresh engine evidence checks every selected public strategy decision and root explanation", () => {
    const receipt = JSON.parse(readFileSync(publicReceiptPath, "utf8"));
    expect(receipt.searches).toHaveLength(372);
    for (const entry of receipt.searches) for (const line of entry.lines) {
        expect(line.depth).toBe(16);
        expect(replayTacticalLine(entry.fen, line.pvUci)).toHaveLength(line.pvUci.length);
    }
    for (const row of cases) {
        const held = receipt.searches.find((r: any) => r.id === `${row.id}:1`);
        expect([held.fen, held.searchMove]).toEqual([row.fen, row.move]);
        const line = held.lines[0];
        const scan = buildLiveTacticalScan({ ...line, fen: row.fen,
            variations: [line], engineName: "Stockfish 18" });
        expect(scan.motifs.some(m => m.label === "Mating Attack")).toBe(row.positive);
        const proof = proveMatingCaptureAttack(replayTacticalLine(row.fen, [row.move])[0]);
        expect(Boolean(proof)).toBe(row.positive);
        for (const decision of proof?.decisions ?? []) {
            const search = receipt.searches.find((r: any) =>
                r.fen === decision.fen && r.searchMove === decision.move,
            );
            expect(search).toBeDefined();
            expect(search.lines[0].mate > 0 || search.lines[0].cp > 0).toBe(true);
        }
    }
});

test.skipIf(!process.env.TACTICAL_CAPTURE_THREAT_FOLLOWUP || !process.env.TACTICAL_CAPTURE_THREAT_INPUT)(
    "audit the additional real continuation changes and their mistake context",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CAPTURE_THREAT_FOLLOWUP!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_THREAT_INPUT!, "utf8"));
        const results = [
            { id: "recall:174086119698:ply26", variation: 2, step: 8 },
            { id: "recall:171699189308:ply47", variation: 0, step: 1 },
        ].map(({ id, variation, step }) => {
            const owner = input.results.find((r: any) => r.id === id);
            expect(owner).toBeDefined();
            const root = replayTacticalLine(owner.fen, owner.before[variation].pvUci)[step];
            expect(root).toBeDefined();
            const proof = proveMatingCaptureAttack(root);
            expect(proof).not.toBeNull();
            const fen = makeFen(root.before.toSetup());
            const decisions = [{ fen, move: "" }, { fen, move: root.uci }, ...proof!.decisions!];
            const probes = [...new Map(decisions.map(d => [`${d.fen}:${d.move}`, d])).values()]
                .map((d, i) => ({ id: `${id}:${i}`, fen: d.fen, ...(d.move ? { searchMove: d.move } : {}) }));
            return { id, variation, step, fen, move: root.uci, proof, probes };
        });
        const cause = input.results.find((r: any) => r.id === "recall:174477406194:ply76");
        expect(cause).toBeDefined();
        const probes = [...results.flatMap(r => r.probes),
            { id: "cause:best", fen: cause.fen },
            { id: "cause:better", fen: cause.fen, searchMove: cause.before[0].pvUci[0] },
            { id: "cause:played", fen: cause.fen, searchMove: cause.playedMoveUci },
        ];
        writeFileSync(output, JSON.stringify({ samplePath: process.env.TACTICAL_CAPTURE_THREAT_INPUT,
            scope: "Changed real continuations and exact preceding causal comparison; not a held-out accuracy sample.",
            results, probes }, null, 2), { flag: "wx" });
    },
);

test.skipIf(!process.env.TACTICAL_CAPTURE_THREAT_STRATEGIES)(
    "export constructed strategies and exact defensive decisions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CAPTURE_THREAT_STRATEGIES!);
        expect(existsSync(output)).toBe(false);
        const rows: any[] = [...cases];
        if (process.env.TACTICAL_CAPTURE_THREAT_INPUT) {
            const source = JSON.parse(
                readFileSync(process.env.TACTICAL_CAPTURE_THREAT_INPUT, "utf8"),
            );
            const owner = source.results.find((r: any) => r.id === "recall:174477406194:ply77");
            assert(owner, "The exact owner position must be present");
            rows.push({ id: "owner", fen: owner.fen, move: "c8c3" });
        }
        const results = rows.map((row) => {
            const root = replayTacticalLine(row.fen, [row.move])[0];
            expect(root).toBeDefined();
            const trace: string[] = [];
            const proof = proveMatingCaptureAttack(root, 8192, (reason) => trace.push(reason));
            const decisions = [
                { fen: row.fen, move: "" },
                { fen: row.fen, move: row.move },
                ...(proof?.decisions ?? []),
            ];
            for (const [from, tos] of root.after.allDests())
                for (const to of tos) {
                    const move = { from, to };
                    const after = root.after.clone();
                    after.play(move);
                    decisions.push(
                        { fen: makeFen(root.after.toSetup()), move: makeUci(move) },
                        { fen: makeFen(after.toSetup()), move: "" },
                    );
                }
            const probes = [
                ...new Map(decisions.map((d) => [`${d.fen}:${d.move}`, d])).values(),
            ].map((d, i) => ({
                id: `${row.id}:${i}`,
                fen: d.fen,
                ...(d.move ? { searchMove: d.move } : {}),
            }));
            return { ...row, proof, trace, probes };
        });
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Development strategy decisions and contrary resources, not an accuracy benchmark.",
                    samplePath: process.env.TACTICAL_CAPTURE_THREAT_INPUT,
                    results,
                    probes: results.flatMap((r) => r.probes),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.each(cases)("capture threats need more than the already available capture: $id", (row) => {
    const root = replayTacticalLine(row.fen, [row.move])[0];
    expect(root).toBeDefined();
    const proof = proveMatingCaptureAttack(root);
    expect(Boolean(proof)).toBe(row.positive);
    const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
    if (!row.positive) {
        assert(!result.motifs.some((m) => m.label === "Mating Attack"));
        return;
    }
    expect(proof?.gain).toBe(row.gain);
    expect(proof?.visits).toBeLessThanOrEqual(8192);
    expect(
        proof?.branches.some(
            (b) => b.gain === 280 && b.line[0] === (row.reflected ? "Kxh2" : "Kxh7"),
        ),
    ).toBe(true);
    expect(proof?.branches.some((b) => b.gain === 10000)).toBe(true);
    expect(result.motifs[0]).toMatchObject({ label: "Mating Attack", value: row.gain, ply: 1 });
    const scan = buildLiveTacticalScan({
        fen: row.fen,
        pvUci: [row.move],
        depth: 16,
        engineName: "Constructed mating geometry",
    });
    expect(scan.motifs).toEqual(result.motifs);
    expect(scan.arrows.every((a) => a.ply === 1)).toBe(true);
});

test("guard-concession proofs remain bounded and independent of the illustrated defence", () => {
    const row = cases[0];
    const root = replayTacticalLine(row.fen, [row.move])[0];
    expect(proveMatingCaptureAttack(root)).not.toBeNull();
    for (const limit of [0, 1, 50, -1, 1.5, NaN, Infinity])
        expect(proveMatingCaptureAttack(root, limit)).toBeNull();
    for (const pvUci of [[row.move], [row.move, "b7h7", "g8h7"], [row.move, "b3b4", "c3h3"]]) {
        expect(replayTacticalLine(row.fen, pvUci)).toHaveLength(pvUci.length);
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            pvUci,
            depth: 16,
            engineName: "Constructed mechanism",
        });
        expect(scan.motifs[0]).toMatchObject({ label: "Mating Attack", value: 200, ply: 1 });
        expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["c8c3", "c3h3"]);
    }
});

test.skipIf(
    !process.env.TACTICAL_CAPTURE_THREAT_INPUT || !process.env.TACTICAL_CAPTURE_THREAT_AUDIT,
)(
    "inspect remaining real capture and mating-threat omissions without assuming their labels",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const input = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_THREAT_INPUT!, "utf8"));
        const output = privateReportPath(process.env.TACTICAL_CAPTURE_THREAT_AUDIT!);
        expect(existsSync(output)).toBe(false);
        const selected = [
            "recall:174477406194:ply77",
            "recall:172462921812:ply42",
            "recall:174476976620:ply35",
        ];
        const results = selected.map((id) => {
            const row = input.results.find((r: any) => r.id === id);
            expect(row).toBeDefined();
            const root = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
            const trace: string[] = [];
            const proof = proveMatingCaptureAttack(root, 8192, (reason) => trace.push(reason));
            const probes = [
                { id: `${id}:best`, fen: row.fen },
                { id: `${id}:held`, fen: row.fen, searchMove: root.uci },
            ];
            for (const [from, tos] of root.after.allDests())
                for (const to of tos) {
                    const reply = { from, to };
                    const next = root.after.clone();
                    next.play(reply);
                    probes.push(
                        {
                            id: `${id}:reply-${makeUci(reply)}`,
                            fen: makeFen(root.after.toSetup()),
                            searchMove: makeUci(reply),
                        },
                        { id: `${id}:answer-${makeUci(reply)}`, fen: makeFen(next.toSetup()) },
                    );
                }
            return {
                id,
                fen: row.fen,
                move: root.uci,
                trace,
                proof,
                captureGain: tacticalCaptureGain(root),
                pawnContext: persistentPawnExchangeContext(row.tacticalHistory, row.fen, root.move),
                pawnProof: provePersistentPawnCapture(root, row.tacticalHistory),
                probes,
            };
        });
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Development hypotheses, not correctness labels.",
                    samplePath: process.env.TACTICAL_CAPTURE_THREAT_INPUT,
                    results,
                    probes: results.flatMap((r) => r.probes),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            JSON.stringify(results.map(({ probes, ...r }) => ({ ...r, searches: probes.length }))),
        );
    },
);
