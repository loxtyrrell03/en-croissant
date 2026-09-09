import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    proveCaptureForkPreparation,
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
const constructed = "8/5pkp/6p1/2p5/2Rp4/3Q4/1q4PP/6BK w - - 0 1";

test("an offered rook removes the defender of a checking bishop fork", () => {
    const failures: string[] = [];
    const proof = proveCaptureForkPreparation(
        replayTacticalLine(constructed, ["c4d4"])[0],
        8192,
        (r) => failures.push(r),
    );
    expect(failures).toEqual([]);
    expect(proof).toMatchObject({
        gain: 100,
        branches: [
            {
                reply: "cxd4",
                answer: "Bxd4+",
                removedDefender: { premature: "Bxd4+", defence: "cxd4" },
            },
        ],
    });
    expect(
        classifyPositionTacticalMotifs({ fen: constructed, pvUci: ["c4d4"] }).motifs[0],
    ).toMatchObject({ id: "forkPreparation", value: 100 });
});

test("playing the checking fork immediately loses material to the actual defender", () => {
    const steps = replayTacticalLine(constructed, ["g1d4", "c5d4"]);
    expect(steps).toHaveLength(2);
    expect(tacticalExchangeGain(steps[0].before, steps[0].move)).toBe(-130);
    expect(
        classifyPositionTacticalMotifs({ fen: constructed, pvUci: ["g1d4"] }).motifs.some(
            (m) => m.id === "fork",
        ),
    ).toBe(false);
});

test("the queen acceptance is a profitable exchange, not a required second fork", () => {
    const root = replayTacticalLine(constructed, ["c4d4"])[0];
    expect(proveCaptureForkPreparation(root)?.otherCaptures).toEqual([
        { reply: "Qxd4", answer: "Bxd4+", gain: 270 },
    ]);
    const line = ["c4d4", "b2d4", "g1d4", "c5d4", "d3d4"];
    const steps = replayTacticalLine(constructed, line);
    expect(steps).toHaveLength(5);
    expect(steps[4].balance).toBe(270);
    expect(
        classifyPositionTacticalMotifs({ fen: constructed, pvUci: line }).motifs[0],
    ).toMatchObject({ id: "forkPreparation", value: 100 });
});

test("a missing forker cannot be replaced by an attractive sacrifice story", () => {
    const before = replayTacticalLine(constructed, ["c4d4"])[0].before;
    before.board.take(parseSquare("g1")!);
    expect(
        proveCaptureForkPreparation(replayTacticalLine(makeFen(before.toSetup()), ["c4d4"])[0]),
    ).toBeNull();
});

test("a second pawn defender still refutes the prepared checking fork", () => {
    const before = replayTacticalLine(constructed, ["c4d4"])[0].before;
    before.board.set(parseSquare("e5")!, { color: "black", role: "pawn" });
    const fen = makeFen(before.toSetup());
    expect(replayTacticalLine(fen, ["c4d4", "c5d4", "g1d4", "e5d4"])).toHaveLength(4);
    expect(proveCaptureForkPreparation(replayTacticalLine(fen, ["c4d4"])[0])).toBeNull();
});

test("without a material fork victim, a lone check does not prove preparation", () => {
    const before = replayTacticalLine(constructed, ["c4d4"])[0].before;
    before.board.take(parseSquare("b2")!);
    expect(
        proveCaptureForkPreparation(replayTacticalLine(makeFen(before.toSetup()), ["c4d4"])[0]),
    ).toBeNull();
});

test("a fork that already works must not invent a necessary rook sacrifice", () => {
    const before = replayTacticalLine(constructed, ["c4d4"])[0].before;
    before.board.take(parseSquare("c5")!);
    const fen = makeFen(before.toSetup());
    expect(proveCaptureForkPreparation(replayTacticalLine(fen, ["c4d4"])[0])).toBeNull();
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["g1d4"] }).motifs[0]?.id).toBe("fork");
});

test("a defender capture allowing immediate mate cannot prove the earlier fork was refuted", () => {
    const fen = "7R/4QBkp/6pp/2p5/2Rp4/8/1q4PP/6BK w - - 0 1";
    const line = replayTacticalLine(fen, ["g1d4", "c5d4", "h8g8"]);
    expect(line).toHaveLength(3);
    expect(line[2].after.isCheckmate()).toBe(true);
    const failures: string[] = [];
    expect(
        proveCaptureForkPreparation(replayTacticalLine(fen, ["c4d4"])[0], 8192, (r) =>
            failures.push(r),
        ),
    ).toBeNull();
    expect(failures).toContain("Unproved defence to the offered capture: cxd4");
});

test("invalid or exhausted preparation budgets remain bounded after success", () => {
    const root = replayTacticalLine(constructed, ["c4d4"])[0];
    expect(proveCaptureForkPreparation(root)).not.toBeNull();
    for (const limit of [0, -1, 1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
        expect(proveCaptureForkPreparation(root, limit)).toBeNull();
    expect(proveCaptureForkPreparation(root)).not.toBeNull();
});

test("the board labels preparation and only draws the offered capture", () => {
    const scan = buildLiveTacticalScan({
        fen: constructed,
        pvUci: ["c4d4"],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["c4d4"]);
    expect(scan.motifs[0].evidence).toContain("Playing Bxd4+ first");
    expect(scan.motifs[0].evidence).toContain("Taking with Qxd4");
});

test("the missed lesson explains the necessary move order", () => {
    const result = classifyMistakeReviewMotifs({
        fen: constructed,
        bestMoveUci: "c4d4",
        playedMoveUci: "g1d4",
        pvUci: ["c4d4"],
        refutationUci: ["c5d4"],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "forkPreparation", value: 100 });
    expect(result.missedMotifs[0].evidence).toContain("Playing Bxd4+ first");
});

test("colour reflection retains the preparation and its value", () => {
    const fields = constructed.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: ["c5d5"] }).motifs[0],
    ).toMatchObject({ id: "forkPreparation", value: 100 });
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "a real rook sacrifice removes the checking fork's defender",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 49);
        const failures: string[] = [];
        const proof = proveCaptureForkPreparation(
            replayTacticalLine(row.fen, row.sourceUci)[0],
            8192,
            (r) => failures.push(r),
        );
        expect(failures).toEqual([]);
        expect(proof).not.toBeNull();
        expect(proof).toMatchObject({
            gain: 100,
            branches: [
                {
                    reply: "cxd5",
                    answer: "Bxd5+",
                    removedDefender: { premature: "Bxd5+", defence: "cxd5" },
                },
            ],
            otherCaptures: [{ reply: "Qxd5", answer: "Bxd5+", gain: 270 }],
        });
        expect(proof?.declined.find((d) => d.reply === "Qb1+")).toEqual({
            reply: "Qb1+",
            answer: "Rxb1",
        });
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.sourceUci[0]] }).motifs[0],
        ).toMatchObject({ id: "forkPreparation", value: 100, ply: 1 });
    },
);
