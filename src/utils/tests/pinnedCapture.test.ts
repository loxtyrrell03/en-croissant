import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import { provePinnedCapture, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "8/4R1pk/5p2/8/8/8/1B6/6K1 w - - 0 1";

test("a pawn capture made profitable by a pinned defender explains the pin", () => {
    expect(provePinnedCapture(replayTacticalLine(fen, ["b2f6"])[0])).toMatchObject({
        gain: 100,
        victim: "pawn",
    });
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["b2f6"] });
    expect(result.motifs[0]).toMatchObject({ id: "pin", value: 200, ply: 1 });
});

test("moving the king out of the pin restores the legal recapture", () => {
    const position = "7k/4R1p1/5p2/8/8/8/1B6/6K1 w - - 0 1";
    expect(replayTacticalLine(position, ["b2f6", "g7f6"])).toHaveLength(2);
    expect(provePinnedCapture(replayTacticalLine(position, ["b2f6"])[0])).toBeNull();
});

test("winning a queen does not need an incidental pin to justify losing a bishop", () => {
    const position = fen.replace("5p2", "5q2");
    expect(provePinnedCapture(replayTacticalLine(position, ["b2f6"])[0])).toBeNull();
    expect(classifyPositionTacticalMotifs({ fen: position, pvUci: ["b2f6"] }).motifs[0]?.id).toBe(
        "hangingPiece",
    );
});

test("an already favourable supported pawn exchange cannot borrow the pin label", () => {
    const position = "8/4R1pk/5p2/4P3/8/8/8/5QK1 w - - 0 1";
    expect(provePinnedCapture(replayTacticalLine(position, ["e5f6"])[0])).toBeNull();
});

test("removing a pinner that also supports the recapture square cannot prove necessity", () => {
    const position = "4k3/4b3/8/8/7p/6B1/1K6/4Q3 w - - 0 1";
    expect(provePinnedCapture(replayTacticalLine(position, ["g3h4"])[0])).toBeNull();
});

test("the reflected capture has the same pin lesson and local value", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const result = classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: ["b7f3"] });
    expect(result.motifs[0]).toMatchObject({ id: "pin", value: 200, ply: 1 });
});

test("board evidence highlights the defender's pin rather than inventing an attack", () => {
    const scan = buildLiveTacticalScan({
        fen,
        pvUci: ["b2f6"],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(expect.arrayContaining(["b2f6", "e7h7"]));
});

test("the missed opportunity retains its pin lesson", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "b2f6",
        playedMoveUci: "b2a1",
        pvUci: ["b2f6"],
        refutationUci: [],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "pin", value: 200 });
});

test("a king move that restores a profitable recapture prevents the pin-based capture", () => {
    const before = fen.replace("4R1pk", "p3R1pk").replace(" w - ", " b - ");
    const result = classifyMistakeReviewMotifs({
        fen: before,
        playedMoveUci: "a7a6",
        bestMoveUci: "h7h8",
        pvUci: ["h7h8"],
        refutationUci: ["b2f6"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "pin", comparison: "prevented" });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("gxf6");
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "the private one-ply solution and fresh longer line share the capture's pin",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        const row = sample.cases.find((item: { id: string }) => item.id === "private-easy:68");
        expect(provePinnedCapture(replayTacticalLine(row.fen, row.sourceUci)[0])).toMatchObject({
            gain: 100,
        });
        const root = replayTacticalLine(row.fen, row.sourceUci)[0];
        for (const budget of [0, -1, NaN, Infinity, 1])
            expect(provePinnedCapture(root, budget)).toBeNull();
        expect(provePinnedCapture(root)?.gain).toBe(100);
        const absent = root.before.clone();
        absent.board.take(parseSquare("d7")!);
        expect(
            provePinnedCapture(replayTacticalLine(makeFen(absent.toSetup()), row.sourceUci)[0]),
        ).toBeNull();
        const defended = root.before.clone();
        defended.board.set(parseSquare("b8")!, { color: "black", role: "knight" });
        expect(
            provePinnedCapture(replayTacticalLine(makeFen(defended.toSetup()), row.sourceUci)[0]),
        ).toBeNull();
        for (const pvUci of [
            row.sourceUci,
            [...row.sourceUci, "d7e7", "f6e7", "d6d5", "e7d8", "d5d8"],
        ]) {
            const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
            expect(result.motifs[0]).toMatchObject({ id: "pin", value: 100, ply: 1 });
            expect(result.motifs[0].evidence).toContain("Rxf6");
            expect(result.motifs[0].evidence).toContain("Rxd7");
        }
    },
);
