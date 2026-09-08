import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

const before = "rn3rk1/ppp1pq1p/3pNp2/5p2/2BP4/2N1P3/PPP2PPP/2KR3R w - - 4 13";
const fen = makeFen(replayTacticalLine(before, ["c4b3", "g8h8"])[1].after.toSetup());

test.each([["e6c7"], ["e6c7", "f7g7", "c7a8"]])(
    "a larger joint discovered attack leads over its smaller trapped-rook consequence: %j",
    (...pvUci) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "discoveredAttack", value: 600, ply: 1 });
        expect(result.motifs[0].evidence).toContain("bishop on b3 against the queen on f7");
        expect(result.motifs[0].evidence).toContain("knight on c7 also attacks the rook on a8");
        expect(result.motifs.some((m) => m.id === "trappedPiece" && m.ply === 1)).toBe(false);
    },
);

test("the live board explains both current threats without moving the pieces", () => {
    const result = buildLiveTacticalScan({
        fen,
        pvUci: ["e6c7"],
        depth: 16,
        engineName: "Regression",
    });
    expect(result.labels[0].text).toContain("Discovered Attack");
    expect(result.arrows.map((a) => a.from + a.to)).toEqual(
        expect.arrayContaining(["e6c7", "b3f7", "c7a8"]),
    );
});

test("checking discoveries do not add an incidental pawn attack to their explanation", () => {
    const position = "Q2b1rk1/p1p2ppp/1p1p4/3N2N1/7P/6PB/PPP1P3/2KR4 b - - 2 20";
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: ["d8g5"] });
    expect(result.motifs[0].id).toBe("discoveredAttack");
    expect(result.motifs[0].evidence).toContain("moving bishop gives check");
    expect(result.motifs[0].evidence).not.toContain("pawn on h4");
});

test("an equal-value discovery does not suppress the independently useful trap", () => {
    const result = classifyPositionTacticalMotifs({ fen: before, pvUci: ["e6c7"] });
    expect(result.motifs[0]).toMatchObject({ id: "trappedPiece", value: 270 });
});

test("the losing premature knight capture is not recommended as a tactical alternative", () => {
    const result = buildLiveTacticalScan({
        fen: before,
        pvUci: ["c4b3", "g8h8", "e6c7", "f7g7", "c7a8"],
        depth: 16,
        engineName: "Stockfish 18",
        variations: [
            { multipv: 1, cp: 135, pvUci: ["c4b3", "g8h8", "e6c7", "f7g7", "c7a8"] },
            { multipv: 2, cp: -372, pvUci: ["e6c7", "f7c4", "c7a8"] },
        ],
    });
    expect(result.variations.some((variation) => variation.lineUci[0] === "e6c7")).toBe(false);
});

test("removing the queen preserves the real rook trap without a phantom discovery", () => {
    const result = classifyPositionTacticalMotifs({
        fen: fen.replace("ppp1pq1p", "ppp1p2p"),
        pvUci: ["e6c7"],
    });
    expect(result.motifs[0].id).toBe("trappedPiece");
    expect(result.motifs.some((m) => m.id === "discoveredAttack")).toBe(false);
});

test("colour reflection preserves the combined attack and its two board targets", () => {
    const reflected = "2kr3r/ppp2ppp/1bn1p3/3p4/5P2/3PnP2/PPP1PQ1P/RN3R1K b - - 6 14";
    const reflectedBoard = fen
        .split(" ")[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-z]/gi, (piece) =>
            piece === piece.toLowerCase() ? piece.toUpperCase() : piece.toLowerCase(),
        );
    expect(reflected.split(" ")[0]).toBe(reflectedBoard);
    const result = classifyPositionTacticalMotifs({ fen: reflected, pvUci: ["e3c2"] });
    expect(result.motifs[0]).toMatchObject({ id: "discoveredAttack", value: 600 });
    expect(result.motifs[0].evidence).toContain("queen on f2");
    expect(result.motifs[0].evidence).toContain("rook on a1");
});

test("missing the stronger discovery teaches its mechanism instead of the smaller rook trap", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "e6c7",
        playedMoveUci: "e6f8",
        pvUci: ["e6c7", "f7g7", "c7a8"],
        refutationUci: ["f7f8"],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "discoveredAttack", value: 600 });
    expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
        id: "discoveredAttack",
        source: "missed",
    });
});
