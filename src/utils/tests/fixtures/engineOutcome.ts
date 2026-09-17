/** Engine scores are from the searched side's perspective. A mate score must
 * never disappear from an audit merely because centipawns are null. */
export function engineOutcomeSign(line: { cp: number | null; mate: number | null }): number | null {
    const value = line.mate ?? line.cp;
    return value === null || !Number.isFinite(value) ? null : Math.sign(value);
}
