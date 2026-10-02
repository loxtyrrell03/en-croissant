/** Continuous integration of sampled LOG densities. No probability support is
 * discarded here: the caller retains its original evidence and mesh. */
const GL_X = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498,
    0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
const GL_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620,
    0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

export interface DensitySummary {
    mean: number; sd: number; low: number; high: number; edgeMass: number;
    logNormalizer: number; mode: number; modeSd: number;
}
interface Cell {
    x: number; h: number; base: number; a: number; b: number; c: number;
    splits: number[];
}
const value = (cell: Cell, t: number) => cell.base + t * (cell.a + t * (cell.b + t * cell.c));

function stationary(cell: Cell): number[] {
    const a = 3 * cell.c, b = 2 * cell.b, c = cell.a;
    if (Math.abs(a) < 1e-14 * Math.max(1, Math.abs(b))) {
        const t = -c / b;
        return Number.isFinite(t) && t > 0 && t < 1 ? [t] : [];
    }
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(t => t > 0 && t < 1);
}

function makeCell(xs: readonly number[], logs: readonly number[], i: number): Cell {
    const base = logs[i], u = logs[i - 1] - base, v = logs[i + 1] - base, w = logs[i + 2] - base;
    const cell: Cell = { x: xs[i], h: xs[i + 1] - xs[i], base,
        a: (-2 * u + 6 * v - w) / 6, b: (u + v) / 2, c: (-u - 3 * v + w) / 6, splits: [0, 1] };
    // Split at a narrow interior mode and several local standard deviations.
    // This prevents both quadrature orders from missing a very narrow Gaussian.
    for (const t of stationary(cell)) {
        cell.splits.push(t);
        const curvature = 2 * cell.b + 6 * cell.c * t;
        if (curvature < -16) {
            const width = 1 / Math.sqrt(-curvature);
            for (const n of [-12, -8, -4, -2, -1, 1, 2, 4, 8, 12]) {
                const point = t + n * width;
                if (point > 0 && point < 1) cell.splits.push(point);
            }
        }
    }
    cell.splits.sort((a, b) => a - b);
    return cell;
}

function integrate(cell: Cell, peak: number, centre: number, end = 1): [number, number, number] {
    let mass = 0, first = 0, second = 0;
    for (let j = 0; j < cell.splits.length - 1; j++) {
        const left = cell.splits[j], right = Math.min(end, cell.splits[j + 1]);
        if (left >= right) break;
        const half = (right - left) / 2, mid = (right + left) / 2;
        for (let k = 0; k < GL_X.length; k++) {
            const t = mid + half * GL_X[k];
            const weight = GL_W[k] * half * cell.h * Math.exp(value(cell, t) - peak);
            const distance = cell.x + cell.h * t - centre;
            mass += weight; first += weight * distance; second += weight * distance * distance;
        }
        if (right === end) break;
    }
    return [mass, first, second];
}

export function continuousLogSummary(xs: readonly number[], logs: readonly number[]): DensitySummary {
    if (xs.length !== logs.length || xs.length < 7) throw new Error("Insufficient performance integration mesh");
    let nodePeak = -Infinity, peakIndex = 0;
    for (let i = 0; i < logs.length; i++) if (logs[i] > nodePeak) { nodePeak = logs[i]; peakIndex = i; }
    if (!Number.isFinite(nodePeak)) throw new Error("Performance density has no finite support");
    let left = peakIndex, right = peakIndex;
    while (left > 0 && logs[left] > nodePeak - 45) left--;
    while (right < logs.length - 1 && logs[right] > nodePeak - 45) right++;
    left = Math.max(1, left - 2); right = Math.min(logs.length - 3, right + 1);
    const cells: Cell[] = [];
    let peak = -Infinity, mode = xs[peakIndex], modeSd = Infinity;
    for (let i = left; i <= right; i++) {
        const cell = makeCell(xs, logs, i); cells.push(cell);
        for (const t of [0, 1, ...stationary(cell)]) {
            const log = value(cell, t);
            if (log > peak) {
                peak = log; mode = cell.x + cell.h * t;
                const curvature = 2 * cell.b + 6 * cell.c * t;
                modeSd = curvature < 0 ? cell.h / Math.sqrt(-curvature) : Infinity;
            }
        }
    }
    const masses: number[] = [];
    let mass = 0, first = 0, second = 0;
    for (const cell of cells) {
        const part = integrate(cell, peak, mode);
        masses.push(part[0]); mass += part[0]; first += part[1]; second += part[2];
    }
    if (!(mass > 0) || !Number.isFinite(mass)) throw new Error("Performance density could not be integrated");
    const delta = first / mass, mean = mode + delta;
    const quantile = (q: number) => {
        const target = q * mass;
        let previous = 0;
        for (let i = 0; i < cells.length; i++) {
            if (previous + masses[i] >= target) {
                let lo = 0, hi = 1;
                for (let j = 0; j < 38; j++) {
                    const mid = (lo + hi) / 2;
                    if (previous + integrate(cells[i], peak, mode, mid)[0] < target) lo = mid; else hi = mid;
                }
                return cells[i].x + cells[i].h * (lo + hi) / 2;
            }
            previous += masses[i];
        }
        return cells[cells.length - 1].x + cells[cells.length - 1].h;
    };
    const logNormalizer = peak + Math.log(mass), h = xs[1] - xs[0];
    return { mean, sd: Math.sqrt(Math.max(0, second / mass - delta * delta)), low: quantile(.025), high: quantile(.975),
        edgeMass: h * (Math.exp(logs[0] - logNormalizer) + Math.exp(logs[logs.length - 1] - logNormalizer)),
        logNormalizer, mode, modeSd };
}

