import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import type { Square } from "chessops/types";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { probeKingPawnEndgame, proveKpkZugzwang } from "../tacticalMotifs/kpkBitbase";
import { replayTacticalLine, tacticalBoardEvidence } from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

// A standard reciprocal-opposition position. Kc6 holds the draw; Kd6 loses.
// White has spent its reserve pawn move: after Kc6 it can only move its king.
const fen = "8/2k5/8/8/2K5/2P5/8/8 b - - 0 1";
const move = "c7c6";

test("a defensive opposition move verifies draw versus win with a pass", () => {
    const after = replayTacticalLine(fen, [move])[0].after;
    expect(probeKingPawnEndgame(after)).toMatchObject({ pawnSide: "white", win: false });
    const passed = after.clone();
    passed.turn = "black";
    expect(probeKingPawnEndgame(passed)).toMatchObject({ pawnSide: "white", win: true });
    expect(proveKpkZugzwang(after)).toMatchObject({
        outcome: "draw",
        beneficiary: "black",
        defender: "white",
    });
});

test("drawing zugzwang is a first-move defensive lesson with honest board geometry", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: [move] });
    expect(result.motifs[0]).toMatchObject({
        id: "zugzwang",
        label: "Drawing Zugzwang",
        value: 0,
        ply: 1,
    });
    expect(result.motifs[0].evidence).toContain("would win if White could pass");
    expect(result.motifs[0].evidence).not.toContain("lose the pawn ending");
    expect(tacticalBoardEvidence(fen, [move], result.motifs[0])).toEqual({
        square: "c4",
        arrows: [{ from: "c7", to: "c6" }],
    });
});

test("missing the drawing opposition is retained without hiding the opponent's winning response", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: move,
        pvUci: [move],
        playedMoveUci: "c7d6",
        refutationUci: ["c4d4"],
    });
    expect(review.missedMotifs[0]).toMatchObject({
        id: "zugzwang",
        label: "Drawing Zugzwang",
        source: "missed",
    });
    expect(review.allowedMotifs[0]).toMatchObject({
        id: "zugzwang",
        comparison: "prevented",
        source: "allowed",
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary.source).toBe("allowed");
});

test("spending the reserve pawn move allows a drawing resource instead of retaining the win", () => {
    const review = classifyMistakeReviewMotifs({
        fen: "8/2k5/8/8/2K5/8/2P5/8 w - - 0 1",
        bestMoveUci: "c4b5",
        pvUci: ["c4b5"],
        playedMoveUci: "c2c3",
        refutationUci: [move],
    });
    expect(review.allowedMotifs[0]).toMatchObject({
        id: "zugzwang",
        label: "Drawing Zugzwang",
        comparison: "prevented",
    });
    expect(review.allowedMotifs[0].comparisonEvidence).toContain("retains a won");
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        source: "allowed",
        id: "zugzwang",
    });
});

test("a reserve pawn tempo prevents a false drawing zugzwang", () => {
    const position = Chess.fromSetup(parseFen("8/8/2k5/8/2K5/8/2P5/8 w - - 0 1").unwrap()).unwrap();
    expect(probeKingPawnEndgame(position)?.win).toBe(true);
    expect(proveKpkZugzwang(position)).toBeNull();
});

test("an unused en-passant square after a double push cannot invalidate exact KPK", () => {
    const step = replayTacticalLine("8/8/8/k7/8/K7/2P5/8 w - - 0 1", ["c2c4"])[0];
    expect(step.after.epSquare).toBeDefined();
    expect(probeKingPawnEndgame(step.after)).toMatchObject({ win: false });
    expect(proveKpkZugzwang(step.before)).toMatchObject({ outcome: "draw" });
    expect(proveKpkZugzwang(step.before)?.replies.map(makeUci)).toContain("c2c4");
});

test("an already drawn ending does not falsely accuse the move of giving up a win", () => {
    const review = classifyMistakeReviewMotifs({
        fen: "8/2k5/8/8/8/2PK4/8/8 w - - 0 1",
        bestMoveUci: "d3e3",
        pvUci: ["d3e3"],
        playedMoveUci: "d3c4",
        refutationUci: [move],
    });
    expect(review.allowedMotifs[0]).toMatchObject({ id: "zugzwang", comparison: "persists" });
    expect(buildMistakeReviewTacticalExplanation(review)?.title).toBe(
        "Tactical danger in the position",
    );
});

test.each([
    ["8/2k5/8/8/2K5/2P5/8/8 b - - 99 1", "c7c6"],
    ["8/8/8/8/8/8/1p6/k1K5 w - - 0 1", "c1c2"],
])("claimed-draw windows or non-zugzwang king moves abstain: %s", (position, uci) => {
    expect(replayTacticalLine(position, [uci])).toHaveLength(1);
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: [uci] }).motifs.some(
            (m) => m.id === "zugzwang",
        ),
    ).toBe(false);
});

const independent = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/drawing-zugzwang-tablebase-verified.json", "utf8"),
) as {
    selected: {
        id: string;
        beforeFen: string;
        fen: string;
        moveUci: string;
        expected: "draw" | "win" | null;
    }[];
    tablebase: {
        id: string;
        pass: boolean;
        expected: string;
        result: { category: string; moves: { uci: string; category: string }[] };
    }[];
};

test("the frozen independent tablebase receipt verifies the move sets and both counterfactual outcomes", () => {
    expect(independent.tablebase).toHaveLength(38);
    for (const row of independent.selected) {
        const actual = independent.tablebase.find((r) => r.id === row.id && !r.pass)!;
        const passed = independent.tablebase.find((r) => r.id === row.id && r.pass)!;
        expect(actual.result.category).toBe(actual.expected);
        expect(passed.result.category).toBe(passed.expected);
        const position = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
        const proof = proveKpkZugzwang(position);
        expect(proof?.outcome ?? null).toBe(row.expected);
        expect(proof?.replies.map(makeUci).sort() ?? null).toEqual(
            row.expected ? actual.result.moves.map((m) => m.uci).sort() : null,
        );
        expect(
            !row.expected ||
                actual.result.moves.every(
                    (m) => m.category === (row.expected === "draw" ? "draw" : "win"),
                ),
        ).toBe(true);
    }
});

for (const row of independent.selected)
    test.each([0, 7, 56, 63])(
        `the structurally selected ${row.id} preserves its judged lesson under reflection %i`,
        (flip) => {
            const setup = Chess.fromSetup(parseFen(row.beforeFen).unwrap()).unwrap().toSetup();
            const board = setup.board.clone();
            board.clear();
            for (const [square, piece] of setup.board)
                board.set((square ^ flip) as Square, {
                    ...piece,
                    color: flip & 56 ? (piece.color === "white" ? "black" : "white") : piece.color,
                });
            setup.board = board;
            if (flip & 56) setup.turn = setup.turn === "white" ? "black" : "white";
            const rootMove = parseUci(row.moveUci)!;
            if (!("from" in rootMove)) throw new Error("Expected king move");
            const uci = makeUci({
                from: (rootMove.from ^ flip) as Square,
                to: (rootMove.to ^ flip) as Square,
            });
            const result = classifyPositionTacticalMotifs({ fen: makeFen(setup), pvUci: [uci] });
            const expected =
                row.expected === "draw"
                    ? "Drawing Zugzwang"
                    : row.expected === "win"
                      ? "Zugzwang"
                      : null;
            expect(result.motifs.find((m) => m.id === "zugzwang")?.label ?? null).toBe(expected);
        },
    );
