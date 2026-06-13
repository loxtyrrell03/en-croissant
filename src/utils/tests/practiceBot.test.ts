import { expect, test } from "vitest";
import {
    buildPracticeBotOptions,
    createDefaultMaiaOpponent,
    createDefaultPracticeBotOpponent,
    describePracticeBotBackend,
    formatPracticeBotName,
    getPracticeBotMoveDelay,
    getPracticeBotGoMode,
    maiaLevelFromElo,
    patriciaSkillLevelElo,
    patriciaSkillLevelFromFide,
    patriciaTrainerEloFromFide,
    practiceBotEffectiveEloFromFide,
    practiceBotEstimatedSecondsPerMove,
    practiceBotTimeClass,
    practiceBotTimeControlQualityPenalty,
    practiceBotBackendKind,
    shouldUseClockTimeManagement,
} from "../practiceBot";

test("maps FIDE ratings directly into Patricia's supported trainer range", () => {
    expect(patriciaTrainerEloFromFide(1500)).toBe(1500);
    expect(patriciaTrainerEloFromFide(2800)).toBe(2800);
    expect(patriciaTrainerEloFromFide(3200)).toBe(3000);
    expect(patriciaTrainerEloFromFide(700)).toBe(800);
});

test("selects the nearest Patricia human-mode skill level", () => {
    expect(patriciaSkillLevelFromFide(1500)).toBe(7);
    expect(patriciaSkillLevelFromFide(2600)).toBe(18);
    expect(patriciaSkillLevelFromFide(2800)).toBe(19);
    expect(patriciaSkillLevelFromFide(3000)).toBe(20);
    expect(patriciaSkillLevelElo(20)).toBe(3000);
});

test("adds Patricia human-mode strength options for trainer games", () => {
    const options = buildPracticeBotOptions([{ name: "Threads", value: 2 }], {
        enabled: true,
        kind: "patricia",
        fideElo: 2200,
    });

    expect(options).toContainEqual({ name: "Threads", value: "2" });
    expect(options).toContainEqual({ name: "UCI_LimitStrength", value: "true" });
    expect(options).toContainEqual({ name: "UCI_Elo", value: "2200" });
    expect(options).toContainEqual({ name: "Skill_Level", value: "14" });
});

test("calibrates classical FIDE strength down by selected time control", () => {
    const bullet = { seconds: 60_000, increment: 0 };
    const blitz = { seconds: 180_000, increment: 2_000 };
    const rapid = { seconds: 900_000, increment: 10_000 };
    const classical = { seconds: 1_800_000, increment: 20_000 };

    expect(practiceBotTimeClass(bullet)).toBe("bullet");
    expect(practiceBotTimeClass(blitz)).toBe("blitz");
    expect(practiceBotTimeClass(rapid)).toBe("rapid");
    expect(practiceBotTimeClass(classical)).toBe("classical");
    expect(practiceBotEstimatedSecondsPerMove(blitz)).toBe(6.5);
    expect(practiceBotTimeControlQualityPenalty(2200, blitz)).toBeGreaterThan(200);
    expect(practiceBotEffectiveEloFromFide(2200, blitz)).toBeLessThan(
        practiceBotEffectiveEloFromFide(2200, rapid),
    );
    expect(practiceBotEffectiveEloFromFide(2200, classical)).toBe(2200);
});

test("passes time-control-calibrated strength options for trainer games", () => {
    const options = buildPracticeBotOptions(
        [{ name: "Threads", value: 2 }],
        {
            enabled: true,
            kind: "patricia",
            fideElo: 2200,
        },
        { seconds: 180_000, increment: 2_000 },
    );

    expect(options).toContainEqual({ name: "UCI_LimitStrength", value: "true" });
    expect(options).toContainEqual({ name: "UCI_Elo", value: "1946" });
    expect(options).toContainEqual({ name: "Skill_Level", value: "11" });
});

test("uses explicit Maia profiles on the Maia backend while legacy Stockfish stays Patricia", () => {
    const maiaProfile = {
        enabled: true,
        kind: "maia" as const,
        fideElo: 2400,
    };
    const stockfishProfile = {
        enabled: true,
        kind: "stockfish" as const,
        fideElo: 2400,
    };

    expect(practiceBotBackendKind(maiaProfile)).toBe("maia");
    expect(practiceBotBackendKind(stockfishProfile)).toBe("patricia");
    expect(describePracticeBotBackend(maiaProfile)).toContain("Maia human model");
    expect(maiaLevelFromElo(1450)).toBe(1400);
    expect(formatPracticeBotName(maiaProfile)).toBe("Maia 1900");
});

test("defaults blindfold Maia to a managed install path when no engine is selected", () => {
    const opponent = createDefaultMaiaOpponent(null, 1500);

    expect(opponent.type).toBe("engine");
    if (opponent.type !== "engine") return;
    expect(opponent.engine).toBeNull();
    expect(opponent.botProfile).toMatchObject({
        enabled: true,
        kind: "maia",
        fideElo: 1500,
    });
});

test("passes Maia weights through LC0 options without Patricia strength options", () => {
    const options = buildPracticeBotOptions(
        [
            { name: "Threads", value: 2 },
            { name: "MultiPV", value: 3 },
        ],
        {
            enabled: true,
            kind: "maia",
            fideElo: 1500,
            maiaWeightsPath: "C:/maia/maia-1500.pb.gz",
        },
    );

    expect(options).toContainEqual({ name: "Threads", value: "2" });
    expect(options).toContainEqual({
        name: "WeightsFile",
        value: "C:/maia/maia-1500.pb.gz",
    });
    expect(options).not.toContainEqual({ name: "UCI_LimitStrength", value: "true" });
    expect(options.find((option) => option.name === "MultiPV")).toBeUndefined();
});

test("uses Patricia movetime search without UCI clock management", () => {
    const profile = {
        enabled: true,
        kind: "patricia" as const,
        fideElo: 1600,
    };

    expect(getPracticeBotGoMode(profile, { t: "Depth", c: 20 })).toEqual({ t: "Time", c: 500 });
    expect(shouldUseClockTimeManagement(profile)).toBe(false);
});

test("defaults trainer games to managed Patricia without a user-selected engine", () => {
    const opponent = createDefaultPracticeBotOpponent();

    expect(opponent.type).toBe("engine");
    if (opponent.type !== "engine") return;
    expect(opponent.engine).toBeNull();
    expect(opponent.botProfile?.enabled).toBe(true);
    expect(opponent.botProfile?.kind).toBe("patricia");
});

test("passes rating and time control into the backend clock model", () => {
    const moveDelay = getPracticeBotMoveDelay(
        {
            enabled: true,
            kind: "patricia",
            fideElo: 1600,
        },
        {
            seconds: 300_000,
            increment: 5_000,
        },
    );

    expect(moveDelay).toMatchObject({
        fideElo: 1600,
        strengthElo: practiceBotEffectiveEloFromFide(1600, {
            seconds: 300_000,
            increment: 5_000,
        }),
        initialTimeMs: 300_000,
        incrementMs: 5_000,
        useAsMoveTime: true,
    });
});

test("formats trainer names with the clamped FIDE target", () => {
    expect(
        formatPracticeBotName({
            enabled: true,
            kind: "patricia",
            fideElo: 3200,
        }),
    ).toBe("Patricia 3000 FIDE");
});
