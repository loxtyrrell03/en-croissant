import { describe, expect, test } from "vitest";
import {
    proveMateWithinThree,
    proveQuietMateThreat,
    replayTacticalLine,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

describe("quiet mating preparations", () => {
    test("recognizes Qh6 without waiting for a cooperative mating PV", () => {
        const fen = "7k/7p/5K2/7Q/8/8/8/8 w - - 0 1";
        const root = replayTacticalLine(fen, ["h5h6"])[0];
        expect(root.after.isCheck()).toBe(false);
        expect(proveQuietMateThreat(root)).toMatchObject({ threat: "Qg7#", replyCount: 1 });
        const result = classifyPositionTacticalMotifs({ fen, pvUci: ["h5h6"] });
        expect(result.motifs[0]).toMatchObject({ id: "mateThreat", ply: 1, value: 10000 });
        expect(result.motifs[0].evidence).toContain("Kg8 Qg7#");
    });

    test("withholds a claim when the local proof budget is exhausted", () => {
        const root = replayTacticalLine("7k/7p/5K2/7Q/8/8/8/8 w - - 0 1", ["h5h6"])[0];
        expect(proveQuietMateThreat(root, 0)).toBeNull();
    });

    test("checks every defence, not just the king move in the supplied line", () => {
        const fen = "7k/pp5p/5K2/7Q/8/8/8/8 w - - 0 1";
        const root = replayTacticalLine(fen, ["h5h6"])[0];
        expect(proveQuietMateThreat(root)).toMatchObject({ replyCount: 5 });
        const result = classifyPositionTacticalMotifs({ fen, pvUci: ["h5h6", "a7a6", "h6g7"] });
        expect(result.motifs[0].id).toBe("mateThreat");
        expect(result.timeline?.some((m) => m.ply === 3 && /mate/i.test(m.id))).toBe(true);
    });

    test.each([
        ["capturing the queen", "7k/7p/5K2/7Q/8/8/8/2b5 w - - 0 1", "c1h6"],
        ["a checking counterattack", "7k/7p/5K2/7Q/8/8/8/r7 w - - 0 1", "a1a6"],
    ])("rejects a cooperative mate line refuted by %s", (_name, fen, defence) => {
        expect(replayTacticalLine(fen, ["h5h6", defence])).toHaveLength(2);
        // This selected continuation really is mate, but another defence exists.
        expect(replayTacticalLine(fen, ["h5h6", "h8g8", "h6g7"]).at(-1)?.after.isCheckmate()).toBe(
            true,
        );
        const root = replayTacticalLine(fen, ["h5h6"])[0];
        expect(proveQuietMateThreat(root)).toBeNull();
        const result = classifyPositionTacticalMotifs({ fen, pvUci: ["h5h6", "h8g8", "h6g7"] });
        expect(result.motifs).toEqual([]);
    });

    test("does not certify a stalemate from an empty defence set", () => {
        const root = replayTacticalLine("7k/5K2/8/5Q2/8/8/8/8 w - - 0 1", ["f5g6"])[0];
        expect(root.after.isStalemate()).toBe(true);
        expect(proveQuietMateThreat(root)).toBeNull();
    });

    test("a poisoned pawn capture is not redeemed by a cooperative mating continuation", () => {
        const fen = "7k/8/5K1p/7Q/8/8/8/2b5 w - - 0 1";
        const pvUci = ["h5h6", "h8g8", "h6g7"];
        expect(replayTacticalLine(fen, pvUci).at(-1)?.after.isCheckmate()).toBe(true);
        expect(replayTacticalLine(fen, ["h5h6", "c1h6"])).toHaveLength(2);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs).toEqual([]);
    });

    test("recognizes a quiet black mating threat with the correct actor", () => {
        const result = classifyPositionTacticalMotifs({
            fen: "8/8/8/8/7q/5k2/7P/7K b - - 0 1",
            pvUci: ["h4h3"],
        });
        expect(result.motifs[0]).toMatchObject({ id: "mateThreat", ply: 1 });
        expect(result.timeline?.[0].actor).toBe("black");
        expect(result.motifs[0].evidence).toContain("legal White replies");
    });

    test("proves the extra quiet preparation move and keeps the mating payoff secondary", () => {
        const fen = "7k/7p/5Kp1/7Q/8/8/8/8 w - - 0 1";
        const pvUci = ["h5h2", "h7h5", "f6g6", "h8g8", "h2b8"];
        const steps = replayTacticalLine(fen, pvUci);
        expect(proveQuietMateThreat(steps[0])).toBeNull();
        expect(proveMateWithinThree(steps)).toMatchObject({ replyCount: 4 });
        expect(proveMateWithinThree(steps, 0)).toBeNull();
        const scan = buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Regression" });
        expect(scan.motifs[0]).toMatchObject({
            id: "mateIn3",
            label: "Mating Preparation",
            ply: 1,
        });
        expect(scan.labels).toHaveLength(1);
        expect(scan.arrows).toContainEqual(expect.objectContaining({ from: "h5", to: "h2" }));
        expect(scan.variations[0].timeline.some((m) => m.ply === 5 && /mate/i.test(m.id))).toBe(
            true,
        );
        const mistake = classifyMistakeReviewMotifs({
            fen,
            pvUci,
            bestMoveUci: "h5h2",
            playedMoveUci: "f6e5",
            refutationUci: ["g6h5"],
        });
        const explanation = buildMistakeReviewTacticalExplanation(mistake);
        expect(explanation?.source).toBe("missed");
        expect(explanation?.primary.id).toBe("mateIn3");
    });

    test("rejects a longer cooperative mate when a bishop has a checking defence", () => {
        const fen = "7k/7p/5Kp1/7Q/8/8/8/2b5 w - - 0 1";
        const pvUci = ["h5h2", "h7h5", "f6g6", "h8g8", "h2b8"];
        const steps = replayTacticalLine(fen, pvUci);
        expect(steps.at(-1)?.after.isCheckmate()).toBe(true);
        expect(replayTacticalLine(fen, ["h5h2", "c1g5"])[1].after.isCheck()).toBe(true);
        expect(proveMateWithinThree(steps)).toBeNull();
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs).toEqual([]);
    });

    test("does not blame a quiet mating threat on one move when it persists after both supplied moves", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "7k/pp5p/5K2/7Q/8/8/8/8 b - - 0 1",
            bestMoveUci: "a7a6",
            playedMoveUci: "b7b6",
            pvUci: ["a7a6"],
            refutationUci: ["h5h6", "h8g8", "h6g7"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({ id: "mateThreat", comparison: "persists" });
        expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain(
            "does not explain the difference",
        );
    });
});
