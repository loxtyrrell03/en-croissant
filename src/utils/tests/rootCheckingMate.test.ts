import { expect, test } from "vitest";
import { proveShortCheckingMate, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";

const battery = "R2r2k1/p4ppp/1p6/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24";
const offer = "8/5r1k/4Npp1/8/3n4/4QP2/PP2q1P1/1KR5 w - - 0 1";
test.each([["e4e8"], ["e4e8", "d8e8", "f3d5"]])(
    "a forced battery mate outranks the supplied material line: %j",
    (...pvUci) => {
        expect(classifyPositionTacticalMotifs({ fen: battery, pvUci }).motifs[0]).toMatchObject({
            id: "mateIn2",
            ply: 1,
            label: "Forcing Mate",
        });
    },
);
test.each([["e3h6"], ["e3h6", "h7h6", "c1h1"]])(
    "a short mating branch does not limit the root's mate proof: %j",
    (...pvUci) => {
        expect(classifyPositionTacticalMotifs({ fen: offer, pvUci }).motifs[0]).toMatchObject({
            id: "mateIn3",
            ply: 1,
            label: "Forcing Mate",
        });
    },
);
test.each([0, -1, 1, NaN, Infinity, 1.5])(
    "invalid/exhausted budget %s cannot use a cached mate",
    (limit) => {
        const root = replayTacticalLine(battery, ["e4e8"])[0];
        expect(proveShortCheckingMate(root)?.maxMoves).toBe(2);
        expect(proveShortCheckingMate(root, limit)).toBeNull();
    },
);
test.each([
    [battery.replace("R2r2k1", "3r2k1"), "e4e8"],
    [battery.replace("p4ppp/1p6", "p4pp1/1p5p"), "e4e8"],
    [offer.replace("4QP2", "4Q3"), "e3h6"],
])("a missing mating resource is not repaired by the supplied PV: %s", (fen, move) => {
    expect(proveShortCheckingMate(replayTacticalLine(fen, [move])[0])).toBeNull();
});
test("the missing pawn allows an actual queen interposition", () => {
    const line = replayTacticalLine(offer.replace("4QP2", "4Q3"), ["e3h6", "h7h6", "c1h1", "e2h5"]);
    expect(line).toHaveLength(4);
    expect(line[2].after.isCheckmate()).toBe(false);
});
test("an existing immediate mate remains the actual terminal event", () => {
    const root = replayTacticalLine("6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1", ["e1e8"])[0];
    expect(root.after.isCheckmate()).toBe(true);
    expect(proveShortCheckingMate(root)).toBeNull();
});
test("the reported proof is legal and retains the longest defensive distance", () => {
    const root = replayTacticalLine(offer, ["e3h6"])[0];
    const proof = proveShortCheckingMate(root)!;
    const pos = root.before.clone();
    for (const san of proof.example) {
        const move = parseSan(pos, san);
        expect({ san, legal: Boolean(move) }).toMatchObject({ legal: true });
        pos.play(move!);
    }
    expect(proof.replyCount).toBe(2);
    expect(proof.maxMoves).toBe(3);
    expect(pos.isCheckmate()).toBe(true);
});
test("colour reflection preserves the short proof", () => {
    const pos = Chess.fromSetup(parseFen(offer).unwrap()).unwrap(),
        reflected = pos.clone();
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
        proveShortCheckingMate(replayTacticalLine(makeFen(reflected.toSetup()), ["e6h3"])[0])
            ?.maxMoves,
    ).toBe(3);
});
test("a missed root mate outranks the selected branch's shorter terminal pattern", () => {
    const result = classifyMistakeReviewMotifs({
        fen: offer,
        bestMoveUci: "e3h6",
        playedMoveUci: "a2a3",
        pvUci: ["e3h6", "h7h6", "c1h1"],
    });
    expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
        id: "mateIn3",
        ply: 1,
        source: "missed",
    });
    const scan = buildLiveTacticalScan({
        fen: offer,
        pvUci: ["e3h6"],
        depth: 16,
        engineName: "Test",
    });
    expect(scan.labels[0].text).toBe("Forcing Mate");
    expect(scan.motifs[0]).toMatchObject({ id: "mateIn3", ply: 1 });
});
