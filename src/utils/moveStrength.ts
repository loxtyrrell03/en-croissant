export type MoveStrengthMode = "smart" | "engine" | "practical";

export type MoveStrengthSettings = {
    mode: MoveStrengthMode;
    engineWeight: number;
    maxEngineCpLoss: number;
};

export const DEFAULT_MOVE_STRENGTH_SETTINGS: MoveStrengthSettings = {
    mode: "smart",
    engineWeight: 55,
    maxEngineCpLoss: 70,
};

export const DATABASE_STRENGTH_FULL_STEP = 0.18;
export const ENGINE_CLUSTER_FULL_PRACTICAL_SPREAD_CP = 30;
const TINY_SAMPLE_USAGE_SHARE = 0.08;
const MISSING_ENGINE_SCORE_LOSS_NORM = 0.75;
const PRACTICAL_MISSING_ENGINE_SCORE_LOSS_NORM = 0.35;

export function normalizeMoveStrengthSettings(
    settings: Partial<MoveStrengthSettings> | null | undefined,
): MoveStrengthSettings {
    return {
        mode: isMoveStrengthMode(settings?.mode)
            ? settings.mode
            : DEFAULT_MOVE_STRENGTH_SETTINGS.mode,
        engineWeight: clampNumber(
            settings?.engineWeight,
            0,
            100,
            DEFAULT_MOVE_STRENGTH_SETTINGS.engineWeight,
        ),
        maxEngineCpLoss: clampInteger(
            settings?.maxEngineCpLoss,
            0,
            300,
            DEFAULT_MOVE_STRENGTH_SETTINGS.maxEngineCpLoss,
        ),
    };
}

export function getUsageAwarePracticalWdlRate({
    score,
    total,
    usageShare,
    baseline,
    mode,
}: {
    score: number | null;
    total: number;
    usageShare: number | null;
    baseline: number | null;
    mode: MoveStrengthMode;
}) {
    if (score === null || mode !== "smart" || total <= 0 || total > 2) return score;

    const safeBaseline = clampNumber(baseline, 0, 1, 0.5);
    const safeShare = clampNumber(usageShare, 0, 1, 0);
    const lowUsage = 1 - clampNumber(safeShare / TINY_SAMPLE_USAGE_SHARE, 0, 1, 0);
    const basePriorGames = total === 1 ? 24 : 16;
    const priorGames = basePriorGames + lowUsage * 16;
    const usageTrust = 1 - lowUsage;
    const maxTinySampleEdge = usageTrust * 0.006;
    const shrunkScore = (score * total + safeBaseline * priorGames) / (total + priorGames);

    return (
        safeBaseline +
        clampNumber(shrunkScore - safeBaseline, -maxTinySampleEdge, maxTinySampleEdge, 0)
    );
}

export function evaluateMoveStrength({
    settings,
    engineCpLoss,
    hasEngineMoves,
    databaseWdlLoss,
    engineScoreSpreadCp,
}: {
    settings: MoveStrengthSettings;
    engineCpLoss: number | null;
    hasEngineMoves: boolean;
    databaseWdlLoss: number | null;
    engineScoreSpreadCp?: number | null;
}) {
    const normalized = normalizeMoveStrengthSettings(settings);
    const maxEngineCpLoss = Math.max(1, normalized.maxEngineCpLoss);
    const engineUnsafe =
        hasEngineMoves &&
        (engineCpLoss === null ? normalized.mode !== "practical" : engineCpLoss > maxEngineCpLoss);
    const engineLossNorm = !hasEngineMoves
        ? 0
        : engineCpLoss === null
          ? normalized.mode === "practical"
              ? PRACTICAL_MISSING_ENGINE_SCORE_LOSS_NORM
              : MISSING_ENGINE_SCORE_LOSS_NORM
          : clampNumber(engineCpLoss / maxEngineCpLoss, 0, 1.5, 0);
    const databaseLossNorm =
        databaseWdlLoss === null
            ? 0.75
            : clampNumber(databaseWdlLoss / DATABASE_STRENGTH_FULL_STEP, 0, 1.5, 0);
    const strengthLoss = getMoveStrengthLoss({
        settings: normalized,
        engineLossNorm,
        databaseLossNorm,
        engineScoreSpreadCp,
    });

    return {
        score: Math.round((1 - clampNumber(strengthLoss, 0, 1, 0)) * 100),
        loss: strengthLoss,
        engineUnsafe,
    };
}

