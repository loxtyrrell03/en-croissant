import { describe, expect, test } from "vitest";
import type { BestMoves, PlanExplorerLine, PlanExplorerPiece } from "@/bindings";
import {
    buildEnginePlanReport,
    type EnginePlan,
    type EnginePlanEvidence,
    type EnginePlanSetup,
} from "@/utils/enginePlanExplorer";
import {
    blendExpectedScores,
    cpToExpectedScore,
    DEFAULT_MOVE_STRENGTH_SETTINGS,
    getShrunkPracticalScore,
    type MoveStrengthSettings,
    wdlToExpectedScore,
} from "@/utils/moveStrength";
import {
    buildPlanStrengthByKey,
    computeEngineSetupStrength,
    getEngineEvidenceExpectedScore,
    planLineKey,
} from "@/utils/planStrength";

// White to move, a quiet position that supports a clean e4 pawn break.
const BREAK_FEN = "rnbqkbnr/ppp1pppp/8/3p4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function pv(rank: number, uciMoves: string[], cp: number, depth = 12): BestMoves {
    return {
        nodes: 1000,
        depth,
        score: { value: { type: "cp", value: cp }, wdl: null },
        uciMoves,
        sanMoves: uciMoves,
        multipv: rank,
        nps: 100000,
    };
}

function line(
    squares: string[],
    games: number,
    white: number,
    draw: number,
    black: number,
): PlanExplorerLine {
    return { squares, san: [], uci: [], games, white, draw, black };
}

function piece(
    color: string,
    role: string,
    from: string,
    row: PlanExplorerLine,
): PlanExplorerPiece {
    return { color, role, from, total: row.games, lines: [row] };
}

function settings(overrides: Partial<MoveStrengthSettings> = {}): MoveStrengthSettings {
    return { ...DEFAULT_MOVE_STRENGTH_SETTINGS, ...overrides };
}

function evidence(
    wdl: [number, number, number] | null,
    cp: number,
    rank = 1,
    completionPly: number | null = null,
): EnginePlanEvidence {
    return {
        rank,
        depth: 20,
        multipv: rank,
        score: { value: { type: "cp", value: cp }, wdl },
        evalCp: cp,
        qualityCp: cp,
        uciMoves: [],
        sanMoves: [],
        firstMove: "",
        completionPly,
        context: "rootChoice",
    };
}

function makePlan(overrides: Partial<EnginePlan> = {}): EnginePlan {
    return {
        signature: "pawn_setup:white:d4",
        category: "pawnSetup",
        label: "White plays d4",
        color: "white",
        origin: "pv",
        context: "rootChoice",
        approval: "Strong",
        confidence: "High",
        explanation: "",
        supportCount: 3,
        supportRatio: 1,
        appearsInTopPv: true,
        directSupportCount: 3,
        directSupportRatio: 1,
        directAppearsInTopPv: true,
        conditionalSupportCount: 0,
        conditionalSupportRatio: 0,
        conditionalAppearsInTopPv: false,
        evidence: [],
        bestEvalCp: 300,
        averageEvalCp: 300,
        weightedEvalCp: 300,
        bestQualityCp: 300,
        averageQualityCp: 300,
        weightedQualityCp: 300,
        bestCpLoss: 0,
        weightedCpLoss: 0,
        medianCompletionPly: 4,
        ...overrides,
    };
}

function makeSetup(overrides: Partial<EnginePlanSetup> = {}): EnginePlanSetup {
    return {
        signature: "white-setup",
        label: "White setup",
        archetype: null,
        color: "white",
        plans: [makePlan(), makePlan(), makePlan()],
        context: "rootChoice",
        approval: "Strong",
        confidence: "High",
        explanation: "",
        supportCount: 3,
        supportRatio: 1,
        appearsInTopPv: true,
        directSupportCount: 3,
        directSupportRatio: 1,
        directAppearsInTopPv: true,
        conditionalSupportCount: 0,
        conditionalSupportRatio: 0,
        conditionalAppearsInTopPv: false,
        evidence: [evidence(null, 300)],
        bestEvalCp: 300,
        averageEvalCp: 300,
        weightedEvalCp: 300,
        bestQualityCp: 300,
        averageQualityCp: 300,
        weightedQualityCp: 300,
        bestCpLoss: 0,
        weightedCpLoss: 0,
        medianCompletionPly: 6,
        ...overrides,
    };
}

