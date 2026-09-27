import { describe, test, expect } from "vitest";
import { calibratedRankProbabilities } from "../pairingCalibration";

describe("joint rank calibration", () => {
  test("is finite, monotone, and leaves an outside outcome at every interpolation", () => {
    for (const exact of [false, true]) for (const round of [1, 2, 9]) for (const fraction of [null, -1, 0, .01, .125, .25, .5, .75, .99, 1, 2]) {
      const values = calibratedRankProbabilities(exact, round, fraction);
      expect(values).toHaveLength(6);
      expect(values.every(value => Number.isFinite(value) && value > 0 && value < 1)).toBe(true);
      expect(values.reduce((a,b) => a+b,0)).toBeLessThan(1);
      expect(values.every((value,index) => index === 0 || value <= values[index-1])).toBe(true);
    }
  });
  test("distinguishes first-round ignorance and increasing result completeness", () => {
    for (const exact of [false,true]) {
      const first=calibratedRankProbabilities(exact,1,null);
      const before=calibratedRankProbabilities(exact,2,null);
      expect(first[0]).toBeLessThan(before[0]);
      let previous=0;
      for (const fraction of [0,.25,.5,.75,1]) {
        const p=calibratedRankProbabilities(exact,2,fraction)[0];
        expect(p).toBeGreaterThanOrEqual(previous);previous=p;
      }
      expect(calibratedRankProbabilities(exact,2,1)).toEqual(before);
    }
  });
});


test("small-field first-round recalibration does not change later or unvalidated large fields", () => {
  for (const exact of [false,true]) {
    const previous=calibratedRankProbabilities(exact,1,null);
    expect(calibratedRankProbabilities(exact,1,null,121)).toEqual(previous);
    expect(calibratedRankProbabilities(exact,1,null,0)).toEqual(previous);
    expect(calibratedRankProbabilities(exact,1,null,120)[0]).toBeGreaterThan(previous[0]);
    for(const size of [2,22,50,120]) {
      const p=calibratedRankProbabilities(exact,1,null,size);
      expect(p.every((v,i)=>v>0&&Number.isFinite(v)&&(i===0||v<=p[i-1]))).toBe(true);
      expect(p.reduce((a,b)=>a+b,0)).toBeLessThan(1);
    }
    for(const fraction of [null,0,.25,.5,.75,1]) expect(calibratedRankProbabilities(exact,2,fraction,50)).toEqual(calibratedRankProbabilities(exact,2,fraction));
  }
});

test("large fallback adjustment preserves first rounds, successful solves and small fields", () => {
  for (const size of [121,279,864,2000]) {
    expect(calibratedRankProbabilities(false,1,null,size)).toEqual(calibratedRankProbabilities(false,1,null));
    for (const fraction of [null,0,.01,.25,.49,.75,.99,1]) {
      expect(calibratedRankProbabilities(true,5,fraction,size)).toEqual(calibratedRankProbabilities(true,5,fraction));
      const values=calibratedRankProbabilities(false,5,fraction,size);
      expect(values.every((p,i)=>Number.isFinite(p)&&p>0&&(i===0||p<=values[i-1]))).toBe(true);
      expect(values.reduce((a,b)=>a+b,0)).toBeLessThan(1);
      expect(values[0]).toBeLessThan(calibratedRankProbabilities(false,5,fraction)[0]);
    }
  }
  for (const size of [2,60,120]) for (const fraction of [0,.25,.5,.75,1]) {
    expect(calibratedRankProbabilities(false,5,fraction,size)).toEqual(calibratedRankProbabilities(false,5,fraction));
  }
});

test("partial large fallback probabilities distinguish the selected player's known result", () => {
  for (const fraction of [.25, .5, .75]) {
    const known = calibratedRankProbabilities(false, 4, fraction, 241, true);
    const unknown = calibratedRankProbabilities(false, 4, fraction, 241, false);
    const previous = calibratedRankProbabilities(false, 4, fraction, 241);
    expect(known[0]).toBeGreaterThan(previous[0]);
    expect(unknown[0]).toBeLessThan(previous[0]);
    expect(fraction * known[0] + (1 - fraction) * unknown[0]).toBeCloseTo(previous[0], 12);
  }
  for (const own of [false, true]) for (const exact of [false, true]) {
    for (const fraction of [null, 0, 1]) {
      expect(calibratedRankProbabilities(exact, 5, fraction, 241, own))
        .toEqual(calibratedRankProbabilities(exact, 5, fraction, 241));
    }
    for (const fraction of [.01, .125, .25, .49, .5, .75, .99]) {
      expect(calibratedRankProbabilities(exact, 1, fraction, 241, own))
        .toEqual(calibratedRankProbabilities(exact, 1, fraction, 241));
      expect(calibratedRankProbabilities(exact, 5, fraction, 120, own))
        .toEqual(calibratedRankProbabilities(exact, 5, fraction, 120));
      if (exact) expect(calibratedRankProbabilities(exact, 5, fraction, 241, own))
        .toEqual(calibratedRankProbabilities(exact, 5, fraction, 241));
      const values = calibratedRankProbabilities(exact, 5, fraction, 241, own);
      expect(values.every((p, i) => Number.isFinite(p) && p > 0 && (i === 0 || p <= values[i - 1]))).toBe(true);
      expect(values.reduce((a, b) => a + b, 0)).toBeLessThan(1);
    }
  }
});
