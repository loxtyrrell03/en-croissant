/*!
Performance numerical helper: normal-tail rational coefficient adaptation

Upstream: SciPy xsf, include/xsf/cephes/ndtr.h
Revision: 8400c4928b83d8d6ee0228807bb24a435216e281
https://github.com/scipy/xsf/blob/8400c4928b83d8d6ee0228807bb24a435216e281/include/xsf/cephes/ndtr.h
https://github.com/scipy/xsf/blob/8400c4928b83d8d6ee0228807bb24a435216e281/LICENSE

The upstream source retains the following original notice:
Cephes Math Library Release 2.2: June, 1992
Copyright 1984, 1987, 1988, 1992 by Stephen L. Moshier

The upstream header was translated into C++ by SciPy developers in 2024.
The normal-tail rational coefficients and evaluation structure are adapted
here to TypeScript. The following upstream license applies to that material.

BSD 3-Clause License

Copyright (c) 2024, SciPy

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
import { normalQuadrature } from "./performanceNumerics";

const GH5 = [[-2.8569700138728056, -1.3556261799742657, 0, 1.3556261799742657, 2.8569700138728056],
    [.011257411327720656, .2220759220056126, .5333333333333334, .2220759220056126, .011257411327720656]] as const;
const GH9 = [[-4.512745863399783, -3.20542900285647, -2.07684797867783, -1.0232556637891326, 0,
    1.0232556637891326, 2.07684797867783, 3.20542900285647, 4.512745863399783],
    [.00002234584400774642, .0027891413212317562, .04991640676521775, .24409750289493948, .4063492063492066,
        .24409750289493948, .04991640676521775, .0027891413212317562, .00002234584400774642]] as const;
const GH3 = [[-Math.sqrt(3), 0, Math.sqrt(3)], [1 / 6, 2 / 3, 1 / 6]] as const;
const GLX = [-.9602898564975363, -.7966664774136267, -.525532409916329, -.1834346424956498,
    .1834346424956498, .525532409916329, .7966664774136267, .9602898564975363];
const GLW = [.1012285362903763, .2223810344533745, .3137066458778873, .362683783378362,
    .362683783378362, .3137066458778873, .2223810344533745, .1012285362903763];
const RULES = [GH3, GH5, GH9, normalQuadrature(0), normalQuadrature(2)].map(([nodes, weights]) =>
    ({ nodes, weights }));

/** Uniform logarithmic interpolation. Its exterior quadratic continuation is
 * a numerical guard, whose effect is checked by the caller's independent
 * wider-domain propagation; it is not a universal exterior error enclosure. */
class LogDensity {
    readonly h: number;
    private readonly a: Float64Array;
    private readonly b: Float64Array;
    private readonly c: Float64Array;
    constructor(readonly xs: readonly number[], readonly logs: readonly number[]) {
        this.h = xs[1] - xs[0];
        this.a = new Float64Array(xs.length); this.b = new Float64Array(xs.length); this.c = new Float64Array(xs.length);
        for (let i = 1; i + 2 < xs.length; i++) {
            const u = logs[i - 1] - logs[i], v = logs[i + 1] - logs[i], w = logs[i + 2] - logs[i];
            this.a[i] = (-2 * u + 6 * v - w) / 6;
            this.b[i] = (u + v) / 2; this.c[i] = (-u - 3 * v + w) / 6;
        }
    }
    private index(x: number) { return Math.max(1, Math.min(this.xs.length - 3, Math.floor((x - this.xs[0]) / this.h))); }
    value(x: number) {
        const i = this.index(x), t = (x - this.xs[i]) / this.h;
        if (t < 0 || t > 1) {
            // A concave quadratic guard extrapolation avoids cubic runaway.
            // The caller carries its provenance and replays before using it.
            const edge = t < 0 ? 0 : 1, delta = t - edge;
            const base = this.logs[i] + edge * (this.a[i] + edge * (this.b[i] + edge * this.c[i]));
            const slope = this.a[i] + edge * (2 * this.b[i] + 3 * edge * this.c[i]);
            const curvature = Math.min(0, 2 * this.b[i] + 6 * edge * this.c[i]);
            return base + delta * (slope + .5 * curvature * delta);
        }
        return this.logs[i] + t * (this.a[i] + t * (this.b[i] + t * this.c[i]));
    }
    derivatives(x: number): [number, number] {
        const i = this.index(x), t = (x - this.xs[i]) / this.h;
        const edge = Math.max(0, Math.min(1, t));
        const curvature = Math.min(0, 2 * this.b[i] + 6 * edge * this.c[i]);
        const slope = this.a[i] + edge * (2 * this.b[i] + 3 * edge * this.c[i]) + curvature * (t - edge);
        return [slope / this.h, curvature / (this.h * this.h)];
    }
    polynomial(x: number): [number, number, number, number] {
        const i = this.index(x), t = (x - this.xs[i]) / this.h;
        if (t < 0 || t > 1) { const [slope, curvature] = this.derivatives(x); return [this.value(x), slope, curvature, 0]; }
        return [this.value(x), (this.a[i] + t * (2 * this.b[i] + 3 * this.c[i] * t)) / this.h,
            (2 * this.b[i] + 6 * this.c[i] * t) / this.h ** 2, 6 * this.c[i] / this.h ** 3];
    }
}