describe("cpToExpectedScore", () => {
    test("maps an even eval to 0.5", () => {
        expect(cpToExpectedScore(0)).toBe(0.5);
    });

    test("is monotonically increasing in cp", () => {
        expect(cpToExpectedScore(200)).toBeGreaterThan(cpToExpectedScore(50));
        expect(cpToExpectedScore(50)).toBeGreaterThan(cpToExpectedScore(0));
        expect(cpToExpectedScore(0)).toBeGreaterThan(cpToExpectedScore(-50));
    });

    test("is symmetric around 0.5", () => {
        expect(cpToExpectedScore(150) + cpToExpectedScore(-150)).toBeCloseTo(1, 10);
        expect(cpToExpectedScore(320) + cpToExpectedScore(-320)).toBeCloseTo(1, 10);
    });
});

describe("wdlToExpectedScore", () => {
    test("converts UCI per-mille WDL triples", () => {
        expect(wdlToExpectedScore([1000, 0, 0])).toBe(1);
        expect(wdlToExpectedScore([0, 0, 1000])).toBe(0);
        expect(wdlToExpectedScore([0, 1000, 0])).toBe(0.5);
        expect(wdlToExpectedScore([250, 500, 250])).toBe(0.5);
        expect(wdlToExpectedScore([600, 300, 100])).toBeCloseTo(0.75, 10);
    });
});

describe("getEngineEvidenceExpectedScore", () => {
    test("orients white-relative WDL by owner colour, not side to move", () => {
        // White-relative WDL favouring black (black wins 300 > white wins 200).
        const source = { evidence: [evidence([200, 500, 300], -30)], bestEvalCp: -30 };
        // Black owner reverses the triple → (300 + 250) / 1000 = 0.55, not 0.45.
        expect(getEngineEvidenceExpectedScore(source, "black")).toBeCloseTo(0.55, 10);
        expect(getEngineEvidenceExpectedScore(source, "white")).toBeCloseTo(0.45, 10);
    });

    test("WDL and cp fallback paths orient the same way", () => {
        // A white-relative eval favouring black, once as a WDL line and once cp-only.
        const wdlSource = { evidence: [evidence([250, 400, 350], -100)], bestEvalCp: -100 };
        const cpSource = { evidence: [evidence(null, -100)], bestEvalCp: -100 };

        expect(getEngineEvidenceExpectedScore(wdlSource, "black")).toBeGreaterThan(0.5);
        expect(getEngineEvidenceExpectedScore(cpSource, "black")).toBeGreaterThan(0.5);
        expect(getEngineEvidenceExpectedScore(wdlSource, "white")).toBeLessThan(0.5);
        expect(getEngineEvidenceExpectedScore(cpSource, "white")).toBeLessThan(0.5);
    });
});

describe("getShrunkPracticalScore", () => {
    test("returns null when the raw score is null", () => {
        expect(getShrunkPracticalScore({ score: null, games: 100, baseline: 0.5 })).toBeNull();
    });

    test("pulls small samples strongly toward the baseline", () => {
        const shrunk = getShrunkPracticalScore({ score: 1, games: 2, baseline: 0.5 });
        expect(shrunk).not.toBeNull();
        // 2 games against a 24-game prior barely moves off the baseline.
        expect(shrunk as number).toBeLessThan(0.6);
        expect(shrunk as number).toBeGreaterThan(0.5);
    });

    test("barely moves large samples", () => {
        const shrunk = getShrunkPracticalScore({ score: 0.7, games: 2000, baseline: 0.5 });
        expect(shrunk as number).toBeCloseTo(0.7, 2);
    });

    test("falls back to a 0.5 baseline and returns it for zero games", () => {
        expect(getShrunkPracticalScore({ score: 0.8, games: 0, baseline: null })).toBe(0.5);
    });
});

