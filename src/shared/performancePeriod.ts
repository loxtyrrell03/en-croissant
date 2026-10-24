export type PerformanceDurationUnit = "h" | "d" | "w";
export type PerformanceDuration = `${number}${PerformanceDurationUnit}`;

const secondsPerUnit = { h: 3600, d: 86400, w: 604800 };

export function customPerformancePeriod(value: string, unit: PerformanceDurationUnit): PerformanceDuration | null {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const amount = Number(value);
  const seconds = amount * secondsPerUnit[unit];
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > Number.MAX_SAFE_INTEGER) return null;
  return `${amount}${unit}`;
}

export function performanceDurationSeconds(period: string): number {
  if (period === "1y") return 365 * 86400;
  const match = period.match(/^(.+)([hdw])$/);
  const duration = match && customPerformancePeriod(match[1], match[2] as PerformanceDurationUnit);
  if (!duration) throw new Error("Choose a positive custom duration.");
  return Number.parseFloat(duration) * secondsPerUnit[match![2] as PerformanceDurationUnit];
}

export function performanceDurationLabel(period: string): string {
  if (period === "1y") return "year";
  performanceDurationSeconds(period);
  const amount = Number.parseFloat(period);
  const unit = { h: "hour", d: "day", w: "week" }[period.at(-1) as PerformanceDurationUnit];
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}
