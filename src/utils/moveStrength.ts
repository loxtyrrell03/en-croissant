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

    return (score * total + safeBaseline * priorGames) / (total + priorGames);
}

export function evaluateMoveStrength({
    settings,
    engineCpLoss,
    hasEngineMoves,
    databaseWdlLoss,
}: {
    settings: MoveStrengthSettings;
    engineCpLoss: number | null;
    hasEngineMoves: boolean;
    databaseWdlLoss: number | null;
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
    });

    return {
        score: Math.round((1 - clampNumber(strengthLoss, 0, 1, 0)) * 100),
        loss: strengthLoss,
        engineUnsafe,
    };
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
}: {
    settings: MoveStrengthSettings;
    engineLossNorm: number;
    databaseLossNorm: number;
}) {
    if (settings.mode === "engine") {
        return engineLossNorm + databaseLossNorm * 0.12;
    }
    if (settings.mode === "practical") {
        return databaseLossNorm + engineLossNorm * 0.18;
    }

    const engineWeight = clampNumber(settings.engineWeight / 100, 0, 1, 0.55);
    return engineLossNorm * engineWeight + databaseLossNorm * (1 - engineWeight);
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
