import { expect, it } from "vitest";
import type { Engine } from "../engines";
import { firstUseEngineResources } from "../firstUseEngineResources";
const cpu = (id: string, loaded = true): Engine => ({
    type: "local",
    id,
    name: id,
    path: `C:/Fixture/${id}.exe`,
    version: "19",
    loaded,
    enabled: false,
    go: { t: "Nodes", c: 170003 },
    settings: [
        { name: "Threads", value: 8 },
        { name: "Hash", value: 512 },
        { name: "MultiPV", value: 3 },
        { name: "Owner", value: "keep" },
    ],
});
const device = { logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 };
it("budgets fresh profiles by visible CPU engines while preserving other fields and hidden profiles", () => {
    const profiles = [cpu("one"), cpu("two"), cpu("hidden", false)];
    const before = structuredClone(profiles);
    const next = firstUseEngineResources(profiles, device);
    expect(profiles).toEqual(before);
    for (const profile of next) {
        expect(profile.settings).toEqual([
            { name: "Threads", value: 5 },
            { name: "Hash", value: 512 },
            { name: "MultiPV", value: 3 },
            { name: "Owner", value: "keep" },
        ]);
        expect(profile.go).toEqual({ t: "Nodes", c: 170003 });
        expect(profile.enabled).toBe(false);
    }
    expect(next[2].loaded).toBe(false);
});
it("keeps engines without supported CPU fields and remote GPU resources intact", () => {
    const gpu: Engine = {
        type: "pc",
        engineKind: "lc0",
        id: "gpu",
        name: "GPU",
        url: "https://fixture.invalid",
        settings: [{ name: "MinibatchSize", value: 16 }],
    };
    expect(firstUseEngineResources([gpu], null)).toEqual([gpu]);
    expect(firstUseEngineResources([cpu("one"), gpu], device)[1]).toBe(gpu);
});
it("rejects unknown or infeasible snapshots before a first-use write", () => {
    expect(() => firstUseEngineResources([cpu("one")], null)).toThrow("Could not check resources");
    expect(() =>
        firstUseEngineResources([cpu("one")], { ...device, availableMemoryMb: 0 }),
    ).toThrow("not enough");
});