const ROOT_2PI = Math.sqrt(2 * Math.PI);
// Rational normal-tail coefficients from Cephes ndtr (Stephen L. Moshier),
// as maintained by SciPy: https://github.com/scipy/xsf/blob/main/include/xsf/cephes/ndtr.h
const ERF_T = [9.604973739870516,90.02601972038427,2232.005345946843,7003.325141128051,55592.30130103949];
const ERF_U = [1,33.56171416475031,521.3579497801527,4594.323829709801,22629.000061389095,49267.39426086359];
const ERFC_P = [2.461969814735305e-10,.5641895648310688,7.463210564422699,48.63719709856814,196.5208329560771,526.4451949954773,934.5285271719576,1027.5518868951572,557.5353353693993];
const ERFC_Q = [1,13.228195115474499,86.70721408859897,354.9377788878199,975.7085017432055,1823.9091668790973,2246.33760818711,1656.6630919416134,557.5353408177277];
const ERFC_R = [.5641895835477551,1.275366707599781,5.019050422511805,6.160210979930536,7.40974269950449,2.9788666537210022];
const ERFC_S = [1,2.2605286322011726,9.396035249380015,12.048953980809666,17.08144507475659,9.608968090632859,3.369076451000815];
const polynomial = (x: number, coefficients: readonly number[]) => {
    let value = coefficients[0];
    for (let i = 1; i < coefficients.length; i++) value = value * x + coefficients[i];
    return value;
};
function normalTail(x: number): number {
    const z = x / Math.SQRT2;
    if (z < 1) return .5 - .5 * z * polynomial(z * z, ERF_T) / polynomial(z * z, ERF_U);
    return .5 * Math.exp(-z * z) * polynomial(z, z < 8 ? ERFC_P : ERFC_R) / polynomial(z, z < 8 ? ERFC_Q : ERFC_S);
}
function normalMass(a: number, b: number) {
    if (a >= 0) return normalTail(a) - normalTail(b);
    if (b <= 0) return normalTail(-b) - normalTail(-a);
    return 1 - normalTail(-a) - normalTail(b);
}

/** Integrate a small cubic correction to a Gaussian by its exact truncated
 * moments. The exponential remainder is checked on every interpolation cell;
 * cells with larger corrections retain the general positive quadrature path. */
