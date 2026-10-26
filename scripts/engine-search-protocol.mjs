export const ENGINE_SEARCH_PROTOCOL_VERSION = 1;
const ranges = Object.freeze({
  depth: Object.freeze({ min: 1, max: 70 }),
  time: Object.freeze({ min: 50, max: 3_600_000 }),
  nodes: Object.freeze({ min: 1, max: 4_294_967_295 }),
});

/** Time values are whole milliseconds. An explicit limit owns the search;
 * legacy depth/infinite and independent bounded reports remain separate. */
export function engineSearchCapability(maxDepth = 70) {
  return Object.freeze({
    depth: Object.freeze({ min: 1, max: Math.min(70, maxDepth) }),
    timeMs: ranges.time,
    nodes: ranges.nodes,
    infinite: true,
  });
}

export function captureEngineSearchLimit(value, maxDepth = 70) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Search limit must be a version 1 settings object.");
  const { version, mode, value: count } = value;
  if (
    version !== ENGINE_SEARCH_PROTOCOL_VERSION ||
    !["depth", "time", "nodes", "infinite"].includes(mode) ||
    Object.keys(value).some((key) => !["version", "mode", "value"].includes(key))
  )
    throw Error("Choose a version 1 depth, time, node or until-stopped search limit.");
  if (mode === "infinite") {
    if (Object.hasOwn(value, "value")) throw Error("Until-stopped searches have no numeric limit.");
    return Object.freeze({ version, mode });
  }
  const bounds = ranges[mode];
  const max = mode === "depth" ? Math.min(bounds.max, maxDepth) : bounds.max;
  if (!Number.isSafeInteger(count) || count < bounds.min || count > max)
    throw Error(
      `${mode} must be a whole number from ${bounds.min} to ${max}${mode === "time" ? " milliseconds" : ""}.`,
    );
  return Object.freeze({ version, mode, value: count });
}

export function parseEngineSearchRequest(body, maxDepth = 70) {
  if (!Object.hasOwn(body ?? {}, "searchLimit")) return null;
  if (["depth", "infinite", "reportLimits"].some((key) => Object.hasOwn(body, key)))
    throw Error("Choose an explicit search limit or legacy/report limits, not both.");
  return captureEngineSearchLimit(body.searchLimit, maxDepth);
}

export function engineSearchCommand(limit) {
  const selected = captureEngineSearchLimit(limit);
  return selected.mode === "infinite"
    ? "go infinite"
    : `go ${selected.mode === "time" ? "movetime" : selected.mode} ${selected.value}`;
}

/** Explicit node/depth/until-stopped jobs keep running until their chosen UCI
 * limit or cancellation. A time search has a bounded completion allowance.
 * Legacy callers retain their pre-existing service deadline. */
export function engineSearchTimeout(limit) {
  const selected = captureEngineSearchLimit(limit);
  return selected.mode === "time" ? selected.value + 10_000 : null;
}
