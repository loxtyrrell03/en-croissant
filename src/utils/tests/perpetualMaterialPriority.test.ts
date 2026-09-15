import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import { provePerpetualCheck, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    perpetualMaterialFen as fen,
    perpetualMaterialLine as line,
    perpetualMaterialCases,
} from "./fixtures/perpetualMaterial";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

test.each(
    perpetualMaterialCases.flatMap((row) => [
        row,
        { ...row, id: `${row.id}:black`, fen: reflectMixedForkFen(row.fen) },
    ]),
)("$id: drawing-resource proof and primary are distinct from local material", (row) => {
    const moves = "move" in row ? [row.move] : line;
    const pvUci = row.id.endsWith(":black") ? moves.map(reflectMixedForkMove) : moves;
    expect(replayTacticalLine(row.fen, [pvUci[0]])).toHaveLength(1);
    const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci, rootCp: row.cp });
    expect(row.expected === null || result.motifs[0]?.id === row.expected).toBe(true);
    expect(result.motifs.some((m) => m.id === "perpetualCheck")).toBe(
        row.expected === "perpetualCheck",
    );
});

test.each([undefined, null, NaN, Infinity, 51, -51, 100, 600])(
    "unresolved or non-equal score %s does not displace the material lesson",
    (rootCp) => {
        expect(classifyPositionTacticalMotifs({ fen, pvUci: line, rootCp }).motifs[0]?.id).toBe(
            "fork",
        );
    },
);

test("a checking fork enters a saving rook cycle, with the fork retained second", () => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(line.length);
    const proof = provePerpetualCheck(steps);
    const shortProof = provePerpetualCheck(steps.slice(0, 1));
    expect(proof).not.toBeNull();
    expect(shortProof).not.toBeNull();
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line, rootCp: 0 });
    expect(result.motifs[0]).toMatchObject({
        id: "perpetualCheck",
        value: 0,
        relevance: "primary",
        ply: 1,
    });
    expect(result.motifs[1]).toMatchObject({ id: "fork", relevance: "secondary", ply: 1 });
    const scan = buildLiveTacticalScan({
        fen,
        pvUci: line,
        variations: [{ pvUci: line, cp: 0 }],
        depth: 16,
        engineName: "Control",
    });
    expect(scan.motifs[0].id).toBe("perpetualCheck");
    expect(scan.labels[0].text).toBe("Perpetual Check");
    expect(scan.arrows.every((a) => a.ply === 1)).toBe(true);
    expect(scan.variations[0].timeline.some((m) => m.id === "fork" && m.ply === 1)).toBe(true);
    expect(classifyPositionTacticalMotifs({ fen, pvUci: [line[0]], rootCp: 0 }).motifs[0]?.id).toBe(
        "perpetualCheck",
    );
});

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "inspect the frozen owner saving-resource root",
    () => {
        const baseline = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        const games = [...new Set(baseline.results.map((r: any) => r.game))];
        const row = baseline.results.find((r: any) => r.game === games[2] && r.ply === 82);
        const steps = replayTacticalLine(row.fen, row.before[0].pvUci);
        expect(provePerpetualCheck(steps)).not.toBeNull();
        expect(provePerpetualCheck(steps.slice(0, 1))).not.toBeNull();
        expect(
            classifyPositionTacticalMotifs({
                fen: row.fen,
                pvUci: row.before[0].pvUci,
                rootCp: row.before[0].cp,
            }).motifs[0],
        ).toMatchObject({ id: "perpetualCheck", value: 0 });
        const review = classifyMistakeReviewMotifs({
            fen: row.fen,
            bestMoveUci: row.before[0].pvUci[0],
            playedMoveUci: row.playedMoveUci,
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            cpBefore: row.before[0].cp,
            cpAfter: -row.after[0].cp,
            cpLoss: row.before[0].cp + row.after[0].cp,
        });
        expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
            id: "perpetualCheck",
            source: "missed",
            value: 0,
        });
    },
);

test.skipIf(!process.env.TACTICAL_PERPETUAL_PROBES)(
    "export legal cycle branches and contrary controls for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const baseline = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        const games = [...new Set(baseline.results.map((r: any) => r.game))];
        const row = baseline.results.find((r: any) => r.game === games[2] && r.ply === 82);
        const probes: { id: string; fen: string; searchMove?: string }[] = [];
        const witnesses = [];
        for (const [id, startFen, moves] of [
            ["owner", row.fen, row.before[0].pvUci],
            ["constructed", fen, line],
        ] as const) {
            const steps = replayTacticalLine(startFen, [...moves]);
            const proof = provePerpetualCheck(steps)!;
            expect(proof).not.toBeNull();
            probes.push(
                { id: `${id}:best`, fen: startFen },
                { id: `${id}:root`, fen: startFen, searchMove: steps[0].uci },
            );
            const pos = steps[0].before.clone();
            const branches = [];
            for (const san of proof.line) {
                const before = makeFen(pos.toSetup()),
                    move = parseSan(pos, san)!;
                expect(move).toBeDefined();
                expect(
                    pos.turn === steps[0].before.turn ||
                        [...pos.allDests()].reduce((n, [, dests]) => n + dests.size(), 0) === 1,
                ).toBe(true);
                if (pos.turn === steps[0].before.turn)
                    probes.push({
                        id: `${id}:answer:${branches.length}`,
                        fen: before,
                        searchMove: makeUci(move),
                    });
                branches.push({ fen: before, move: makeUci(move), san });
                pos.play(move);
            }
            witnesses.push({ id, proof, branches });
            probes.push({
                id: `${id}:premature-knight-capture`,
                fen: startFen,
                searchMove: "b7h7",
            });
        }
        for (const c of perpetualMaterialCases.filter(
            (c) => c.id !== "positive-position-not-saving",
        ))
            for (const reflected of [false, true])
                probes.push({
                    id: `${c.id}:${reflected}`,
                    fen: reflected ? reflectMixedForkFen(c.fen) : c.fen,
                    searchMove: reflected
                        ? reflectMixedForkMove("move" in c ? c.move : line[0])
                        : "move" in c
                          ? c.move
                          : line[0],
                });
        writeFileSync(
            privateReportPath(process.env.TACTICAL_PERPETUAL_PROBES!),
            JSON.stringify(
                { samplePath: process.env.TACTICAL_RECALL_SAMPLE, probes, witnesses },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
