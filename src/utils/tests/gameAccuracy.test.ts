import { expect, test } from "vitest";
import { accuracyWeights, gameAccuracy, moveAccuracy } from "../gameAccuracy";
import { getLichessGameAccuracy, getLichessJudgement } from "../score";
import reference from "./gameAccuracy-reference.json";

test.each(reference)("matches the independent decimal reference at $plies plies", ({ plies, white, black }) => {
    const cps = Array.from({ length: plies }, (_, i) => ((i * 97 + i * i * 13) % 1601) - 800);
    const result = getLichessGameAccuracy(cps, "white")!;
    expect(result.white).toBeCloseTo(white, 10);
    expect(result.black === null).toBe(black === null);
    expect(Math.abs((result.black ?? 0) - (black ?? 0))).toBeLessThan(1e-10);
});
test("the harmonic floor retains zero-accuracy moves and missing evidence is unavailable", () => {
    expect(moveAccuracy(1000, -1000, true)).toBe(0);
    expect(gameAccuracy([{ accuracy: 0, weight: 12 }])).toBe(.5);
    expect(gameAccuracy([{ accuracy: 0, weight: 1 }, { accuracy: 100, weight: 1 }])).toBeCloseTo(25.990099009901, 10);
    expect(getLichessGameAccuracy([-1000], "white", 1000)).toEqual({ white: .5, black: null });
    for (const values of [[], [NaN], [Infinity], [15, null, 15]]) expect(getLichessGameAccuracy(values, "white")).toBeNull();
    expect(getLichessGameAccuracy([15, 15], "white", null)).toBeNull();
});
test("each colour uses the same full-sequence volatility before selecting moves", () => {
    const cps = Array.from({ length: 80 }, (_, i) => i % 4 ? -400 : 400);
    const a = getLichessGameAccuracy(cps, "white", 800)!;
    const b = getLichessGameAccuracy(cps.map(cp => -cp), "black", -800)!;
    expect(a.white).toBeCloseTo(b.black!, 12); expect(a.black).toBeCloseTo(b.white!, 12);
    expect(new Set(accuracyWeights([15, ...cps]).slice(0, 7)).size).toBe(1);
    expect(accuracyWeights([])).toEqual([]);
});
test.each([700, 701, 999, 1000])("judgements preserve mate transitions at %i cp", value => {
    const cp = (value: number) => ({ type: "cp" as const, value });
    const mate = (value: number) => ({ type: "mate" as const, value });
    const expected = value > 999 ? "inaccuracy" : value > 700 ? "mistake" : "blunder";
    expect(getLichessJudgement(cp(-value), mate(-3), "white")).toBe(expected);
    expect(getLichessJudgement(mate(3), cp(value), "white")).toBe(expected);
    expect(getLichessJudgement(cp(value), mate(3), "black")).toBe(expected);
    expect(getLichessJudgement(mate(-3), cp(-value), "black")).toBe(expected);
    expect(getLichessJudgement(mate(3), mate(8), "white")).toBeNull();
});
