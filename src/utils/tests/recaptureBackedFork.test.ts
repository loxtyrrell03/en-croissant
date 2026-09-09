import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    proveRecaptureBackedFork,
    replayTacticalLine,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
const constructed = "3r2qk/6pr/5p1P/8/4N3/2B5/5PPP/5RK1 w - - 0 1";

test("a pawn cannot take the fork without allowing a checking bishop recapture", () => {
    const failures: string[] = [];
    const proof = proveRecaptureBackedFork(
        replayTacticalLine(constructed, ["e4f6"])[0],
        8192,
        (r) => failures.push(r),
    );
    expect(failures).toEqual([]);
    expect(proof).toMatchObject({ gain: 270 });
    expect(proof?.recaptures).toEqual([
        expect.objectContaining({ reply: "gxf6", answer: "Bxf6+", continuation: ["Rg7", "Bxg7+"] }),
    ]);
    expect(
        classifyPositionTacticalMotifs({ fen: constructed, pvUci: ["e4f6"] }).motifs[0],
    ).toMatchObject({ id: "fork", value: 270 });
});

test("removing the checking recapturer leaves a genuinely loose knight", () => {
    const before = replayTacticalLine(constructed, ["e4f6"])[0].before;
    before.board.take(parseSquare("c3")!);
    const fen = makeFen(before.toSetup());
    expect(replayTacticalLine(fen, ["e4f6", "g7f6"])).toHaveLength(2);
    expect(proveRecaptureBackedFork(replayTacticalLine(fen, ["e4f6"])[0])).toBeNull();
});

test("an unprotected bishop can be captured after the rook interposes", () => {
    const before = replayTacticalLine(constructed, ["e4f6"])[0].before;
    before.board.take(parseSquare("h6")!);
    const fen = makeFen(before.toSetup());
    expect(replayTacticalLine(fen, ["e4f6", "g7f6", "c3f6", "h7g7", "f6g7", "h8g7"])).toHaveLength(
        6,
    );
    const steps = replayTacticalLine(fen, ["e4f6", "g7f6", "c3f6", "h7g7", "f6g7"]);
    expect(steps[3].balance + tacticalExchangeGain(steps[4].before, steps[4].move)).toBe(50);
    expect(proveRecaptureBackedFork(replayTacticalLine(fen, ["e4f6"])[0])).toBeNull();
});

test("a nonchecking recapture cannot borrow the checking continuation", () => {
    const before = replayTacticalLine(constructed, ["e4f6"])[0].before;
    before.board.take(parseSquare("h8")!);
    before.board.set(parseSquare("e8")!, { color: "black", role: "king" });
    const fen = makeFen(before.toSetup());
    expect(replayTacticalLine(fen, ["e4f6", "g7f6", "c3f6"])[2].after.isCheck()).toBe(false);
    expect(proveRecaptureBackedFork(replayTacticalLine(fen, ["e4f6"])[0])).toBeNull();
});

test("an absolutely pinned bishop cannot supply the recapture", () => {
    const before = replayTacticalLine(constructed, ["e4f6"])[0].before;
    before.board.take(parseSquare("g1")!);
    before.board.set(parseSquare("c1")!, { color: "white", role: "king" });
    before.board.set(parseSquare("c8")!, { color: "black", role: "rook" });
    const fen = makeFen(before.toSetup());
    expect(replayTacticalLine(fen, ["e4f6", "g7f6", "c3f6"])).toHaveLength(2);
    expect(proveRecaptureBackedFork(replayTacticalLine(fen, ["e4f6"])[0])).toBeNull();
});

test("invalid and exhausted budgets cannot inherit a cached certificate", () => {
    const root = replayTacticalLine(constructed, ["e4f6"])[0];
    expect(proveRecaptureBackedFork(root)).not.toBeNull();
    for (const budget of [0, -1, 1, NaN, Infinity, 1.1])
        expect(proveRecaptureBackedFork(root, budget)).toBeNull();
    expect(proveRecaptureBackedFork(root)).not.toBeNull();
});

