import { PERFORMANCE_PERIODS, type PerformancePeriod } from "./truePerformance";
import { customPerformancePeriod, type PerformanceDurationUnit } from "./performancePeriod";

export function initialPerformancePeriodSelection() {
  let period: PerformancePeriod = "30d";
  let choice: PerformancePeriod | "custom" = "30d";
  let amount = "30";
  let unit: PerformanceDurationUnit = "d";
  try {
    const saved = localStorage.getItem("performance-period");
    const custom = localStorage.getItem("performance-custom-duration")?.match(/^(.+)([hdw])$/);
    const duration = custom && customPerformancePeriod(custom[1], custom[2] as PerformanceDurationUnit);
    if (duration && custom) {
      amount = custom[1];
      unit = custom[2] as PerformanceDurationUnit;
    }
    if (saved === "custom" && duration) {
      period = duration;
      choice = "custom";
    } else if (PERFORMANCE_PERIODS.some(([value]) => value === saved)) {
      period = choice = saved as PerformancePeriod;
    }
  } catch {
    /* Storage can be unavailable. */
  }
  return { period, choice, amount, unit };
}

export function rememberPerformancePeriod(next: PerformancePeriod | "custom", duration?: PerformancePeriod) {
  try {
    if (duration) localStorage.setItem("performance-custom-duration", duration);
    localStorage.setItem("performance-period", next);
  } catch {
    /* Storage can be unavailable. */
  }
}
