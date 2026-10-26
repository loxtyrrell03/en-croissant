// Pure CPU-resource policy shared by native UI, phone UI and the PC service.
// Memory values are MiB. This module never reads or writes preferences or starts engines.
export const CPU_RESOURCE_PRESETS = Object.freeze([
  Object.freeze({ id: "quiet", label: "Quiet" }),
  Object.freeze({ id: "balanced", label: "Balanced" }),
  Object.freeze({ id: "faster", label: "Faster" }),
]);
const wireMax = 0xffff_ffff;
const whole = (value, minimum) =>
  Number.isSafeInteger(value) && value >= minimum && value <= wireMax;

export function parseEngineDevice(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !whole(value.logicalThreads, 1)
  )
    return null;
  const totalMemoryMb = whole(value.totalMemoryMb, 1) ? value.totalMemoryMb : null;
  const availableMemoryMb =
    totalMemoryMb !== null && whole(value.availableMemoryMb, 0)
      ? Math.min(value.availableMemoryMb, totalMemoryMb)
      : null;
  return { logicalThreads: value.logicalThreads, totalMemoryMb, availableMemoryMb };
}

const powerBelow = (value) => 2 ** Math.floor(Math.log2(Math.max(16, value)));
export function engineResourcePlan(input, engines = 1) {
  const device = parseEngineDevice(input);
  const rounded = Math.floor(engines);
  const count = Number.isSafeInteger(rounded) && rounded > 0 ? rounded : 1;
  const known = device?.totalMemoryMb != null;
  const cpu = device?.logicalThreads ?? 1;
  const memory = device?.totalMemoryMb ?? 4096;
  const availableBudget =
    device?.availableMemoryMb == null ? memory / 4 : device.availableMemoryMb / 2;
  const memoryBudget = Math.min(memory / 4, availableBudget);
  const maxThreads = Math.max(1, Math.min(64, Math.floor(cpu / count)));
  const maxHashMb = Math.max(16, Math.min(8192, Math.floor(memoryBudget / count)));
  const make = (cpuShare, divisor, cap) => ({
    threads: Math.max(1, Math.min(maxThreads, Math.floor((cpu * cpuShare) / count))),
    hashMb: Math.min(
      maxHashMb,
      powerBelow(Math.min(cap, memory / divisor, availableBudget) / count),
    ),
  });
  const presets = known
    ? {
        quiet: make(0.25, 128, 256),
        balanced: make(0.5, 32, 1024),
        faster: make(0.75, 16, 4096),
      }
    : {
        quiet: { threads: 1, hashMb: Math.min(maxHashMb, 64) },
        balanced: { threads: 1, hashMb: Math.min(maxHashMb, 128) },
        faster: { threads: 1, hashMb: Math.min(maxHashMb, 128) },
      };
  // Keep valid slider minima, but do not present an impossible aggregate budget
  // as a recommendation. Existing explicit values are never changed by this read.
  const canRecommend = cpu >= count && memoryBudget >= count * 16;
  return { known, engines: count, maxThreads, maxHashMb, canRecommend, presets };
}

export function matchingCpuResourcePreset(values, plan) {
  for (const name of ["balanced", "quiet", "faster"]) {
    if (
      values.threads === plan.presets[name].threads &&
      values.hashMb === plan.presets[name].hashMb
    )
      return name;
  }
  return "custom";
}

export function memoryStops(min, max, current) {
  if (!whole(min, 1) || !whole(max, min)) throw Error("Choose valid memory bounds.");
  const values = new Set([min, max]);
  for (let value = 2 ** Math.ceil(Math.log2(min)); value <= max; value *= 2) values.add(value);
  if (whole(current, min) && current <= max) values.add(current);
  return [...values].sort((a, b) => a - b);
}