/** Fine-grid nodes are the ACTUAL midpoints of the coarser mesh. A quadrature
 * convergence check on one interpolating polynomial would not detect its error. */
export function logMidpointError(logs: readonly number[]): number {
    let peak = -Infinity;
    for (const value of logs) peak = Math.max(peak, value);
    let error = 0;
    for (let i = 3; i + 3 < logs.length; i += 2) {
        if (logs[i] < peak - 30) continue;
        const prediction = logs[i - 1] + (-(logs[i - 3] - logs[i - 1])
            + 9 * (logs[i + 1] - logs[i - 1]) - (logs[i + 3] - logs[i - 1])) / 16;
        error = Math.max(error, Math.abs(prediction - logs[i]) * Math.exp(logs[i] - peak));
    }
    return error;
}

// Probabilists' Hermite rules for integration against a standard normal.
const NORMAL_15: readonly [readonly number[], readonly number[]] = [[-6.363947888829839,-5.190093591304781,-4.1962077112690155,-3.2890824243987664,-2.432436827009758,-1.6067100690287297,-0.799129068324548,0.0,0.799129068324548,1.6067100690287297,2.432436827009758,3.2890824243987664,4.1962077112690155,5.190093591304781,6.363947888829839],[8.589649899633259e-10,5.975419597920582e-07,5.642146405189018e-05,0.0015673575035499545,0.017365774492137633,0.08941779539984439,0.2324622936097322,0.3182595182595183,0.2324622936097322,0.08941779539984439,0.017365774492137633,0.0015673575035499545,5.642146405189018e-05,5.975419597920582e-07,8.589649899633259e-10]];
const NORMAL_41: readonly [readonly number[], readonly number[]] = [[-11.614937254337464,-10.647536786319334,-9.843433249157997,-9.123069907984473,-8.45609908326939,-7.82688200405387,-7.226022663732788,-6.647308470747189,-6.0863491648784755,-5.539884440458124,-5.0053966834041255,-4.480878331594007,-3.9646840280332665,-3.455432217780993,-2.9519370163811907,-2.453159345907048,-1.9581707119772913,-1.4661254572959668,-0.9762387671800494,-0.4877685693194346,0.0,0.4877685693194346,0.9762387671800494,1.4661254572959668,1.9581707119772913,2.453159345907048,2.9519370163811907,3.455432217780993,3.9646840280332665,4.480878331594007,5.0053966834041255,5.539884440458124,6.0863491648784755,6.647308470747189,7.226022663732788,7.82688200405387,8.45609908326939,9.123069907984473,9.843433249157997,10.647536786319334,11.614937254337464],[2.2578639565833154e-30,8.308558938782185e-26,2.7468912285223807e-22,2.326384145587363e-19,7.655982291967165e-17,1.2203348742027772e-14,1.0778183949359129e-12,5.7698534280921695e-11,1.9947947567574007e-09,4.6673477081073825e-08,7.658186077982458e-07,9.058608622433034e-06,7.894719319504585e-05,0.000515801444343191,0.002561642428649793,0.00977790273820827,0.028937211747934427,0.06684765935446639,0.12114891701151034,0.1728495310506015,0.19454502775360066,0.1728495310506015,0.12114891701151034,0.06684765935446639,0.028937211747934427,0.00977790273820827,0.002561642428649793,0.000515801444343191,7.894719319504585e-05,9.058608622433034e-06,7.658186077982458e-07,4.6673477081073825e-08,1.9947947567574007e-09,5.7698534280921695e-11,1.0778183949359129e-12,1.2203348742027772e-14,7.655982291967165e-17,2.326384145587363e-19,2.7468912285223807e-22,8.308558938782185e-26,2.2578639565833154e-30]];
export function normalQuadrature(spread: number): readonly [readonly number[], readonly number[]] {
    if (!Number.isFinite(spread) || spread > 2.1)
        throw new Error("Opponent uncertainty exceeds the verified numerical integration range");
    return spread <= 0.9 ? NORMAL_15 : NORMAL_41;
}
