import { describe, expect, it } from "vitest";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { comparePromotionMistake } from "../tacticalMotifs/decisionPromotionMistake";

const fen = "1r4k1/4nppp/p2P4/8/4B3/7P/1q3PP1/2RQ2K1 b - - 0 26";
const line = (fen: string, cp: number, moves: string, depth = 20): DecisionEngineLine => ({
    fen,
    cp,
    depth,
    pvUci: moves.split(" "),
});
const better = line(fen, -649, "b2f6 d6e7 f6e7 e4d5 b8d8 d1f3 g7g6 c1d1");
const played = line(fen, -982, "b8d8 d6e7 d8d1 c1d1 g7g6 e7e8q g8g7 e4a8 b2b5 e8e3");
const betterReply = line(
    "1r4k1/4nppp/p2P1q2/8/4B3/7P/5PP1/2RQ2K1 w - - 1 27",
    631,
    "d6e7 f6e7 d1f3 g7g6 e4d5 g8g7 c1c6 b8b1",
);
const playedReply = line(
    "3r2k1/4nppp/p2P4/8/4B3/7P/1q3PP1/2RQ2K1 w - - 1 27",
    1006,
    "d6e7 d8d1 c1d1 g7g6 e7e8q g8g7 e4d5 b2f6",
);

describe("promotion as a mistake consequence", () => {
    it("tracks the same pawn through a capture before it promotes in two searches", () => {
        const result = comparePromotionMistake(fen, better, played, betterReply, playedReply);
        expect(result?.tactical).toContain(
            "Rd8 allows the pawn from d6 to promote in both searches",
        );
        expect(result?.tactical).toContain("e8=Q+");
        expect(result?.positional).toBeUndefined();
        expect(result?.betterLineUci).toEqual(["b2f6", "d6e7", "f6e7"]);
        expect(result?.playedLineUci).toContain("e7e8q");
    });

    it("only attributes the promotion to the actual mistake", () => {
        const result = assessChessDecision({
            fen,
            candidates: [better, played],
            playedMoveUci: "b8d8",
            replyProbes: [
                { moveUci: "b2f6", lines: [betterReply] },
                { moveUci: "b8d8", lines: [playedReply] },
            ],
        });
        expect(result?.mistake?.promotion?.betterLineUci[0]).toBe("b2f6");
        expect(result?.mistake?.category).toBe("tactical");
        expect(result?.position.strategicPlan?.description ?? "").not.toContain("both searches");
    });

    it("abstains without a matching legal response from the exact played board", () => {
        expect(comparePromotionMistake(fen, better, played, betterReply, betterReply)).toBeNull();
        expect(
            comparePromotionMistake(fen, better, played, betterReply, {
                ...playedReply,
                pvUci: playedReply.pvUci.slice(0, 5),
            }),
        ).toBeNull();
    });

    it("abstains when the actual move is competitively scored", () => {
        expect(
            comparePromotionMistake(fen, better, { ...played, cp: -678 }, betterReply, playedReply),
        ).toBeNull();
    });

    it("shows the rook lost to the opposing pawn after the player's promotion exchanges", () => {
        const board = "5rk1/R2P1p2/5Bp1/6P1/8/7P/p1r5/3n2K1 w - - 2 52";
        const betterChoice = line(board, -650, "f6e7 c2d2 e7f8 g8f8 a7a2 d2d7 h3h4 d7d4 a2h2 d1e3");
        const actualChoice = line(
            board,
            -766,
            "d7d8q f8d8 f6d8 c2c1 d8f6 d1b2 g1f2 a2a1q a7a1 c1a1 f2e3",
        );
        const betterResponse = line(
            "5rk1/R2PBp2/6p1/6P1/8/7P/p1r5/3n2K1 b - - 3 52",
            618,
            "f8b8 e7d6 b8d8 d6e7 c2c7 a7a2 c7d7 e7d8 d7d8 h3h4",
        );
        const actualResponse = line(
            "3Q1rk1/R4p2/5Bp1/6P1/8/7P/p1r5/3n2K1 b - - 0 52",
            770,
            "f8d8 f6d8 c2c1 d8f6 d1b2 g1f2 a2a1q a7a1 c1a1 f2e3",
        );
        const result = comparePromotionMistake(
            board,
            betterChoice,
            actualChoice,
            betterResponse,
            actualResponse,
        );
        expect(result?.tactical).toContain("a1=Q Rxa1 Rxa1 trades the pawn for a rook");
        expect(result?.betterLineUci.at(-1)).toBe("a7a2");
        expect(result?.playedLineUci.slice(-3)).toEqual(["a2a1q", "a7a1", "c1a1"]);
    });
});
