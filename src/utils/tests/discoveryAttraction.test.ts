import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveDiscoveryAttraction,
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "6k1/8/1qp5/5b2/Q1P1n3/2N5/1P3PP1/6K1 w - - 0 1";
test("a mobile knight is exchanged for a bishop that cannot capture the discovery pawn", () => {
    const root = replayTacticalLine(fen, ["c3e4"])[0],
        errors: string[] = [];
    expect(root).toBeDefined();
    expect({
        proof: proveDiscoveryAttraction(root, 16384, (r) => errors.push(r)),
        errors,
    }).toMatchObject({ proof: { gain: 220 }, errors: [] });
    expect(proveDiscoveryAttraction(root)!.accepted[0]).toMatchObject({
        reply: "Bxe4",
        preparation: "c5",
        priorDefence: "Nxc5",
    });
});
const line = ["c3e4", "f5e4", "c4c5", "b6c5", "a4e4"];
test("the root explains attraction and the discovery stays on its actual move", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs[0]).toMatchObject({ id: "attraction", ply: 1 });
    expect(result.motifs[0].evidence).toContain("Playing c5 first instead permits Nxc5");
    const discovery = result.timeline!.find((m) => m.id === "discoveredAttack" && m.ply === 3)!;
    expect(discovery).toBeDefined();
    expect(tacticalBoardEvidence(fen, line, result.motifs[0])).toEqual({
        square: "e4",
        arrows: [{ from: "f5", to: "e4" }],
    });
    expect(tacticalBoardEvidence(fen, line, discovery)?.arrows).toContainEqual({
        from: "a4",
        to: "e4",
    });
    expect(result.timeline?.some((m) => m.ply === 2 && m.label === "Winning Recapture")).toBe(
        false,
    );
    expect(classifyPositionTacticalMotifs({ fen, pvUci: line.slice(0, 1) }).motifs[0]?.id).toBe(
        "attraction",
    );
});
test("a queen defence can save both discovery targets when c6 is vacant", () => {
    const position = fen.replace("1qp5", "1q6");
    const steps = replayTacticalLine(position, ["c3e4", "f5e4", "c4c5", "b6c6", "a4e4"]);
    expect(steps).toHaveLength(5);
    expect(tacticalExchangeGain(steps[4].before, steps[4].move)).toBeLessThan(0);
    expect(proveDiscoveryAttraction(steps[0])).toBeNull();
});
test.each(["a4", "c4", "b6"])("missing support prevents certification: %s", (square) => {
    const pos = replayTacticalLine(fen, line)[0].before.clone();
    pos.board.take(parseSquare(square)!);
    const root = replayTacticalLine(makeFen(pos.toSetup()), [line[0]])[0];
    expect(root).toBeDefined();
    expect(proveDiscoveryAttraction(root)).toBeNull();
});
test("an unrelated pawn is not required for the same proof", () => {
    const pos = replayTacticalLine(fen, line)[0].before.clone();
    pos.board.take(parseSquare("g2")!);
    expect(
        proveDiscoveryAttraction(replayTacticalLine(makeFen(pos.toSetup()), [line[0]])[0])?.gain,
    ).toBe(220);
});
test("a checking acceptance cannot borrow an illegal quiet preparation", () => {
    const position = fen.replace("6K1 w", "1K6 w");
    const steps = replayTacticalLine(position, line.slice(0, 2));
    expect(steps).toHaveLength(2);
    expect(steps[1].after.isCheck()).toBe(true);
    expect(replayTacticalLine(position, line.slice(0, 3))).toHaveLength(2);
    expect(proveDiscoveryAttraction(steps[0])).toBeNull();
});
test("if the original bishop cannot capture c5, this exchange has no proved move-order necessity", () => {
    const pos = replayTacticalLine(fen, line)[0].before.clone();
    pos.board.set(parseSquare("e4")!, { color: "black", role: "bishop" });
    const root = replayTacticalLine(makeFen(pos.toSetup()), [line[0]])[0];
    expect(root).toBeDefined();
    expect(proveDiscoveryAttraction(root)).toBeNull();
});
test("a receiving knight retains the same escape and cannot be called attracted into the discovery", () => {
    const pos = replayTacticalLine(fen, line)[0].before.clone();
    pos.board.take(parseSquare("f5")!);
    pos.board.set(parseSquare("f6")!, { color: "black", role: "knight" });
    const root = replayTacticalLine(makeFen(pos.toSetup()), [line[0]])[0];
    expect(root).toBeDefined();
    expect(proveDiscoveryAttraction(root)).toBeNull();
});
test("an additional receiving defender must be checked too", () => {
    const pos = replayTacticalLine(fen, line)[0].before.clone();
    pos.board.set(parseSquare("g6")!, { color: "black", role: "bishop" });
    const root = replayTacticalLine(makeFen(pos.toSetup()), [line[0]])[0];
    expect(root).toBeDefined();
    expect(proveDiscoveryAttraction(root)).toBeNull();
});
test("an earlier defence is not a witness when it concedes another profitable capture", () => {
    const pos = replayTacticalLine(fen, line)[0].before.clone();
    pos.board.set(parseSquare("a3")!, { color: "black", role: "rook" });
    const root = replayTacticalLine(makeFen(pos.toSetup()), [line[0]])[0];
    expect(root).toBeDefined();
    expect(proveDiscoveryAttraction(root)).toBeNull();
});
test("equivalent colour-reflected moves retain the same attraction bound", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const reflected = line.map((move) =>
        move.replace(/[1-8]/g, (rank) => String(9 - Number(rank))),
    );
    expect(proveDiscoveryAttraction(replayTacticalLine(fields.join(" "), reflected)[0])?.gain).toBe(
        220,
    );
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: reflected }).motifs[0]?.id,
    ).toBe("attraction");
});
test("invalid and exhausted budgets cannot reuse a default-budget success", () => {
    const root = replayTacticalLine(fen, line)[0];
    expect(proveDiscoveryAttraction(root)).not.toBeNull();
    for (const limit of [0, -1, 1, 20, NaN, Infinity, 1.5])
        expect(proveDiscoveryAttraction(root, limit)).toBeNull();
    expect(proveDiscoveryAttraction(root)).not.toBeNull();
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "private exchange replaces a mobile knight with a discoverable bishop",
    () => {
        const row = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"),
        ).cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 58);
        const root = replayTacticalLine(row.fen, row.sourceUci)[0],
            errors: string[] = [];
        expect({
            proof: proveDiscoveryAttraction(root, 16384, (r) => errors.push(r)),
            errors,
        }).toMatchObject({ proof: { gain: 100 }, errors: [] });
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        expect(result.motifs[0]).toMatchObject({ id: "attraction", ply: 1 });
        expect(result.timeline).toContainEqual(
            expect.objectContaining({ id: "discoveredAttack", ply: 3 }),
        );
        expect(proveDiscoveryAttraction(root)!.accepted[0]).toMatchObject({
            gain: 130,
            priorDefence: "Nxc5",
        });
        expect(proveDiscoveryAttraction(root)!.declined).toContainEqual({
            reply: "Qe3",
            answer: "fxe3",
            gain: 900,
        });
    },
);