describe("blendExpectedScores", () => {
    test("applies mode-specific engine weights", () => {
        const args = {
            engineExpected: 0.8,
            engineCpLoss: 0,
            hasEngine: true,
            practicalExpected: 0.4,
        };
        expect(
            blendExpectedScores({ ...args, settings: settings({ mode: "engine" }) }).expected,
        ).toBeCloseTo(0.85 * 0.8 + 0.15 * 0.4, 10);
        expect(
            blendExpectedScores({ ...args, settings: settings({ mode: "practical" }) }).expected,
        ).toBeCloseTo(0.15 * 0.8 + 0.85 * 0.4, 10);
        expect(
            blendExpectedScores({ ...args, settings: settings({ mode: "smart" }) }).expected,
        ).toBeCloseTo(0.55 * 0.8 + 0.45 * 0.4, 10);
    });

    test("keeps a pure-practical row unshrunk when the engine is not in use", () => {
        const blend = blendExpectedScores({
            settings: settings(),
            engineExpected: null,
            engineCpLoss: null,
            hasEngine: false,
            practicalExpected: 0.8,
        });
        expect(blend.engineMissing).toBe(false);
        expect(blend.expected).toBe(0.8);
        expect(blend.score).toBe(80);
    });

    test("missing engine shrinks toward neutral and flags engineMissing, not engineUnsafe", () => {
        const blend = blendExpectedScores({
            settings: settings(),
            engineExpected: null,
            engineCpLoss: null,
            hasEngine: true,
            practicalExpected: 0.8,
        });
        expect(blend.engineMissing).toBe(true);
        expect(blend.engineUnsafe).toBe(false);
        expect(blend.expected).toBeLessThan(0.8);
        expect(blend.expected).toBeGreaterThan(0.5);
        expect(blend.expected).toBeCloseTo(0.5 + (0.8 - 0.5) * 0.85, 10);
    });

    test("over-limit sets engineUnsafe as a gate without changing the score", () => {
        const base = {
            settings: settings({ mode: "engine" }),
            engineExpected: 0.7,
            hasEngine: true,
            practicalExpected: 0.6,
        };
        const under = blendExpectedScores({ ...base, engineCpLoss: 10 });
        const over = blendExpectedScores({ ...base, engineCpLoss: 100 });

        expect(under.engineUnsafe).toBe(false);
        expect(over.engineUnsafe).toBe(true);
        expect(over.score).toBe(under.score);
        expect(over.expected).toBeCloseTo(under.expected, 10);
    });
});

describe("buildPlanStrengthByKey", () => {
    test("shrinkage stops a 4-game 100% row outranking a 400-game 58% row", () => {
        const tinyPerfect = piece("white", "pawn", "e2", line(["e2", "e4"], 4, 4, 0, 0));
        const bigStrong = piece("white", "pawn", "d2", line(["d2", "d4"], 400, 200, 64, 136));
        // A large, sub-par row drags the games-weighted pool baseline down toward 0.5.
        const bigContext = piece("white", "knight", "g1", line(["g1", "f3"], 1000, 350, 100, 550));

        const strengthByKey = buildPlanStrengthByKey(
            [tinyPerfect, bigStrong, bigContext],
            null,
            "white",
            settings(),
        );

        const tiny = strengthByKey.get(planLineKey(tinyPerfect, tinyPerfect.lines[0]));
        const big = strengthByKey.get(planLineKey(bigStrong, bigStrong.lines[0]));
        expect(tiny).toBeDefined();
        expect(big).toBeDefined();
        expect((tiny as { score: number }).score).toBeLessThan((big as { score: number }).score);
    });

    test("no engine match flags engineMissing and ranks below an identical Strong-match row", () => {
        const report = buildEnginePlanReport(
            BREAK_FEN,
            [
                pv(1, ["e2e4", "d5e4"], 300),
                pv(2, ["e2e4", "e7e6"], 280),
                pv(3, ["g1f3", "g8f6"], 100),
            ],
            { requestedMultipv: 3, limitLabel: "Depth 12" },
        );
        const e4Break = report.plans.find((plan) => plan.signature === "pawn_break:white:e4");
        expect(e4Break?.approval).toBe("Strong");

        // Identical practical stats; only the routes differ (e4 matches, a3 does not).
        const matched = piece("white", "pawn", "e2", line(["e2", "e4"], 200, 100, 40, 60));
        const unmatched = piece("white", "pawn", "a2", line(["a2", "a3"], 200, 100, 40, 60));

        const strengthByKey = buildPlanStrengthByKey(
            [matched, unmatched],
            report,
            "white",
            settings(),
        );
        const matchedStrength = strengthByKey.get(planLineKey(matched, matched.lines[0]));
        const unmatchedStrength = strengthByKey.get(planLineKey(unmatched, unmatched.lines[0]));

        expect(matchedStrength?.engineMissing).toBe(false);
        expect(unmatchedStrength?.engineMissing).toBe(true);
        expect(unmatchedStrength?.engineUnsafe).toBe(false);
        expect((matchedStrength as { score: number }).score).toBeGreaterThan(
            (unmatchedStrength as { score: number }).score,
        );
    });
});