export function getEngineScoreSpreadCp(scores: (number | null | undefined)[], topCount = 4) {
    const sorted = scores
        .filter((score): score is number => typeof score === "number" && Number.isFinite(score))
        .sort((a, b) => b - a)
        .slice(0, topCount);
    if (sorted.length < 2) return null;

    return Math.max(...sorted) - Math.min(...sorted);
}

export function getPracticalWdlRate(
    opening: { white: number; draw: number; black: number },
    side: "white" | "black",
    drawWeight = 0.35,
) {
    const total = opening.white + opening.draw + opening.black;
    if (total <= 0) return 0;

    const wins = side === "white" ? opening.white : opening.black;
    return (wins + opening.draw * drawWeight) / total;
}

/**
 * Lichess logistic mapping from a WHITE-relative centipawn eval to an expected
 * score in [0, 1]. Callers convert perspective (owner black → 1 - value).
 */
export function cpToExpectedScore(cp: number): number {
    return 1 / (1 + Math.exp(-0.00368208 * cp));
}

/**
 * Engine UCI per-mille WDL triple [w, d, l] from the SIDE-TO-MOVE perspective to
 * an expected score in [0, 1].
 */
export function wdlToExpectedScore(wdl: [number, number, number]): number {
    const [w, d, l] = wdl;
    return (w + 0.5 * d) / Math.max(1, w + d + l);
}

export const PRACTICAL_SHRINKAGE_PRIOR_GAMES = 24;

/**
 * Shrinks a raw practical score toward a pool baseline using a fixed prior
 * sample size, so small-sample rows regress to the mean. Returns null when the
 * raw score is null.
 */
export function getShrunkPracticalScore({
    score,
    games,
    baseline,
    priorGames = PRACTICAL_SHRINKAGE_PRIOR_GAMES,
}: {
    score: number | null;
    games: number;
    baseline: number | null | undefined;
    priorGames?: number;
}): number | null {
    if (score === null) return null;

    const clampedBaseline = clampNumber(baseline, 0, 1, 0.5);
    const safeGames = Math.max(0, games);
    const denom = safeGames + priorGames;
    if (denom <= 0) return score;

    return (score * safeGames + clampedBaseline * priorGames) / denom;
}

/**
 * The engine share of the blend for a given mode: fixed 0.85 for engine mode and
 * 0.15 for practical mode; smart mode reuses the usage-aware smart tilt.
 */
export function getBlendEngineWeight(
    settings: MoveStrengthSettings,
    engineScoreSpreadCp?: number | null,
): number {
    const normalized = normalizeMoveStrengthSettings(settings);
    if (normalized.mode === "engine") return 0.85;
    if (normalized.mode === "practical") return 0.15;
    return getSmartMoveStrengthEngineWeight(normalized, engineScoreSpreadCp);
}

/**
 * Blends engine and practical expected scores (both in [0, 1]) into a single
 * 0..100 strength. engineUnsafe is a gate flag driven by cp-loss; it does not
 * zero the score. engineMissing marks rows with no usable engine evidence, which
 * shrink toward neutral so they rank below equally-scoring verified rows.
 */
