import { describe, expect, it } from "vitest";
import { gaussianLogConvolution } from "./performanceDynamics";
import { continuousLogSummary } from "./performanceNumerics";

describe("continuous chronological Gaussian convolution", () => {
    it.each([1e-10, .4, 3.696098562628337, 8100])("matches analytic Gaussian convolution at variance %s", variance => {
        const sd = 5.150752177980697;
        const xs = Array.from({ length: 1501 }, (_, i) => -1500 + 2 * i);
        const logs = xs.map(x => -.5 * (x / sd) ** 2);
        const result = gaussianLogConvolution(xs, logs, variance);
        const totalSd = Math.sqrt(sd * sd + variance);
        for (let i = 0; i < xs.length; i++) {
            const expected = -.5 * (xs[i] / totalSd) ** 2 + Math.log(sd / totalSd);
            expect(Math.abs(result.logs[i] - expected)).toBeLessThan(2e-8);
        }
        const summary = continuousLogSummary(xs, result.logs);
        expect(summary.mean).toBeCloseTo(0, 7);
        expect(summary.sd).toBeCloseTo(totalSd, 7);
        expect(summary.high).toBeCloseTo(1.959963984540054 * totalSd, 6);
    });

    it("retains distant Gaussian transition tails instead of clipping at eight standard deviations", () => {
        const xs = Array.from({ length: 1601 }, (_, i) => -8000 + 10 * i);
        const logs = xs.map(x => -.5 * (x / 50) ** 2);
        const result = gaussianLogConvolution(xs, logs, 90 ** 2);
        const i = xs.indexOf(4000), sd = Math.hypot(50, 90);
        expect(result.logs[i]).toBeCloseTo(-.5 * (4000 / sd) ** 2 + Math.log(50 / sd), 8);
        expect(Number.isFinite(result.logs[i])).toBe(true);
    });

    it("does not make elapsed-time partitions change a Gaussian posterior", () => {
        const xs = Array.from({ length: 201 }, (_, i) => -200 + 2 * i);
        const initial = xs.map(x => -.5 * (x / 5.15) ** 2);
        let split = initial;
        for (let i = 0; i < 20; i++) split = gaussianLogConvolution(xs, split, .2).logs;
        const whole = gaussianLogConvolution(xs, initial, 4).logs;
        expect(Math.max(...split.map((value, i) => Math.abs(value - whole[i])))).toBeLessThan(1e-7);
    });
});
