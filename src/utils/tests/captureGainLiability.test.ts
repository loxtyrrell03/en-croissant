import { expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { proveMatingDeflection } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    captureGainLiabilityCases,
    reflectCaptureLiability,
} from "./fixtures/captureGainLiability";
import {
    tacticalCaptureGain,
    tacticalExchangeGain,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

const cases = [
    ...captureGainLiabilityCases,
    ...captureGainLiabilityCases.map(reflectCaptureLiability),
];

test.each(cases)("$id counts legal off-square exchanges", (row) => {
    const step = replayTacticalLine(row.fen, [row.move])[0];
    expect(step).toBeTruthy();
    expect(tacticalCaptureGain(step)).toBe(row.gain);
    const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
    expect(result.motifs.filter((m) => m.id === "hangingPiece").map((m) => m.value)).toEqual(
        row.gain !== null && row.gain >= 100 ? [row.gain] : [],
    );
    expect(result.motifs.find((m) => m.id === "hangingPiece")?.label).toBe(row.label);
    const scan = buildLiveTacticalScan({
        fen: row.fen,
        pvUci: [row.move],
        depth: 16,
        engineName: "Control",
    });
    expect(scan.motifs.find((m) => m.id === "hangingPiece")?.label).toBe(row.label);
});

test.skipIf(
    !process.env.TACTICAL_CAPTURE_PRIVATE_BEFORE ||
        !process.env.TACTICAL_CAPTURE_PRIVATE_AFTER ||
        !process.env.TACTICAL_CAPTURE_PRIVATE_PROBES,
)("export changed private capture decisions without publishing paid positions", async () => {
    const { privateReportPath } =
        await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const before = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_PRIVATE_BEFORE!, "utf8"));
    const after = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_PRIVATE_AFTER!, "utf8"));
    const probes: { id: string; fen: string; searchMove?: string }[] = [];
    const seen = new Set<string>();
    const add = (id: string, fen: string, searchMove?: string) => {
        const key = `${fen}:${searchMove ?? ""}`;
        if (!seen.has(key)) {
            seen.add(key);
            probes.push({ id, fen, ...(searchMove ? { searchMove } : {}) });
        }
    };
    for (let group = 0; group < before.results.length; group++)
        for (let index = 0; index < before.results[group].cases.length; index++) {
            const old = before.results[group].cases[index],
                current = after.results[group].cases[index];
            expect(old.id).toBe(current.id);
            const lines = [
                {
                    line: old.sourceUci,
                    old: old.sourceResult.timeline,
                    next: current.sourceResult.timeline,
                },
                ...old.scan.variations.map((v: any, i: number) => ({
                    line: v.lineUci,
                    old: v.timeline,
                    next: current.scan.variations[i].timeline,
                })),
            ];
            for (const row of lines)
                for (const motif of row.old ?? []) {
                    if (
                        motif.id !== "hangingPiece" ||
                        motif.value ===
                            row.next?.find((m: any) => m.id === motif.id && m.ply === motif.ply)
                                ?.value
                    )
                        continue;
                    const steps = replayTacticalLine(old.fen, row.line);
                    const step = steps[motif.ply - 1];
                    expect(step).toBeTruthy();
                    add(
                        `${group}:${old.id}:ply${motif.ply}:held`,
                        makeFen(step.before.toSetup()),
                        step.uci,
                    );
                    if (!step.after.isEnd())
                        add(
                            `${group}:${old.id}:ply${motif.ply}:reply`,
                            makeFen(step.after.toSetup()),
                        );
                }
            if (group === 0 && old.id === "private-easy:202") {
                const root = replayTacticalLine(old.fen, old.sourceUci)[0];
                const proof = proveMatingDeflection(root)!;
                for (const branch of proof.declined) {
                    const reply = parseSan(root.after, branch.reply)!;
                    const position = root.after.clone();
                    position.play(reply);
                    add(
                        `private-deflection:${branch.reply}`,
                        makeFen(position.toSetup()),
                        makeUci(parseSan(position, branch.answer)!),
                    );
                }
            }
        }
    writeFileSync(
        privateReportPath(process.env.TACTICAL_CAPTURE_PRIVATE_PROBES!),
        JSON.stringify(
            {
                samplePath: "benchmarks/tactical-relevance/discovered-capture-development.json",
                probes,
            },
            null,
            2,
        ),
        { flag: "wx" },
    );
});

test.each([0, -1, 1, NaN, Infinity, 1.5])(
    "invalid or exhausted capture budget %s cannot borrow a cached result",
    (limit) => {
        const step = replayTacticalLine(cases[2].fen, [cases[2].move])[0];
        expect(tacticalCaptureGain(step)).toBe(900);
        expect(tacticalCaptureGain(step, limit)).toBeNull();
    },
);

