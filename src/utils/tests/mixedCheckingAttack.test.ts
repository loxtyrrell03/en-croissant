import { expect, test } from "vitest";
import { proveMixedCheckingAttack, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { readFileSync } from "node:fs";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Constructed, not copied from the paid course. Bh3+ has king flights,
// interpositions and Rxh3. A single later fork does not explain all replies.
const fen = "2k4r/pp3p2/1np3q1/2Q3p1/P2R4/4P1P1/5PB1/6K1 w - - 0 1";
test("a checking offer can force different material or mating outcomes", () => {
    const step = replayTacticalLine(fen, ["g2h3"])[0];
    const proof = proveMixedCheckingAttack(step);
    expect(proof).not.toBeNull();
    expect(proof!.branches.map((b) => b.reply)).toContain("Rxh3");
    expect(proof!.branches.find((b) => b.reply === "Rxh3")!.gain).toBe(10000);
    expect(proof!.gain).toBeGreaterThanOrEqual(300);
});
test("a similar checking offer needing a quiet pawn preparation remains unproved", () => {
    const step = replayTacticalLine("2k4r/1p3p2/2p3q1/P1Q3p1/3R4/8/6B1/6K1 w - - 0 1", ["g2h3"])[0];
    expect(proveMixedCheckingAttack(step)).toBeNull();
});
test("a rook capture allowing a multi-check mate cannot become a material branch", () => {
    const position = "8/5r1k/4Npp1/8/3n4/4Q3/PP2q1P1/1KR5 w - - 0 1";
    const loss = replayTacticalLine(position, [
        "e3h6",
        "h7g8",
        "h6g6",
        "g8h8",
        "g6f7",
        "e2d3",
        "b1a1",
        "d4c2",
        "a1b1",
        "c2a3",
        "b1a1",
        "d3b1",
        "c1b1",
        "a3c2",
    ]);
    expect(loss).toHaveLength(14);
    expect(loss.at(-1)?.after.isCheckmate()).toBe(true);
    // Rh1+ wins instead. All-mating alternatives belong to the mate proof,
    // not a fabricated material concession after the losing Qxf7 choice.
    const win = replayTacticalLine(position, [
        "e3h6",
        "h7g8",
        "h6g6",
        "g8h8",
        "c1h1",
        "f7h7",
        "h1h7",
    ]);
    expect(win).toHaveLength(7);
    expect(win.at(-1)?.after.isCheckmate()).toBe(true);
    expect(proveMixedCheckingAttack(loss[0])).toBeNull();
});
test.each([
    ["missing rook support", fen.replace("P2R4", "P7")],
    ["missing queen", fen.replace("2Q3p1", "6p1")],
    ["rook blocks Qf8's checking route", fen.replace("2k4r", "2k1r2r")],
    ["bishop prevents the mating route", fen.replace("pp3p2", "pp2bp2")],
    ["an immediate pawn capture wins the knight already", fen.replace("2Q3p1/P2R4", "P1Q3p1/3R4")],
])("does not certify %s", (_name, position) => {
    const root = replayTacticalLine(position, ["g2h3"])[0];
    expect(root).toBeDefined();
    expect(proveMixedCheckingAttack(root)).toBeNull();
});
test.each([0, -1, 1, NaN, Infinity, 1.5])(
    "invalid or exhausted budget %s cannot borrow a cached proof",
    (limit) => {
        const root = replayTacticalLine(fen, ["g2h3"])[0];
        expect(proveMixedCheckingAttack(root)).not.toBeNull();
        expect(proveMixedCheckingAttack(root, limit)).toBeNull();
    },
);
test("every displayed witness is legally replayable and root defences are complete", () => {
    const root = replayTacticalLine(fen, ["g2h3"])[0];
    const proof = proveMixedCheckingAttack(root)!;
    expect(proof.branches).toHaveLength(
        [...root.after.allDests().values()].reduce((n, squares) => n + squares.size(), 0),
    );
    for (const branch of proof.branches) {
        const pos = root.after.clone();
        for (const san of [branch.reply, ...branch.line]) {
            const move = parseSan(pos, san);
            expect({ san, legal: Boolean(move) }).toMatchObject({ legal: true });
            pos.play(move!);
        }
        expect(branch.gain !== 10000 || pos.isCheckmate()).toBe(true);
    }
});
test("colour reflection retains the same root material bound", () => {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    const reflected = pos.clone();
    reflected.board.clear();
    for (const square of pos.board.occupied) {
        const piece = pos.board.get(square)!;
        reflected.board.set(square ^ 56, {
            ...piece,
            color: piece.color === "white" ? "black" : "white",
        });
    }
    reflected.turn = "black";
    expect(
        proveMixedCheckingAttack(replayTacticalLine(makeFen(reflected.toSetup()), ["g7h6"])[0])
            ?.gain,
    ).toBe(320);
});
test.each([["g2h3"], ["g2h3", "c8b8", "c5e5", "g6d6", "e5h8"]])(
    "the root, board and actual-ply timeline agree: %j",
    (...pvUci) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "forcingAttack", ply: 1 });
        expect(result.motifs[0].evidence).toContain("Rxh3");
        const scan = buildLiveTacticalScan({ fen, pvUci, engineName: "Test", depth: 16 });
        expect(scan.labels[0].text).toBe("Forcing Attack");
        expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["g2h3", "h3c8"]);
        expect(result.timeline?.some((m) => m.id === "fork" && m.ply === 3) ?? false).toBe(
            pvUci.length > 1,
        );
    },
);
test("missing this combination is a root missed opportunity, not a later fork", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "g2h3",
        playedMoveUci: "a4a5",
        pvUci: ["g2h3", "c8b8", "c5e5", "g6d6", "e5h8"],
    });
    expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
        "What you missed: Forcing Attack",
    );
});
test("taking the poisoned checking offer is not shown as a free bishop", () => {
    const result = classifyPositionTacticalMotifs({
        fen,
        pvUci: ["g2h3", "h8h3", "c5f8", "c8c7", "f8d8"],
    });
    expect(result.motifs[0]).toMatchObject({ id: "forcingAttack", ply: 1 });
    expect(result.timeline?.filter((m) => m.ply === 2 && m.id === "hangingPiece")).toEqual([]);
});
test.skipIf(!process.env.TACTICAL_PRIVATE_FOURTH_SAMPLE)(
    "the audited private source now explains its root",
    () => {
        const row = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_FOURTH_SAMPLE!, "utf8"),
        ).cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 184);
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs[0],
        ).toMatchObject({ id: "forcingAttack", ply: 1, value: 320 });
    },
);