export function blendExpectedScores({
    settings,
    engineExpected,
    engineCpLoss,
    hasEngine,
    practicalExpected,
    engineScoreSpreadCp,
    coverage = 1,
}: {
    settings: MoveStrengthSettings;
    engineExpected: number | null;
    engineCpLoss: number | null;
    hasEngine: boolean;
    practicalExpected: number | null;
    engineScoreSpreadCp?: number | null;
    coverage?: number;
}): { score: number; expected: number; engineUnsafe: boolean; engineMissing: boolean } {
    const normalized = normalizeMoveStrengthSettings(settings);
    const maxEngineCpLoss = Math.max(1, normalized.maxEngineCpLoss);
    const clampedCoverage = clampNumber(coverage, 0, 1, 1);
    const engineWeight = getBlendEngineWeight(normalized, engineScoreSpreadCp) * clampedCoverage;

    const engineMissing = hasEngine && engineExpected === null;
    const engineUnsafe = engineCpLoss !== null && engineCpLoss > maxEngineCpLoss;
    const enginePresent = hasEngine && engineExpected !== null;
    const practicalPresent = practicalExpected !== null;

    let expected: number;
    if (enginePresent && practicalPresent) {
        expected =
            engineWeight * (engineExpected as number) +
            (1 - engineWeight) * (practicalExpected as number);
    } else if (practicalPresent) {
        // engineMissing (engine ran but this row has no match) shrinks toward
        // neutral so it ranks below matched peers; a pure-practical row (engine
        // strength simply not in use) keeps its score unshrunk.
        expected = engineMissing
            ? 0.5 + ((practicalExpected as number) - 0.5) * 0.85
            : (practicalExpected as number);
    } else if (enginePresent) {
        expected = 0.5 + ((engineExpected as number) - 0.5) * 0.9;
    } else {
        expected = 0.5;
    }

    const clampedExpected = clampNumber(expected, 0, 1, 0.5);
    return {
        score: clampInteger(clampedExpected * 100, 0, 100, 50),
        expected: clampedExpected,
        engineUnsafe,
        engineMissing,
    };
}

function getMoveStrengthLoss({
    settings,
    engineLossNorm,
    databaseLossNorm,
    engineScoreSpreadCp,
}: {
    settings: MoveStrengthSettings;
    engineLossNorm: number;
    databaseLossNorm: number;
    engineScoreSpreadCp?: number | null;
}) {
    if (settings.mode === "engine") {
        return engineLossNorm + databaseLossNorm * 0.12;
    }
    if (settings.mode === "practical") {
        return databaseLossNorm + engineLossNorm * 0.18;
    }

    const engineWeight = getSmartMoveStrengthEngineWeight(settings, engineScoreSpreadCp);
    return engineLossNorm * engineWeight + databaseLossNorm * (1 - engineWeight);
}

export function getSmartMoveStrengthEngineWeight(
    settings: MoveStrengthSettings,
    engineScoreSpreadCp: number | null | undefined,
) {
    const baseWeight = clampNumber(settings.engineWeight / 100, 0, 1, 0.55);
    if (
        settings.mode !== "smart" ||
        engineScoreSpreadCp === null ||
        engineScoreSpreadCp === undefined
    ) {
        return baseWeight;
    }

    const fullPracticalSpread = ENGINE_CLUSTER_FULL_PRACTICAL_SPREAD_CP;
    const normalSpread = Math.max(fullPracticalSpread + 1, settings.maxEngineCpLoss);
    const practicalTilt =
        1 -
        clampNumber(
            (engineScoreSpreadCp - fullPracticalSpread) / (normalSpread - fullPracticalSpread),
            0,
            1,
            0,
        );

    return baseWeight * (1 - practicalTilt * 0.15);
}

function isMoveStrengthMode(value: unknown): value is MoveStrengthMode {
    return value === "smart" || value === "engine" || value === "practical";
}

function clampNumber(value: number | null | undefined, min: number, max: number, fallback: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function clampInteger(
    value: number | null | undefined,
    min: number,
    max: number,
    fallback: number,
) {
    return Math.round(clampNumber(value, min, max, fallback));
}
