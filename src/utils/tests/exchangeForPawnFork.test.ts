import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { proveExchangeForPawnFork, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

// Constructed positions, not copies of a paid course. A pawn countercapture
// makes a major-piece fork profitable by less than the generic one-pawn gate.
const knight = "3qk2r/8/8/4N3/2BP4/8/PPP2PPP/R4RK1 w k - 0 1";
const bishop = "4k2r/8/8/6B1/6N1/2q4P/PPP2P2/R4RK1 w k - 0 1";

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "the private frozen fork retains its mating alternative and rejects real escapes",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        const row = sample.cases.find((item: { id: string }) => item.id === "private-easy:145");
        const step = replayTacticalLine(row.fen, row.sourceUci)[0];
        const proof = proveExchangeForPawnFork(step);
        expect(proof).toMatchObject({
            gain: 80,
            complete: true,
            defence: "Qxb6",
            matingDefences: expect.arrayContaining([expect.objectContaining({ defence: "Rxd3" })]),
        });
        for (const budget of [0, -1, NaN, Infinity, 1])
            expect(proveExchangeForPawnFork(step, budget)).toBeNull();
        expect(proveExchangeForPawnFork(step)).toEqual(proof);
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.sourceUci[0]] });
        expect(result.motifs[0]).toMatchObject({ id: "fork", value: 80, ply: 1 });
        expect(result.motifs[0].evidence).toContain("forced mate; for example");
        const defensiveLine = [
            step.uci,
            "d1d3",
            "e5a1",
            "d3d1",
            "a1d1",
            "b4e1",
            "d1e1",
            "f2f1",
            "e1f1",
        ];
        expect(replayTacticalLine(row.fen, defensiveLine)).toHaveLength(defensiveLine.length);
        const conditional = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: defensiveLine });
        expect(conditional.motifs[0]).toMatchObject({ id: "fork", value: 80, ply: 1 });
        expect(
            conditional.timeline?.some((motif) => motif.ply === 3 && motif.value === 10000),
        ).toBe(true);
        expect(conditional.motifs.some((motif) => motif.ply === 1 && motif.value === 10000)).toBe(
            false,
        );
        const noQueen = step.before.clone();
        noQueen.board.take(parseSquare("e5")!);
        expect(
            proveExchangeForPawnFork(replayTacticalLine(makeFen(noQueen.toSetup()), [step.uci])[0]),
        ).toBeNull();
        const luft = step.before.clone();
        const pawn = luft.board.take(parseSquare("h2")!)!;
        luft.board.set(parseSquare("h3")!, pawn);
        expect(
            proveExchangeForPawnFork(replayTacticalLine(makeFen(luft.toSetup()), [step.uci])[0]),
        ).toBeNull();
    },
);

test.each([
    [knight, "e5f7", 80, "Qxd4"],
    [bishop, "g5f6", 70, "Qxh3"],
] as const)(
    "a complete major-piece fork keeps its exchange-for-pawn value",
    (fen, root, gain, defence) => {
        const step = replayTacticalLine(fen, [root])[0];
        expect(proveExchangeForPawnFork(step)).toMatchObject({ gain, defence, complete: true });
        const result = classifyPositionTacticalMotifs({ fen, pvUci: [root] });
        expect(result.motifs[0]).toMatchObject({ id: "fork", ply: 1, value: gain });
    },
);

test("the actual recapture line has only an 80 cp local balance", () => {
    const steps = replayTacticalLine(knight, ["e5f7", "d8d4", "f7h8", "d4h8"]);
    expect(steps).toHaveLength(4);
    expect(steps[3].balance).toBe(80);
});

test("a checking queen countercapture refutes the immediate fork", () => {
    const fen = knight.replace("PPP2PPP", "PPP3PP");
    const steps = replayTacticalLine(fen, ["e5f7", "d8d4"]);
    expect(steps[1].san).toBe("Qxd4+");
    expect(proveExchangeForPawnFork(steps[0])).toBeNull();
});

test("conceding a knight instead of a pawn cannot borrow the rook's gross value", () => {
    const fen = knight.replace("2BP4", "2BN4");
    expect(proveExchangeForPawnFork(replayTacticalLine(fen, ["e5f7"])[0])).toBeNull();
});

test("a minor-piece target cannot use the exchange-for-pawn exception", () => {
    const fen = knight.replace("3qk2r", "3qk2b").replace(" w k ", " w - ");
    expect(proveExchangeForPawnFork(replayTacticalLine(fen, ["e5f7"])[0])).toBeNull();
});

test("the live board shows the two actual fork targets", () => {
    const scan = buildLiveTacticalScan({
        fen: knight,
        pvUci: ["e5f7"],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.motifs[0]).toMatchObject({ id: "fork", value: 80 });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(
        expect.arrayContaining(["e5f7", "f7d8", "f7h8"]),
    );
});

test("mistake review retains the missed fork rather than dropping its smaller net gain", () => {
    const result = classifyMistakeReviewMotifs({
        fen: knight,
        playedMoveUci: "e5d3",
        bestMoveUci: "e5f7",
        pvUci: ["e5f7", "d8d4", "f7h8", "d4h8"],
        refutationUci: [],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "fork", value: 80 });
});

test("an unchanged exchange-for-pawn fork is existing danger, not a newly created tactic", () => {
    const result = classifyMistakeReviewMotifs({
        fen: knight.replace(" w k ", " b k "),
        playedMoveUci: "e8e7",
        bestMoveUci: "e8f8",
        pvUci: ["e8f8", "e5f7", "d8d4", "f7h8", "d4h8"],
        refutationUci: ["e5f7", "d8d4", "f7h8", "d4h8"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "fork",
        value: 80,
        comparison: "persists",
    });
});

test("a larger independently proved interference remains ahead of its smaller fork route", () => {
    const fen = bishop.replace("PPP2P2", "PPP2PP1");
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["g5f6"] });
    expect(result.motifs[0]).toMatchObject({ id: "interference", value: 400 });
});

test.each([
    [knight, "e5f7", 80],
    [bishop, "g5f6", 70],
] as const)("colour reflection preserves the exchange fork", (fen, root, value) => {
    const swap = (value: string) =>
        value.replace(/[a-zA-Z]/g, (c) =>
            c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
        );
    const fields = fen.split(" ");
    fields[0] = swap(fields[0].split("/").reverse().join("/"));
    fields[1] = "b";
    fields[2] = swap(fields[2]);
    const move = root.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
    const result = classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: [move] });
    expect(result.motifs[0]).toMatchObject({ id: "fork", value, ply: 1 });
});