test("an independently opened pawn ray does not replace the fork lesson", () => {
    const before = replayTacticalLine(constructed, ["e4f6"])[0].before;
    before.board.set(parseSquare("b1")!, { color: "white", role: "bishop" });
    before.board.set(parseSquare("f5")!, { color: "black", role: "pawn" });
    before.board.set(parseSquare("g6")!, { color: "black", role: "pawn" });
    const fen = makeFen(before.toSetup());
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["e4f6"] });
    expect(result.motifs[0]).toMatchObject({ id: "fork", value: 270 });
    expect(result.motifs.filter((m) => m.id === "discoveredAttack")).toEqual([]);
    expect(result.motifs[0].evidence).not.toContain("pawn on f5");
});

test("the root board shows the present fork, not its conditional recapture", () => {
    const scan = buildLiveTacticalScan({
        fen: constructed,
        pvUci: ["e4f6"],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(
        expect.arrayContaining(["e4f6", "f6g8", "f6h7"]),
    );
    expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("c3f6");
});

test("the missed opportunity keeps the fork and its defensive explanation", () => {
    const result = classifyMistakeReviewMotifs({
        fen: constructed,
        bestMoveUci: "e4f6",
        playedMoveUci: "h2h3",
        pvUci: ["e4f6"],
        refutationUci: [],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "fork", value: 270 });
    expect(result.missedMotifs[0].evidence).toContain("Bxf6+");
});

test("colour reflection preserves the fork's bounded material value", () => {
    const fields = constructed.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: ["e5f3"] }).motifs[0],
    ).toMatchObject({ id: "fork", value: 270 });
});

test("the conditional follow-up stays at its actual ply", () => {
    const result = classifyPositionTacticalMotifs({
        fen: constructed,
        pvUci: ["e4f6", "g7f6", "c3f6", "h7g7", "f6g7"],
    });
    expect(result.motifs[0]).toMatchObject({ id: "fork", ply: 1, value: 270 });
    expect(result.timeline?.find((m) => m.ply === 3 && m.id === "fork")).toBeDefined();
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "real fork survives a checking recapture",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 212);
        const failures: string[] = [];
        const proof = proveRecaptureBackedFork(
            replayTacticalLine(row.fen, row.sourceUci)[0],
            8192,
            (r) => failures.push(r),
        );
        expect(failures).toEqual([]);
        expect(proof).toMatchObject({ gain: 180 });
        expect(proof?.limitingDefence).toEqual({ reply: "Bxc8", answer: "Nxg1" });
        for (const pvUci of [[row.sourceUci[0]], row.sourceUci, ["e5f3", "g1f1", "f3e1", "d1e1"]]) {
            const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
            expect(result.motifs[0]).toMatchObject({ id: "fork", value: 180 });
            expect(result.motifs.some((m) => m.id === "discoveredAttack" && m.ply === 1)).toBe(
                false,
            );
        }
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            pvUci: [row.sourceUci[0]],
            depth: 16,
            engineName: "Private",
        });
        expect(scan.arrows.map((a) => a.from + a.to)).toEqual(
            expect.arrayContaining(["e5f3", "f3g1", "f3e1"]),
        );
        expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("c7h2");
        expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("c6f3");
        const source = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        expect(
            source.timeline
                ?.filter((m) => m.ply === 2)
                .some((m) => m.label === "Winning Recapture" || m.id === "hangingPiece"),
        ).toBe(false);
        const root = replayTacticalLine(row.fen, row.sourceUci)[0];
        const isolated = classifyPositionTacticalMotifs({
            fen: makeFen(root.after.toSetup()),
            pvUci: [row.sourceUci[1]],
            previousFen: row.fen,
            previousMoveUci: root.uci,
        });
        expect(
            isolated.motifs.some((m) => m.label === "Winning Recapture" || m.id === "hangingPiece"),
        ).toBe(false);
    },
);