function smallCorrection(density: LogDensity, r: number, variance: number, mode: number, scale: number, peak: number): number | null {
    const left = mode - 12 * scale, right = mode + 12 * scale;
    const product = (x: number) => density.value(x) - .5 * (r - x) ** 2 / variance;
    const ls = density.derivatives(left)[0] + (r - left) / variance;
    const rs = density.derivatives(right)[0] + (r - right) / variance;
    if (!(ls > 0 && rs < 0) || product(left) - peak - Math.log(ls * scale) > -40
        || product(right) - peak - Math.log(-rs * scale) > -40) return null;
    const start = Math.floor((left - density.xs[0]) / density.h) + 1;
    const end = Math.ceil((right - density.xs[0]) / density.h) - 1;
    if (end - start > 7) return null;
    const cuts = [left];
    for (let i = start; i <= end; i++) cuts.push(density.xs[0] + i * density.h);
    cuts.push(right);
    let integral = 0;
    for (let i = 0; i + 1 < cuts.length; i++) {
        const a = (cuts[i] - mode) / scale, b = (cuts[i + 1] - mode) / scale, x0 = (cuts[i] + cuts[i + 1]) / 2;
        const [f0, f1, f2, f3] = density.polynomial(x0), u = mode - x0;
        const c0 = f0 + u * (f1 + u * (f2 / 2 + u * f3 / 6)) - .5 * (r - mode) ** 2 / variance - peak;
        const c1 = scale * (f1 + u * (f2 + u * f3 / 2) + (r - mode) / variance);
        const c2 = .5 * (scale * scale * (f2 + u * f3 - 1 / variance) + 1), c3 = f3 * scale * scale * scale / 6;
        const radius = Math.max(Math.abs(a), Math.abs(b));
        const bound = Math.abs(c0) + radius * (Math.abs(c1) + radius * (Math.abs(c2) + radius * Math.abs(c3)));
        if (bound > .01 || !Number.isFinite(bound)) return null;
        const degree = bound < 1e-6 ? 1 : bound < .0005 ? 2 : bound < .003 ? 3 : 4;
        const pa = Math.exp(-.5 * a * a) / ROOT_2PI, pb = Math.exp(-.5 * b * b) / ROOT_2PI;
        const m0 = normalMass(a, b), m1 = pa - pb, m2 = a * pa - b * pb + m0, m3 = a * a * pa - b * b * pb + 2 * m1;
        let sum = m0 * (1 + c0) + c1 * m1 + c2 * m2 + c3 * m3;
        if (degree === 1) { integral += sum; continue; }
        const m4 = a * a * a * pa - b * b * b * pb + 3 * m2;
        const m5 = a ** 4 * pa - b ** 4 * pb + 4 * m3, m6 = a ** 5 * pa - b ** 5 * pb + 5 * m4;
        const squared = [c0 * c0, 2 * c0 * c1, c1 * c1 + 2 * c0 * c2, 2 * (c0 * c3 + c1 * c2),
            c2 * c2 + 2 * c1 * c3, 2 * c2 * c3, c3 * c3];
        const moments = [m0, m1, m2, m3, m4, m5, m6];
        for (let m = 0; m < 7; m++) sum += .5 * squared[m] * moments[m];
        if (degree === 2) { integral += sum; continue; }
        for (let n = 7; n <= 3 * degree; n++) moments.push(a ** (n - 1) * pa - b ** (n - 1) * pb + (n - 1) * moments[n - 2]);
        const coefficients = [c0, c1, c2, c3];
        let power = squared, factorial = 2;
        for (let k = 3; k <= degree; k++) {
            const next = Array(power.length + 3).fill(0);
            for (let m = 0; m < power.length; m++) for (let j = 0; j < 4; j++) next[m + j] += power[m] * coefficients[j];
            power = next; factorial *= k;
            for (let m = 0; m < power.length; m++) sum += power[m] * moments[m] / factorial;
        }
        integral += sum;
    }
    return integral > 0 ? peak + Math.log(scale / Math.sqrt(variance)) + Math.log(integral) : null;
}

export interface ConvolvedDensity { logs: number[]; refinements: number }

/** Continuous Gaussian convolution in log space. Gaussian importance weights
 * are only an integration device: every node retains the original density's
 * correction, and no Gaussian posterior is substituted. */
