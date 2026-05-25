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
              ? 0.55
              : 1.25
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
) {
    const total = opening.white + opening.draw + opening.black;
    if (total <= 0) return 0;

    const wins = side === "white" ? opening.white : opening.black;
    return (wins + opening.draw * 0.35) / total;
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

    return baseWeight * (1 - practicalTilt * 0.65);
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
