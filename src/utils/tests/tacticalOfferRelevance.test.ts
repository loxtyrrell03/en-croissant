import { expect, test } from "vitest";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    auditTacticalMotifs,
    replayTacticalLine,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";

const fen = "5rk1/5q1p/8/8/8/3B1N2/8/6K1 w - - 0 1";
const pvUci = ["d3h7", "g8h7", "f3g5", "h7h8", "g5f7", "f8f7"];

test("a cooperative bishop-offer line cannot certify a sound sacrifice", () => {
    expect(replayTacticalLine(fen, pvUci)).toHaveLength(pvUci.length);
    const result = classifyPositionTacticalMotifs({ fen, pvUci });
    expect(result.motifs.some((m) => m.id === "sacrifice")).toBe(false);
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
    expect(result.timeline?.some((motif) => motif.id === "hangingPiece" && motif.ply === 2)).toBe(
        false,
    );
});

const position = "6k1/q7/8/8/8/r1P1R3/5B2/6K1 b - - 0 1";
const line = ["a3c3", "e3c3", "a7a1", "g1h2", "a1c3"];
const preparation = "5r1k/6pp/8/8/4n3/5NPQ/4Bq1P/4R2K b - - 0 1";
const preparationLine = ["f2e1", "f3e1", "e4f2", "h1g2", "f2h3", "e1f3", "f8f3", "e2f3", "h3g5"];

test("an unresolved preparation retains its actual later fork without inventing a primary", () => {
    const result = classifyPositionTacticalMotifs({ fen: preparation, pvUci: preparationLine });
    expect(result.motifs).toEqual([]);
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
    const scan = buildLiveTacticalScan({
        fen: preparation,
        pvUci: preparationLine,
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.motifs).toEqual([]);
    expect(scan.labels).toEqual([]);
    expect(scan.arrows).toEqual([]);
    expect(scan.variations[0].timeline).toContainEqual(
        expect.objectContaining({ id: "fork", ply: 3 }),
    );
    const review = classifyMistakeReviewMotifs({
        fen: preparation,
        bestMoveUci: preparationLine[0],
        pvUci: preparationLine,
        playedMoveUci: "h7h6",
    });
    expect(review.missedMotifs).toEqual([]);
    expect(review.missedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
    expect(buildMistakeReviewTacticalExplanation(review)).toBeNull();
});
test("a cooperative clearance line cannot certify compensation for the offered rook", () => {
    expect(replayTacticalLine(position, line)).toHaveLength(5);
    const defence = replayTacticalLine(position, ["a3c3", "e3c3", "a7a1", "f2e1", "a1e1"]);
    expect(defence).toHaveLength(5);
    expect(defence.at(-1)?.balance).toBe(-70);
    // This is only a short exchange total: Qxe1+ also attacks Rc3. The
    // independently engine-checked escape instead declines with Re8+.
    const countercheck = replayTacticalLine(position, [
        "a3c3",
        "e3e8",
        "g8f7",
        "f2a7",
        "c3c1",
        "g1g2",
    ]);
    expect(countercheck).toHaveLength(6);
    expect(countercheck[1].after.isCheck()).toBe(true);
    expect(countercheck[3].capture).toBe(900);
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: line });
    expect(result.motifs.some((m) => m.ply === 1)).toBe(false);
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
});

test("capturing the bishop with the queen avoids the king fork", () => {
    const defence = replayTacticalLine(fen, ["d3h7", "f7h7", "f3g5", "h7g6"]);
    expect(defence).toHaveLength(4);
    expect(defence.at(-1)?.balance).toBe(-230);
    const exchange = replayTacticalLine(fen, ["d3h7"])[0];
    expect(tacticalExchangeGain(exchange.before, exchange.move)).toBe(-230);
});

test.each([
    [fen, pvUci, "g1f1"],
    [position, line, "a3a4"],
] as const)(
    "review and live arrows cannot promote an unproved root offer: %s",
    (board, moves, played) => {
        const result = classifyMistakeReviewMotifs({
            fen: board,
            bestMoveUci: moves[0],
            playedMoveUci: played,
            pvUci: [...moves],
        });
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
            "Tactic in the better line",
        );
        expect(result.missedMotifs.some((m) => m.ply === 1)).toBe(false);
        const scan = buildLiveTacticalScan({
            fen: board,
            pvUci: [...moves],
            depth: 16,
            engineName: "Test",
        });
        expect(scan.labels[0]?.text).toBe("Later: Fork");
    },
);

test.each([
    [fen, pvUci],
    [position, line],
] as const)("colour reflection cannot rescue an unproved offer: %s", (board, moves) => {
    const original = Chess.fromSetup(parseFen(board).unwrap()).unwrap(),
        reflected = original.clone();
    reflected.board.clear();
    for (const square of original.board.occupied) {
        const piece = original.board.get(square)!;
        reflected.board.set(square ^ 56, {
            ...piece,
            color: piece.color === "white" ? "black" : "white",
        });
    }
    reflected.turn = original.turn === "white" ? "black" : "white";
    const mirrored = moves.map((uci) => uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank))));
    expect(
        classifyPositionTacticalMotifs({
            fen: makeFen(reflected.toSetup()),
            pvUci: mirrored,
        }).motifs.some((m) => m.ply === 1),
    ).toBe(false);
});

test("a genuine forced mating sacrifice retains compensation without borrowing a PV balance", () => {
    const board = "8/5r1k/4Npp1/8/3n4/4QP2/PP2q1P1/1KR5 w - - 0 1";
    const moves = ["e3h6"];
    const motifs = auditTacticalMotifs(board, moves, [
        {
            id: "sacrifice",
            label: "Sacrifice",
            source: "available",
            confidence: "medium",
            ply: 1,
            moveUci: moves[0],
            evidence: "Untrusted PV proposal",
        },
    ]);
    expect(motifs[0]).toMatchObject({ id: "mateIn3", ply: 1 });
    expect(motifs.find((m) => m.id === "sacrifice")).toMatchObject({
        value: 10000,
        evidence: expect.stringContaining("independently verified forced mating attack"),
    });
});
