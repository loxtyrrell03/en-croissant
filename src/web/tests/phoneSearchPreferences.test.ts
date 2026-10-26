import { expect, it } from "vitest";
import {
    normalizePhoneSearchPreferences,
    phoneSearchGo,
    phoneSearchLimit,
} from "../phoneSearchPreferences";
import { createVerifiedJsonPreference } from "../verifiedJsonPreference";
const fallback = { limit: null, lines: null };
it("inherits exact legacy depth/lines without inventing an explicit limit", () => {
    const empty = normalizePhoneSearchPreferences(null);
    expect(empty).toEqual(fallback);
    expect(phoneSearchGo(empty, { depth: 70, infinite: false })).toEqual({ t: "Depth", c: 70 });
    expect(phoneSearchGo(empty, { depth: 70, infinite: true })).toEqual({ t: "Infinite" });
    expect(normalizePhoneSearchPreferences({ lines: 4 }).limit).toBeNull();
});
it.each([
    { t: "Depth", c: 60 },
    { t: "Time", c: 51 },
    { t: "Nodes", c: 4294967295 },
    { t: "Infinite" },
] as const)("round-trips supported $t choices without units or integer loss", (go) => {
    const limit = phoneSearchLimit(go);
    expect(phoneSearchGo({ limit, lines: 2 }, { depth: 14, infinite: false })).toEqual(go);
    expect(Object.isFrozen(limit)).toBe(true);
});
it("rejects foreign/malformed limits and line counts without treating them as defaults", () => {
    for (const value of [
        { lines: 0 },
        { lines: 9 },
        { lines: 1.5 },
        { lines: "3" },
        { limit: { version: 2, mode: "infinite" } },
        { limit: { version: 1, mode: "time", value: 49 } },
    ])
        expect(() => normalizePhoneSearchPreferences(value as never)).toThrow(/search|invalid/);
    expect(() =>
        phoneSearchLimit({ t: "PlayersTime", c: { white: 1000, black: 1000, winc: 0, binc: 0 } }),
    ).toThrow(/clocks/);
});
it("saves only changed search fields, preserves unknown data and cannot restore over a newer choice", () => {
    let raw: string | null = JSON.stringify({ limit: null, lines: 2, other: "keep" });
    const store = createVerifiedJsonPreference({
        fallback,
        normalize: normalizePhoneSearchPreferences,
        read: () => raw,
        write: (text) => {
            raw = text;
        },
        remove: () => {
            raw = null;
        },
    });
    const time = store.prepare((current) => ({
        ...current,
        limit: phoneSearchLimit({ t: "Time", c: 333 }),
    }));
    time.save();
    const lines = store.prepare((current) => ({ ...current, lines: 4 }));
    lines.save();
    time.restore();
    expect(JSON.parse(raw!)).toEqual({ limit: null, lines: 4, other: "keep" });
    const older = store.prepare((current) => ({
        ...current,
        limit: phoneSearchLimit({ t: "Time", c: 1000 }),
    }));
    older.save();
    store
        .prepare((current) => ({ ...current, limit: phoneSearchLimit({ t: "Depth", c: 6 }) }))
        .save();
    expect(() => older.restore()).toThrow(/Newer/);
    expect(store.getSnapshot().value.limit).toEqual({ version: 1, mode: "depth", value: 6 });
});
