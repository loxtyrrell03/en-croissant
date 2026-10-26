import type { GoMode } from "@/bindings";
import type { EngineSearchLimit } from "../../scripts/engine-search-protocol.mjs";
import { capturePcSearchLimit } from "./pcSearchLimits";
export const PHONE_SEARCH_PREFERENCES_KEY = "en-croissant-phone-search-v1";
export type PhoneSearchPreferences = { limit: EngineSearchLimit | null; lines: number | null };
export const DEFAULT_PHONE_SEARCH_PREFERENCES: PhoneSearchPreferences = {
    limit: null,
    lines: null,
};
export function normalizePhoneSearchPreferences(
    value: Partial<PhoneSearchPreferences> | null,
): PhoneSearchPreferences {
    const lines = value?.lines ?? null;
    if (lines !== null && (!Number.isSafeInteger(lines) || lines < 1 || lines > 8))
        throw Error("Saved search lines must be a whole number from 1 to 8.");
    return { limit: value?.limit == null ? null : capturePcSearchLimit(value.limit), lines };
}
export function phoneSearchGo(
    preferences: PhoneSearchPreferences,
    legacy: { depth: number; infinite: boolean },
): GoMode {
    const limit = preferences.limit;
    if (!limit) return legacy.infinite ? { t: "Infinite" } : { t: "Depth", c: legacy.depth };
    return limit.mode === "infinite"
        ? { t: "Infinite" }
        : {
              t: limit.mode === "time" ? "Time" : limit.mode === "nodes" ? "Nodes" : "Depth",
              c: limit.value,
          };
}
export function phoneSearchLimit(go: GoMode): EngineSearchLimit {
    if (go.t === "PlayersTime") throw Error("Live phone analysis does not use player clocks.");
    return capturePcSearchLimit(
        go.t === "Infinite"
            ? { version: 1, mode: "infinite" }
            : {
                  version: 1,
                  mode: go.t === "Time" ? "time" : go.t === "Nodes" ? "nodes" : "depth",
                  value: go.c,
              },
    );
}
