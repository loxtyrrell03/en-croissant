import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { expect, test } from "vitest";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    discoveredPinPriorityFen,
    discoveredPinPriorityLine,
    discoveredPinPriorityControls,
} from "./fixtures/discoveredPinPriority";

test.each([false, true])(
    "the revealed attack explains the new pin, not generic preparation (reflected %s)",
    (reflected) => {
        const fen = reflected
            ? reflectMixedForkFen(discoveredPinPriorityFen)
            : discoveredPinPriorityFen;
        const line = reflected
            ? discoveredPinPriorityLine.map(reflectMixedForkMove)
            : discoveredPinPriorityLine;
        for (const pvUci of [line.slice(0, 1), line]) {
            const result = classifyPositionTacticalMotifs({ fen, pvUci });
            expect(result.motifs[0]).toMatchObject({
                id: "discoveredAttack",
                confidence: "high",
                ply: 1,
                value: 250,
            });
            expect(result.motifs.some((m) => m.id === "tacticalPreparation")).toBe(false);
            expect(result.motifs.find((m) => m.id === "pin")).toMatchObject({
                relevance: "secondary",
                value: 250,
            });
            const scan = buildLiveTacticalScan({
                fen,
                pvUci,
                depth: 16,
                engineName: "Structural proof",
            });
            expect(scan.motifs[0].id).toBe("discoveredAttack");
            expect(scan.arrows.every((a) => a.ply === 1)).toBe(true);
        }
    },
);

test.each(discoveredPinPriorityControls)("contrary defence: $name", ({ fen }) => {
    for (const reflected of [false, true]) {
        const result = classifyPositionTacticalMotifs({
            fen: reflected ? reflectMixedForkFen(fen) : fen,
            pvUci: [reflected ? reflectMixedForkMove("e6g5") : "e6g5"],
        });
        expect(
            result.motifs.some(
                (m) =>
                    m.confidence === "high" &&
                    ["discoveredAttack", "pin", "tacticalPreparation"].includes(m.id),
            ),
        ).toBe(false);
    }
});

test("a local queen-for-two-minors gain cannot recommend the losing stripped-down ending", () => {
    // Fresh Stockfish 18 depth-16 searches: best Nf4 +412, held Ng5 -506.
    // The local 250-cp mechanism is real, but removing the other pieces has
    // made its resulting pawn ending lost. It is not a sound live alternative.
    const scan = buildLiveTacticalScan({
        fen: discoveredPinPriorityFen,
        engineName: "Frozen Stockfish 18",
        depth: 16,
        pvUci: ["e6f4"],
        variations: [{ depth: 16, multipv: 1, pvUci: ["e6f4"], cp: 412 }],
        supplementalVariations: [{ depth: 16, pvUci: discoveredPinPriorityLine, cp: -506 }],
    });
    expect(scan.variations.some((v) => v.lineUci[0] === "e6g5")).toBe(false);
});

test.skipIf(!process.env.TACTICAL_DISCOVERED_PIN_OWNER)(
    "the actual owner candidate uses the specific mechanism",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_DISCOVERED_PIN_OWNER!, "utf8"));
        const row = report.results.find((r: any) => r.id === "recall:173812142756:ply26");
        expect(row).toBeDefined();
        const scan = buildLiveTacticalScan(row.scanInput);
        const option = scan.variations.find((v) => v.lineUci[0] === "e6g5")!;
        expect(option.motifs[0]).toMatchObject({ id: "discoveredAttack", value: 250 });
        expect(option.motifs.find((m) => m.id === "pin")?.relevance).toBe("secondary");
        expect(option.motifs.some((m) => m.id === "tacticalPreparation")).toBe(false);
        expect(scan.motifs[0].id).toBe("fork");
    },
);

test.skipIf(
    !process.env.TACTICAL_DISCOVERED_PIN_OWNER || !process.env.TACTICAL_DISCOVERED_PIN_PROBES,
)("prepare a complete legal-defence engine audit, not a cooperating PV", async () => {
    const { privateReportPath } =
        await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const output = privateReportPath(process.env.TACTICAL_DISCOVERED_PIN_PROBES!);
    expect(existsSync(output)).toBe(false);
    const report = JSON.parse(readFileSync(process.env.TACTICAL_DISCOVERED_PIN_OWNER!, "utf8"));
    const owner = report.results.find((r: any) => r.id === "recall:173812142756:ply26");
    expect(owner).toBeDefined();
    const probes: { id: string; fen: string; moves?: string[]; searchMove?: string }[] = [];
    for (const [id, fen] of [
        ["owner", owner.fen],
        ["constructed", discoveredPinPriorityFen],
    ] as const) {
        probes.push({ id: `${id}:best`, fen }, { id: `${id}:Ng5`, fen, searchMove: "e6g5" });
        const step = replayTacticalLine(fen, ["e6g5"])[0];
        expect(step).toBeDefined();
        for (const [from, tos] of step.after.allDests())
            for (const to of tos) {
                const promotions =
                    step.after.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                        ? (["queen", "rook", "bishop", "knight"] as const)
                        : [undefined];
                for (const promotion of promotions) {
                    const move = { from, to, promotion };
                    const next = step.after.clone();
                    expect(next.isLegal(move)).toBe(true);
                    next.play(move);
                    probes.push({
                        id: `${id}:reply:${makeUci(move)}`,
                        fen: makeFen(next.toSetup()),
                    });
                }
            }
    }
    for (const row of discoveredPinPriorityControls) {
        probes.push({ id: row.name, fen: row.fen, searchMove: "e6g5" });
    }
    writeFileSync(
        output,
        JSON.stringify({ samplePath: process.env.TACTICAL_DISCOVERED_PIN_OWNER, probes }, null, 2),
        { flag: "wx" },
    );
    console.log({ requested: probes.length });
});