describe("computeEngineSetupStrength", () => {
    test("a full-support, early, fully PV-backed setup keeps nearly its full edge", () => {
        const setup = makeSetup({
            supportRatio: 1,
            plans: [makePlan(), makePlan(), makePlan()],
            medianCompletionPly: 6,
            bestEvalCp: 300,
            evidence: [evidence(null, 300)],
        });

        const strength = computeEngineSetupStrength({ setup, settings: settings() });
        if (!strength) throw new Error("expected a strength result");

        expect(strength.viableShare).toBe(1);
        expect(strength.pvBackedShare).toBe(1);
        expect(strength.earlyCompletion).toBe(1);
        expect(strength.realization).toBeCloseTo(1, 10);
        // realization 1 → the score is the owner edge, undiminished.
        expect(strength.ownerExpected).toBeCloseTo(cpToExpectedScore(300), 10);
        expect(strength.score).toBe(Math.round(strength.ownerExpected * 100));
    });

    test("thin, template-heavy, late-completing evidence lands much closer to 50", () => {
        const early = computeEngineSetupStrength({
            setup: makeSetup({
                supportRatio: 1,
                plans: [makePlan(), makePlan(), makePlan()],
                medianCompletionPly: 6,
                bestEvalCp: 300,
                evidence: [evidence(null, 300)],
            }),
            settings: settings(),
        });
        const thin = computeEngineSetupStrength({
            setup: makeSetup({
                supportRatio: 0.2,
                plans: [
                    makePlan({ origin: "template" }),
                    makePlan({ origin: "template" }),
                    makePlan({ origin: "template" }),
                    makePlan({ origin: "pv" }),
                ],
                medianCompletionPly: 24,
                bestEvalCp: 300,
                evidence: [evidence(null, 300)],
            }),
            settings: settings(),
        });
        if (!early || !thin) throw new Error("expected strength results");

        // Same owner edge, but weaker realization pulls the thin setup toward 0.5.
        expect(thin.ownerExpected).toBeCloseTo(early.ownerExpected, 10);
        expect(thin.pvBackedShare).toBeCloseTo(0.25, 10);
        expect(thin.earlyCompletion).toBe(0);
        expect(thin.realization).toBeLessThan(early.realization);
        expect(thin.score).toBeLessThan(early.score);
        expect(thin.score).toBeGreaterThan(50);
        expect(Math.abs(thin.score - 50)).toBeLessThan(Math.abs(early.score - 50));
    });

    test("a black-owned setup with white-favouring evidence scores below 50", () => {
        // Feed white-relative +cp evidence directly; the function orients by owner.
        const setup = makeSetup({
            color: "black",
            bestEvalCp: 300,
            evidence: [evidence(null, 300)],
            supportRatio: 1,
            plans: [makePlan(), makePlan(), makePlan()],
            medianCompletionPly: 6,
        });

        const strength = computeEngineSetupStrength({ setup, settings: settings() });
        if (!strength) throw new Error("expected a strength result");

        expect(strength.ownerExpected).toBeLessThan(0.5);
        expect(strength.score).toBeLessThan(50);
    });

    test("flags engineUnsafe when the setup cp-loss exceeds the configured limit", () => {
        const unsafe = computeEngineSetupStrength({
            setup: makeSetup({
                bestCpLoss: 200,
                weightedCpLoss: 200,
                plans: [makePlan({ bestCpLoss: 200, weightedCpLoss: 200 })],
            }),
            settings: settings(),
        });
        const safe = computeEngineSetupStrength({
            setup: makeSetup({
                bestCpLoss: 5,
                weightedCpLoss: 5,
                plans: [makePlan({ bestCpLoss: 5, weightedCpLoss: 5 })],
            }),
            settings: settings(),
        });
        if (!unsafe || !safe) throw new Error("expected strength results");

        expect(unsafe.engineCpLoss).not.toBeNull();
        expect(unsafe.engineCpLoss as number).toBeGreaterThan(settings().maxEngineCpLoss);
        expect(unsafe.engineUnsafe).toBe(true);
        expect(unsafe.detail).toContain("Over the configured CP-drop limit");

        expect(safe.engineUnsafe).toBe(false);
        expect(safe.detail).not.toContain("Over the configured CP-drop limit");
    });

    test("returns null when the evidence carries no usable eval", () => {
        const setup = makeSetup({ bestEvalCp: null, evidence: [evidence(null, 0)] });
        expect(computeEngineSetupStrength({ setup, settings: settings() })).toBeNull();
    });
});
