import { describe, expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { observeDefensibleMateThreat, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { buildMistakeReviewTacticalExplanation, classifyPositionTacticalMotifs, isImmediateTacticalLesson } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { defensibleMateThreatFen as scholar } from "./fixtures/defensibleMateThreat";

describe("defensible mating threats are observations, not forced wins", () => {
    test("the real rare-theme root explains its immediate mate threat without inventing its longer trap proof", () => {
        const fen = "8/2pqnkpp/2b2p2/8/1P1P4/2P1R2P/1Q3PP1/rNB3K1 b - - 2 22";
        const result = classifyPositionTacticalMotifs({ fen, pvUci: ["d7d5", "f2f3"], rootCp: 500 });
        expect(result.motifs[0]).toMatchObject({ id: "matingThreat", value: 0, ply: 1 });
        expect(result.motifs[0].evidence).toContain("Qxg2#");
        expect(result.motifs[0].evidence).toContain("f3 (the displayed reply)");
        expect(result.motifs.some(m => m.id === "trappedPiece")).toBe(false);
    });
    test.each([false, true])("proves the actual threat and complete immediate defences (reflected %s)", reflected => {
        const fen = reflected ? reflectMixedForkFen(scholar) : scholar;
        const move = reflected ? reflectMixedForkMove("d1h5") : "d1h5";
        const root = replayTacticalLine(fen, [move])[0];
        const proof = observeDefensibleMateThreat(root)!;
        expect(proof).not.toBeNull();
        expect(makeUci(proof.threat)).toBe(reflected ? "h4f2" : "h5f7");
        expect(proof.defences.some(d => d.uci === (reflected ? "g2g3" : "g7g6"))).toBe(true);
        for (const defence of proof.defences) {
            const position = replayTacticalLine(fen, [move, defence.uci])[1].after;
            for (const [from, dests] of position.allDests()) for (const to of dests) {
                const next = position.clone(); next.play({ from, to });
                expect(next.isCheckmate()).toBe(false);
            }
        }
        const result = classifyPositionTacticalMotifs({ fen, pvUci: [move], rootCp: 0 });
        expect(result.motifs[0]).toMatchObject({ id: "matingThreat", label: "Threatens Mate", value: 0, ply: 1 });
        expect(result.motifs[0].evidence).toContain("not a claim of forced mate or material gain");
        expect(isImmediateTacticalLesson(result.motifs[0])).toBe(false);
        expect(observeDefensibleMateThreat(root, 1)).toBeNull();
    });

    test("requires engine relevance, and does not convert missing scores into zero", () => {
        for (const rootCp of [undefined, null, NaN, Infinity, -101])
            expect(classifyPositionTacticalMotifs({ fen: scholar, pvUci: ["d1h5"], rootCp }).motifs.some(m => m.id === "matingThreat")).toBe(false);
    });

    test("rejects a hanging queen even with an injected favourable score", () => {
        const fen = scholar.replace("2n5", "2n2n2").replace("kbnr", "kb1r");
        const root = replayTacticalLine(fen, ["d1h5"])[0];
        expect(replayTacticalLine(fen, ["d1h5", "f6h5"])).toHaveLength(2);
        expect(observeDefensibleMateThreat(root)).toBeNull();
        expect(classifyPositionTacticalMotifs({ fen, pvUci: ["d1h5"], rootCp: 900 }).motifs.some(m => m.id === "matingThreat")).toBe(false);
    });

    test("does not duplicate a pre-existing mate or a forced mate", () => {
        const existing = makeFen(replayTacticalLine(scholar, ["d1h5", "a7a6"])[1].after.toSetup());
        expect(observeDefensibleMateThreat(replayTacticalLine(existing, ["b1c3"])[0])).toBeNull();
        const forced = "7k/7p/5K2/7Q/8/8/8/8 w - - 0 1";
        expect(classifyPositionTacticalMotifs({ fen: forced, pvUci: ["h5h6"], rootCp: 900 }).motifs[0].id).toBe("mateThreat");
    });

    test("draw claims and ordinary development do not acquire the observation", () => {
        expect(observeDefensibleMateThreat(replayTacticalLine(scholar.replace("2 3", "99 3"), ["d1h5"])[0])).toBeNull();
        expect(observeDefensibleMateThreat(replayTacticalLine(scholar, ["b1c3"])[0])).toBeNull();
    });

    test("board arrows explain the threat without drawing a fictional defensive PV", () => {
        const scan = buildLiveTacticalScan({ fen: scholar, pvUci: ["d1h5", "g7g6", "h5f3"], engineName: "test", depth: 18,
            variations: [{ pvUci: ["d1h5", "g7g6", "h5f3"], cp: 0, depth: 18 }] });
        expect(scan.motifs[0]?.id).toBe("matingThreat");
        expect(scan.motifs[0].evidence).toContain("g6 (the displayed reply)");
        expect(scan.arrows.map(a => `${a.from}${a.to}`)).toEqual(["d1h5", "h5f7"]);
        expect(scan.labels[0]).toMatchObject({ text: "Threatens Mate", square: "h5" });
    });

    test("review keeps the observation neutral and behind a verified piece loss", () => {
        const motif = classifyPositionTacticalMotifs({ fen: scholar, pvUci: ["d1h5"], rootCp: 0 }).motifs[0];
        const missed = { ...motif, source: "missed" as const };
        const neutral = buildMistakeReviewTacticalExplanation({ allowedMotifs: [], missedMotifs: [missed] });
        expect(neutral?.title).toBe("Threat in the better line");
        expect(neutral?.text).not.toContain("You missed");
        const loss = { ...motif, id: "hangingPiece", label: "Hanging Piece", source: "allowed" as const,
            value: 900, comparison: "prevented" as const, evidence: "The queen can be taken." };
        expect(buildMistakeReviewTacticalExplanation({ allowedMotifs: [loss], missedMotifs: [missed] })?.primary.id).toBe("hangingPiece");
    });
});