export function gaussianLogConvolution(
    xs: readonly number[], logs: readonly number[], variance: number,
): ConvolvedDensity {
    if (variance === 0) return { logs: [...logs], refinements: 0 };
    if (!(variance > 0) || !Number.isFinite(variance)) throw new Error("Invalid chronological performance variance");
    const density = new LogDensity(xs, logs), sigma = Math.sqrt(variance);
    const out: number[] = [];
    let cursor = 0, refinements = 0;
    for (const r of xs) {
        const product = (x: number) => density.value(x) - .5 * ((r - x) / sigma) ** 2;
        // Product modes move monotonically with the destination rating.
        while (cursor + 1 < xs.length && logs[cursor + 1] - .5 * ((r - xs[cursor + 1]) / sigma) ** 2
            > logs[cursor] - .5 * ((r - xs[cursor]) / sigma) ** 2) cursor++;
        let mode = xs[cursor];
        for (let i = 0; i < 12; i++) {
            const [slope, curvature] = density.derivatives(mode);
            const shift = (slope + (r - mode) / variance) / (1 / variance - curvature);
            const next = mode + Math.max(-2 * density.h, Math.min(2 * density.h, shift));
            if (Math.abs(next - mode) < 1e-10 * Math.max(1, density.h)) { mode = next; break; }
            mode = next;
        }
        const peak = product(mode), [modeSlope, curvature] = density.derivatives(mode);
        const scale = 1 / Math.sqrt(1 / variance - curvature);
        if (!Number.isFinite(peak) || !(scale > 0)) throw new Error("Chronological convolution has no finite support");
        if (Math.abs(modeSlope + (r - mode) / variance) * scale > 1e-6)
            throw new Error("Chronological convolution mode did not converge");
        const analytic = smallCorrection(density, r, variance, mode, scale, peak);
        if (analytic !== null) { out.push(analytic); continue; }
        const integrateRule = (rule: typeof RULES[number]) => {
            const { nodes, weights } = rule;
            let sum = 0;
            // With a concave density, the local product mode removes severe
            // tail tilts which a rule centred at r would miss entirely.
            for (let i = 0; i < nodes.length; i++) {
                const z = nodes[i], x = mode + scale * z;
                const gaussianZ = (r - mode) / sigma - scale / sigma * z;
                const logValue = density.value(x);
                const correction = logValue - .5 * gaussianZ * gaussianZ - peak + .5 * z * z;
                const term = weights[i] * Math.exp(correction);
                sum += term;
            }
            const prefactor = peak + Math.log(scale / sigma);
            return prefactor + Math.log(sum);
        };
        let answer = integrateRule(RULES[0]), converged = false;
        for (let order = 1; order < RULES.length; order++) {
            const next = integrateRule(RULES[order]);
            if (Math.abs(next - answer) < 2e-10) { answer = next; converged = true; break; }
            answer = next;
        }
        if (!converged) {
            refinements++;
            // Resolve interpolation knots directly with positive quadrature.
            // Concavity bounds the remaining tails relative to the local mass.
            let left = mode - 10 * scale, right = mode + 10 * scale;
            for (let i = 0; i < 20; i++) {
                const slope = density.derivatives(left)[0] + (r - left) / variance;
                if (slope > 0 && product(left) - peak - Math.log(slope * scale) < -34) break;
                left = mode - 2 * (mode - left);
            }
            for (let i = 0; i < 20; i++) {
                const slope = density.derivatives(right)[0] + (r - right) / variance;
                if (slope < 0 && product(right) - peak - Math.log(-slope * scale) < -34) break;
                right = mode + 2 * (right - mode);
            }
            const cuts = [left, right, mode];
            for (const n of [-8, -4, -2, -1, 1, 2, 4, 8]) {
                const x = mode + n * scale;
                if (x > left && x < right) cuts.push(x);
            }
            const first = Math.ceil((left - xs[0]) / density.h), last = Math.floor((right - xs[0]) / density.h);
            if (last - first > 20000) throw new Error("Chronological convolution requires an unsupported integration range");
            for (let i = first; i <= last; i++) cuts.push(xs[0] + i * density.h);
            cuts.sort((a, b) => a - b);
            const quadrature = (a: number, b: number): number => {
                const half = (b - a) / 2, mid = (a + b) / 2;
                let sum = 0;
                for (let i = 0; i < GLX.length; i++) {
                    const x = mid + half * GLX[i], logValue = density.value(x);
                    const log = logValue - .5 * ((r - x) / sigma) ** 2 - peak;
                    sum += GLW[i] * Math.exp(log);
                }
                return half * sum;
            };
            const adaptive = (a: number, b: number, depth: number): number => {
                const coarse = quadrature(a, b), mid = (a + b) / 2;
                const l = quadrature(a, mid), r = quadrature(mid, b), fine = l + r;
                if (Math.abs(fine - coarse) < 1e-11 * scale + 1e-11 * fine) return fine;
                if (depth === 12) throw new Error("Chronological convolution quadrature did not converge");
                const al = adaptive(a, mid, depth + 1), ar = adaptive(mid, b, depth + 1);
                return al + ar;
            };
            let mass = 0;
            for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] > cuts[i]) {
                mass += adaptive(cuts[i], cuts[i + 1], 0);
            }
            const prefactor = peak - Math.log(sigma * Math.sqrt(2 * Math.PI));
            answer = prefactor + Math.log(mass);
        }
        if (!Number.isFinite(answer)) throw new Error("Chronological convolution could not be normalised");
        out.push(answer);
    }
    return { logs: out, refinements };
}
