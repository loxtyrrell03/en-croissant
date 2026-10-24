/** Shared report metric ported from Novelty's numerical specification.
 * White-relative centipawns, including the actual initial position.
 * This module is separate from the calibrated phone strength model.
 */
export function winPercent(cp: number, cap = true): number {
    const value = cap ? Math.max(-1000, Math.min(1000, cp)) : cp;
    return 100 / (1 + Math.exp(-0.00368208 * value));
}

export function moveAccuracy(before: number, after: number, white: boolean): number {
    const loss = (winPercent(before) - winPercent(after)) * (white ? 1 : -1);
    if (loss <= 0) return 100;
    return Math.max(0, Math.min(100,
        103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411 + 1));
}

/** Population-volatility weights before selecting either player's moves. */
export function accuracyWeights(positions: readonly number[]): number[] {
    const plies = positions.length - 1;
    const width = Math.min(positions.length, Math.max(2, Math.min(8, Math.floor(plies / 10))));
    const chances = positions.map(cp => winPercent(cp));
    return Array.from({ length: Math.max(0, plies) }, (_, ply) => {
        const start = Math.max(0, ply + 2 - width);
        const window = chances.slice(start, start + width);
        const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
        const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length;
        return Math.max(0.5, Math.min(12, Math.sqrt(variance)));
    });
}

export function gameAccuracy(moves: readonly { accuracy: number; weight: number }[]): number | null {
    if (!moves.length) return null;
    let total = 0, weights = 0, inverse = 0;
    for (const move of moves) {
        total += move.accuracy * move.weight;
        weights += move.weight;
        inverse += 1 / Math.max(1, move.accuracy);
    }
    return (total / weights + moves.length / inverse) / 2;
}
