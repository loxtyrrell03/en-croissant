import { CPU_RESOURCE_PRESETS } from "./engine-resource-presets.mjs";

export const CPU_RESOURCE_PROTOCOL_VERSION = 1;
export const CPU_RESOURCE_CAPABILITY = Object.freeze({
  threads: Object.freeze({ min: 1, max: 64 }),
  hashMb: Object.freeze({ min: 16, max: 8192 }),
  presets: CPU_RESOURCE_PRESETS,
});

/** CPU choices are resolved once by the client's PC-device policy, then sent
 * explicitly on each request. A new board position does not silently retune
 * the saved selection because available memory changed. Legacy fixed presets
 * and requests without this separate field retain their original meaning. */
export function parseCpuResourceRequest(body, engineKind) {
  if (!Object.hasOwn(body ?? {}, "cpuResources")) return null;
  const value = body.cpuResources;
  if (engineKind !== "stockfish") throw Error("CPU resources require Stockfish.");
  if (body.performancePreset != null)
    throw Error("Choose CPU resources or a fixed performance preset, not both.");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== CPU_RESOURCE_PROTOCOL_VERSION ||
    Object.keys(value).some((key) => !["version", "threads", "hashMb"].includes(key))
  )
    throw Error("CPU resources require version 1, threads and hashMb.");
  for (const name of ["threads", "hashMb"]) {
    const bounds = CPU_RESOURCE_CAPABILITY[name];
    if (!Number.isSafeInteger(value[name]) || value[name] < bounds.min || value[name] > bounds.max)
      throw Error(`${name} must be a whole number from ${bounds.min} to ${bounds.max}.`);
  }
  return Object.freeze({
    version: CPU_RESOURCE_PROTOCOL_VERSION,
    threads: value.threads,
    hashMb: value.hashMb,
  });
}

export function cpuResourceSpinOption(line) {
  const name = /^option name (Threads|Hash) type spin\b/.exec(line)?.[1];
  if (!name) return null;
  const min = Number(/\bmin (-?\d+)\b/.exec(line)?.[1]);
  const max = Number(/\bmax (-?\d+)\b/.exec(line)?.[1]);
  return Number.isSafeInteger(min) && Number.isSafeInteger(max) && max >= min
    ? { name, min, max }
    : null;
}

/** Check the actual worker after UCI startup, before changing any request
 * options. Never claim an effective custom value outside its advertised range. */
export function validateCpuResourceOptions(values, options) {
  for (const [name, field] of [
    ["Threads", "threads"],
    ["Hash", "hashMb"],
  ]) {
    const bounds = options.get(name);
    if (!bounds || values[field] < bounds.min || values[field] > bounds.max)
      throw Error(`Stockfish does not support the selected ${name} value.`);
  }
}