test("the root discovery is not erased by an incomplete generic capture leaf", () => {
    const fen = "5rk1/Q1RR1pp1/4p2p/8/4KP2/3rP3/P1q3PP/8 b - - 1 30";
    const step = replayTacticalLine(fen, ["d3d7"])[0];
    expect(tacticalExchangeGain(step.before, step.move)).toBe(500);
    expect(tacticalCaptureGain(step)).toBe(-400);
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["d3d7"] }).motifs[0]).toMatchObject({
        id: "discoveredCheck",
        value: 500,
    });
});

test.skipIf(!process.env.TACTICAL_CAPTURE_AUDIT)(
    "export capture audit decisions for independent engine review",
    () => {
        const fen = "4r2k/5rp1/6qp/3PB3/4Q2n/3R4/6PP/4R1K1 b - - 0 1";
        const root = replayTacticalLine(fen, ["e8e5"])[0];
        const proof = proveMatingDeflection(root)!;
        expect(proof.gain).toBe(330);
        const probes: { id: string; fen: string; searchMove?: string; moves?: string[] }[] = [];
        for (const branch of proof.declined) {
            const reply = parseSan(root.after, branch.reply)!;
            const position = root.after.clone();
            position.play(reply);
            const answer = parseSan(position, branch.answer)!;
            probes.push({
                id: `deflection:${branch.reply}`,
                fen: makeFen(position.toSetup()),
                searchMove: makeUci(answer),
            });
        }
        const threatFen = fen.replace("6qp", "2b3qp").replace("3PB3", "3NB3");
        const threatRoot = replayTacticalLine(threatFen, ["e8e5"])[0];
        const threatProof = proveMatingDeflection(threatRoot)!;
        expect(threatProof.gain).toBe(150);
        for (const branch of threatProof.declined) {
            const position = threatRoot.after.clone();
            position.play(parseSan(position, branch.reply)!);
            probes.push({
                id: `deflection-threat:${branch.reply}`,
                fen: makeFen(position.toSetup()),
                searchMove: makeUci(parseSan(position, branch.answer)!),
            });
        }
        probes.push({
            id: "deflection-threat:bad-queen-capture",
            fen: threatFen,
            moves: ["e8e5", "d5f6"],
            searchMove: "e5e4",
        });
        for (const row of cases)
            probes.push({ id: `${row.id}:held`, fen: row.fen, searchMove: row.move });
        probes.push({
            id: "deflection:smaller-target",
            fen: fen.replace("3R4", "3B4"),
            searchMove: "e8e5",
        });
        const direct = ["e8e5", "e4h4", "g6d3"];
        probes.push({ id: "deflection:direct", fen, moves: direct });
        probes.push({
            id: "deflection:direct-countercheck",
            fen,
            moves: [...direct, "h4d8"],
            searchMove: "h8h7",
        });
        probes.push({ id: "deflection:direct-countercapture", fen, moves: [...direct, "e1e5"] });
        probes.push({
            id: "deflection:countercheck-countercapture",
            fen,
            moves: [...direct, "h4d8", "h8h7", "e1e5"],
        });
        const changes = [];
        for (const [file, id] of [
            ["secondary-theme-stockfish-18", "lichess:R13Ct"],
            ["cross-phase-stockfish-18", "lichess:I5Waq"],
        ]) {
            const row = JSON.parse(
                readFileSync(`benchmarks/tactical-relevance/${file}.json`, "utf8"),
            ).cases.find((r: any) => r.id === id);
            const sourceResult = classifyPositionTacticalMotifs({
                fen: row.fen,
                pvUci: row.sourceUci,
                pvSan: row.sourceSan,
                rootCp: row.sourceEngine.cp,
                previousFen: row.previousFen,
                previousMoveUci: row.previousMoveUci,
            });
            const scan = buildLiveTacticalScan({
                fen: row.fen,
                pvUci: row.engineLines[0].pvUci,
                variations: row.engineLines,
                depth: 16,
                engineName: "Stockfish 18",
                previousFen: row.previousFen,
                previousMoveUci: row.previousMoveUci,
            });
            changes.push({
                id,
                before: { sourceResult: row.sourceResult, scan: row.scan },
                after: { sourceResult, scan },
            });
            probes.push({ id: `${id}:root`, fen: row.fen, searchMove: row.sourceUci[0] });
        }
        expect(new Set(probes.map((row) => row.id)).size).toBe(probes.length);
        writeFileSync(
            process.env.TACTICAL_CAPTURE_AUDIT!,
            JSON.stringify(
                {
                    samplePath: "benchmarks/tactical-relevance/discovered-capture-development.json",
                    probes,
                    changes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
