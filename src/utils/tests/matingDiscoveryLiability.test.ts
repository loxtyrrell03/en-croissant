import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    replayTacticalLine,
    proveMatingCaptureReply,
    proveDiscoveredMaterial,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { makeFen } from "chessops/fen";

const fen = "3r2k1/5rb1/1p3n2/3P4/1B1N1R2/8/6PP/5RK1 b - - 0 1";
test("the apparently loose rook is protected by a concrete mating reply", () => {
    const line = ["f6d5", "d4c6", "d5f4", "c6d8", "f4e2", "g1h1", "f7f1"];
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(7);
    expect(proveMatingCaptureReply(steps[3])).toEqual(["Ne2+", "Kh1", "Rxf1#"]);
    expect(steps[6].after.isCheckmate()).toBe(true);
});
test("the full discovery proof includes the protected rook and both newly opened rays", () => {
    const step = replayTacticalLine(fen, ["f6d5"])[0];
    const failures: string[] = [];
    expect(
        proveDiscoveredMaterial(step, 4096, 101, undefined, (message) => failures.push(message)),
    ).toBe(250);
    expect(failures).toEqual([]);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["f6d5"] });
    expect(result.motifs[0]).toMatchObject({ id: "discoveredAttack", ply: 1, value: 250 });
    expect(result.motifs[0].evidence).toContain("rook on f7 against the rook on f4");
    expect(result.motifs[0].evidence).toContain("bishop on g7 against the knight on d4");
});
test("both colours retain the root lesson without borrowing a cooperative mating PV", () => {
    const reflected = fen.split(" ");
    reflected[0] = reflected[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    reflected[1] = "w";
    expect(
        classifyPositionTacticalMotifs({ fen: reflected.join(" "), pvUci: ["f3d4"] }).motifs[0],
    ).toMatchObject({ id: "discoveredAttack", ply: 1, value: 250 });
    const root = classifyPositionTacticalMotifs({ fen, pvUci: ["f6d5"] });
    const accepted = classifyPositionTacticalMotifs({
        fen,
        pvUci: ["f6d5", "d4c6", "d5f4", "c6d8", "f4e2", "g1h1", "f7f1"],
    });
    expect(accepted.motifs[0]).toEqual(root.motifs[0]);
    expect(root.motifs.some((m) => /^mateIn/.test(m.id))).toBe(false);
    expect(accepted.timeline?.some((m) => m.ply === 7 && /mate/i.test(m.id))).toBe(true);
});
test("the missed lesson and arrows explain the discovery, not a premature mating attack", () => {
    const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: "f6d5", pvUci: ["f6d5"] });
    expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
        source: "missed",
        primary: { id: "discoveredAttack", ply: 1 },
    });
    const scan = buildLiveTacticalScan({
        fen,
        pvUci: ["f6d5"],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.labels).toHaveLength(1);
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(
        expect.arrayContaining(["f6d5", "f7f4", "g7d4"]),
    );
    expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("f7f1");
});
test("taking the exposed discovery rook is compensation, not a hanging-rook mistake", () => {
    const pvUci = ["f6d5", "f4f7", "g7d4", "g1h1", "d5b4"];
    const result = classifyPositionTacticalMotifs({ fen, pvUci });
    expect(result.timeline?.find((m) => m.ply === 2 && m.id === "hangingPiece")?.label).toBe(
        "Countercapture",
    );
    expect(result.timeline?.find((m) => m.ply === 3)?.id).toBe("intermezzo");
    const after = makeFen(replayTacticalLine(fen, pvUci)[0].after.toSetup());
    expect(
        classifyPositionTacticalMotifs({
            fen: after,
            pvUci: pvUci.slice(1),
            previousFen: fen,
            previousMoveUci: pvUci[0],
        }).motifs.find((m) => m.id === "hangingPiece")?.label,
    ).toBe("Countercapture");
    // A mismatching previous board cannot borrow the discovery certificate.
    expect(
        classifyPositionTacticalMotifs({
            fen: after,
            pvUci: pvUci.slice(1),
            previousFen: fen.replace("1p3n2", "5n2"),
            previousMoveUci: pvUci[0],
        }).motifs.find((m) => m.id === "hangingPiece")?.label,
    ).not.toBe("Countercapture");
});
test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_SAMPLE)(
    "one intermediate discovered check is not two competing lessons",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: { id: string }) => r.id === "private-easy:105");
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        // The root preparation is now proved independently. The later
        // intermediate discovery still remains one lesson, not two badges.
        expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
        expect(result.timeline?.filter((m) => m.ply === 5).map((m) => m.id)).toEqual([
            "intermezzo",
        ]);
        expect(result.timeline?.find((m) => m.ply === 5)?.evidence).toContain(
            "uncovers check from the queen",
        );
    },
);
test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "the real discovery no longer stops at the incidental captured pawn",
    async () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        const row = sample.cases.find((row: { id: string }) => row.id === "private-easy:135");
        expect(row).toBeDefined();
        const step = replayTacticalLine(row.fen, row.sourceUci)[0];
        const leaves: unknown[] = [];
        expect(proveDiscoveredMaterial(step, 4096, 101, (leaf) => leaves.push(leaf))).toBe(250);
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.sourceUci[0]] }).motifs[0],
        ).toMatchObject({ id: "discoveredAttack", ply: 1, value: 250 });
        if (process.env.TACTICAL_DISCOVERY_LIABILITY_REPORT) {
            const { privateReportPath } =
                await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
            writeFileSync(
                privateReportPath(process.env.TACTICAL_DISCOVERY_LIABILITY_REPORT),
                JSON.stringify(
                    { fen: row.fen, rootUci: row.sourceUci[0], gain: 250, leaves },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
    },
);

test("keeping the defending knight lets it capture the mating checker", () => {
    const unguarded = fen.replace("1p3n2", "5n2");
    const steps = replayTacticalLine(unguarded, ["f6d5", "b4a5", "d5f4", "a5d8", "f4e2", "d4e2"]);
    expect(steps).toHaveLength(6);
    expect(proveMatingCaptureReply(steps[3])).toBeNull();
    expect(steps[5].san).toBe("Nxe2");
});
test("a king flight cannot be treated as the same forced back-rank mate", () => {
    const flight = fen.replace("/8/6PP/", "/7P/6P1/");
    const steps = replayTacticalLine(flight, ["f6d5", "d4c6", "d5f4", "c6d8", "f4e2", "g1h2"]);
    expect(steps).toHaveLength(6);
    expect(proveMatingCaptureReply(steps[3])).toBeNull();
});
test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "invalid or exhausted proof budgets cannot certify the root: %s",
    (limit) => {
        expect(
            proveDiscoveredMaterial(replayTacticalLine(fen, ["f6d5"])[0], limit, 101),
        ).toBeNull();
    },
);
test.each([0, -1, NaN, Infinity, 1.5])(
    "invalid gain requirements cannot reuse cached successes: %s",
    (gain) => {
        expect(
            proveDiscoveredMaterial(replayTacticalLine(fen, ["f6d5"])[0], 4096, gain),
        ).toBeNull();
    },
);
