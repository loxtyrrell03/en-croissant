import { expect, test } from "vitest";
import {
    buildPracticeBotOptions,
    fideToLichessClassical,
    getPracticeBotGoMode,
    nearestLegacyMaiaModel,
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
