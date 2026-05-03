import { expect, test } from "vitest";
import {
    buildPracticeBotOptions,
    createDefaultPracticeBotOpponent,
    describePracticeBotBackend,
    fideToLichessClassical,
    getPracticeBotMoveDelay,
    getPracticeBotGoMode,
    maiaWeightsFileName,
    maiaWeightsUrl,
    nearestLegacyMaiaModel,
    practiceBotBackendKind,
    shouldUseClockTimeManagement,
    stockfishUciEloFromFide,
} from "../practiceBot";

test("maps FIDE ratings to the ChessDojo Lichess classical scale", () => {
    expect(fideToLichessClassical(1500)).toBe(1730);
    expect(fideToLichessClassical(2000)).toBe(2310);
    expect(fideToLichessClassical(2600)).toBeLessThanOrEqual(2600);
});

test("selects the nearest legacy Maia model for local Lc0 weights", () => {
    expect(nearestLegacyMaiaModel(1400)).toBe(1600);
    expect(nearestLegacyMaiaModel(1700)).toBe(1900);
});

test("adds Stockfish strength options for trainer bot games", () => {
    const options = buildPracticeBotOptions([{ name: "Threads", value: 2 }], {
        enabled: true,
        kind: "stockfish",
        fideElo: 1500,
    });

    expect(options).toContainEqual({ name: "Threads", value: "2" });
    expect(options).toContainEqual({ name: "UCI_LimitStrength", value: "true" });
    expect(options).toContainEqual({
        name: "UCI_Elo",
        value: stockfishUciEloFromFide(1500).toString(),
    });
});

test("uses calibrated Stockfish backend above legacy Maia range", () => {
    const profile = {
        enabled: true,
        kind: "maia" as const,
        fideElo: 2200,
    };

    expect(nearestLegacyMaiaModel(profile.fideElo)).toBe(1900);
    expect(practiceBotBackendKind(profile)).toBe("stockfish");
    expect(describePracticeBotBackend(profile)).toContain("Stockfish strength");

    const options = buildPracticeBotOptions([], profile);
    expect(options).toContainEqual({ name: "UCI_LimitStrength", value: "true" });
    expect(options).toContainEqual({ name: "UCI_Elo", value: "2200" });
});

test("keeps Maia for ratings inside the managed Maia range", () => {
    const profile = {
        enabled: true,
        kind: "maia" as const,
        fideElo: 1600,
    };

    expect(practiceBotBackendKind(profile)).toBe("maia");
    expect(describePracticeBotBackend(profile)).toContain("Maia 1800");
});

test("uses Maia policy-only search without UCI clock management", () => {
    const profile = {
        enabled: true,
        kind: "maia" as const,
        fideElo: 1600,
        maiaWeightsPath: "maia-1600.pb.gz",
    };

    expect(getPracticeBotGoMode(profile, { t: "Depth", c: 20 })).toEqual({ t: "Nodes", c: 1 });
    expect(shouldUseClockTimeManagement(profile)).toBe(false);
});

test("defaults trainer games to managed Maia without a user-selected engine", () => {
    const opponent = createDefaultPracticeBotOpponent();

    expect(opponent.type).toBe("engine");
    if (opponent.type !== "engine") return;
    expect(opponent.engine).toBeNull();
    expect(opponent.botProfile?.enabled).toBe(true);
    expect(opponent.botProfile?.kind).toBe("maia");
});

test("passes rating and time control into the backend clock model", () => {
    const moveDelay = getPracticeBotMoveDelay(
        {
            enabled: true,
            kind: "maia",
            fideElo: 1600,
        },
        {
            seconds: 300_000,
            increment: 5_000,
        },
    );

    expect(moveDelay).toMatchObject({
        fideElo: 1600,
        initialTimeMs: 300_000,
        incrementMs: 5_000,
        useAsMoveTime: false,
    });
});

test("builds managed Maia weights filenames and URLs", () => {
    expect(maiaWeightsFileName(1600)).toBe("maia-1600.pb.gz");
    expect(maiaWeightsUrl(1600)).toBe(
        "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1600.pb.gz",
    );
});
