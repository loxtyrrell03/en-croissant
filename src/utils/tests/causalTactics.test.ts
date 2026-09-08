import { describe, expect, test } from "vitest";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";

const scan = (fen: string, pvUci: string[]) =>
    buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Regression" });

describe("causal tactical judgement", () => {
    test.each([
        [
            "a defended f7 sacrifice in the Italian",
            "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
            ["c4f7", "e8f7"],
        ],
        [
            "an unprotected f7 knight",
            "rnbqk2r/p1ppbppp/1p3n2/4N3/8/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
            ["e5f7", "e8f7"],
        ],
        [
            "a queen exchange, not a hanging queen",
            "3qk3/8/8/8/8/8/8/3QK3 w - - 0 1",
            ["d1d8", "e8d8"],
        ],
        [
            "a geometric fork whose knight can be captured",
            "3qkr2/5p2/8/6N1/8/8/8/4K3 w - - 0 1",
            ["g5e6", "f7e6"],
        ],
        [
            "an apparent fork truncated before its refutation",
            "3qkr2/5p2/8/6N1/8/8/8/4K3 w - - 0 1",
            ["g5e6"],
        ],
        [
            "ordinary development before a remote exchange",
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            [
                "d2d4",
                "g8f6",
                "c2c4",
                "e7e6",
                "g1f3",
                "d7d5",
                "c1g5",
                "f8e7",
                "e2e3",
                "h7h6",
                "g5f6",
                "e7f6",
            ],
        ],
    ] as const)("rejects %s", (_name, fen, line) => {
        expect(replayTacticalLine(fen, [...line])).toHaveLength(line.length);
        const result = scan(fen, [...line]);
        expect(result.motifs).toEqual([]);
        expect(result.labels).toEqual([]);
    });

    test("does not bridge across an illegal move", () => {
        const fen = "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1";
        expect(replayTacticalLine(fen, ["e1e5", "g8g1", "e5e8"])).toHaveLength(1);
        expect(scan(fen, ["e1e5", "g8g1", "e5e8"]).motifs).toEqual([]);
    });

    test("a queen capture that allows immediate mate is not a winning tactic", () => {
        const fen = "r5k1/5ppp/8/8/Q7/8/5PPP/4R1K1 b - - 0 1";
        const line = ["a8a4", "e1e8"];
        expect(replayTacticalLine(fen, line).at(-1)?.after.isCheckmate()).toBe(true);
        expect(scan(fen, line).motifs).toEqual([]);
    });

    test("a losing alternative cannot contribute a headline or board arrows", () => {
        const result = buildLiveTacticalScan({
            fen: "r5k1/5ppp/8/8/Q7/8/5PPP/6K1 b - - 0 1",
            pvUci: ["a8a4"],
            depth: 16,
            engineName: "Regression",
            variations: [
                { multipv: 1, pvUci: ["a8a4"], cp: 619 },
                { multipv: 2, pvUci: ["a8d8", "g2g4", "h7h6", "g1g2"], cp: -337 },
            ],
        });
        expect(result.motifs.map((m) => m.id)).toEqual(["hangingPiece"]);
        expect(result.variations).toHaveLength(1);
        expect(result.arrows).not.toContainEqual(expect.objectContaining({ from: "a8", to: "d8" }));
    });

    test("missing forced mate is the main lesson ahead of a smaller allowed loss", () => {
        const missed = classifyMistakeReviewMotifs({
            fen: "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
            bestMoveUci: "e1e8",
            pvUci: ["e1e8"],
        });
        const allowed = classifyMistakeReviewMotifs({
            fen: "4k3/8/7p/8/8/5N2/8/4K3 w - - 0 1",
            bestMoveUci: "e1f2",
            playedMoveUci: "f3g5",
            pvUci: ["e1f2"],
            refutationUci: ["h6g5"],
        });
        const explanation = buildMistakeReviewTacticalExplanation({
            allowedMotifs: allowed.allowedMotifs,
            missedMotifs: missed.missedMotifs,
        });
        expect(explanation?.primary.id).toBe("backRankMate");
        expect(explanation?.source).toBe("missed");
    });

    test("playing the best move is not a missed tactic", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
            bestMoveUci: "e1e8",
            playedMoveUci: "e1e8",
            pvUci: ["e1e8"],
        });
        expect(result.missedMotifs).toEqual([]);
    });
});
