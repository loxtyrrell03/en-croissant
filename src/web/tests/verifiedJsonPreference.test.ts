import { expect, it, vi } from "vitest";
import { createVerifiedJsonPreference } from "../verifiedJsonPreference";
import { capturePcCpuResources } from "../pcCpuResources";
import type { CpuResourceSelection } from "../../../scripts/engine-resource-protocol.mjs";
const DEFAULT_PHONE_ENGINE_SETTINGS = {
    enabled: false,
    useCloud: false,
    depth: 14,
    stockfishPreset: "good",
    cpuResources: null as CpuResourceSelection | null,
};
function normalizePhoneEngineSettings(value: Partial<typeof DEFAULT_PHONE_ENGINE_SETTINGS> | null) {
    return {
        enabled: value?.enabled ?? false,
        useCloud: value?.useCloud ?? false,
        depth: value?.depth ?? 14,
        stockfishPreset: value?.stockfishPreset ?? "good",
        cpuResources:
            value?.cpuResources == null ? null : capturePcCpuResources(value.cpuResources),
    };
}
const cpu = { version: 1 as const, threads: 3, hashMb: 333 };
function fixture(
    initial: string | null = JSON.stringify({
        ...DEFAULT_PHONE_ENGINE_SETTINGS,
        enabled: true,
        ownerOption: "keep",
    }),
) {
    let disk = initial;
    const read = vi.fn(() => disk),
        write = vi.fn((text: string) => {
            disk = text;
        }),
        remove = vi.fn(() => {
            disk = null;
        });
    const store = createVerifiedJsonPreference({
        fallback: DEFAULT_PHONE_ENGINE_SETTINGS,
        normalize: normalizePhoneEngineSettings,
        read,
        write,
        remove,
    });
    return {
        store,
        read,
        write,
        remove,
        disk: () => disk,
        external: (text: string | null) => {
            disk = text;
        },
    };
}
it("reads existing legacy presets and unknown fields without writing or inferring first use", () => {
    const f = fixture();
    expect(f.store.getSnapshot().firstUseEligible).toBe(false);
    expect(f.write).not.toHaveBeenCalled();
    f.store.update((value) => ({ ...value, depth: 23 }));
    expect(JSON.parse(f.disk()!).ownerOption).toBe("keep");
    expect(f.store.getSnapshot().value.stockfishPreset).toBe("good");
});
it("keeps confirmed missing preferences absent until a successful explicit or first-use edit", () => {
    const f = fixture(null);
    expect(f.store.getSnapshot().firstUseEligible).toBe(true);
    expect(f.disk()).toBeNull();
    f.store.update((value) => value);
    expect(f.disk()).toBeNull();
    f.store
        .prepare(
            (value) => ({ ...value, cpuResources: cpu }),
            () => true,
            true,
        )
        .save();
    expect(f.store.getSnapshot().value.useCloud).toBe(false);
    expect(f.store.getSnapshot().value.enabled).toBe(false);
    expect(f.store.getSnapshot().value.cpuResources).toEqual(cpu);
    expect(f.store.getSnapshot().firstUseEligible).toBe(false);
});
it("does not infer first use from an existing null/empty/default-looking preference", () => {
    for (const text of ["null", "{}", JSON.stringify(DEFAULT_PHONE_ENGINE_SETTINGS)]) {
        const f = fixture(text);
        expect(f.store.getSnapshot().firstUseEligible).toBe(false);
        expect(() =>
            f.store.prepare(
                (value) => ({ ...value, cpuResources: cpu }),
                () => true,
                true,
            ),
        ).toThrow(/not first-use/);
        expect(f.disk()).toBe(text);
    }
});
it("does not overwrite malformed saved bytes with defaults", () => {
    const f = fixture("{unreadable");
    expect(f.store.getSnapshot().phase).toBe("unreadable");
    expect(f.store.update((value) => ({ ...value, enabled: true }))).toBe(false);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.disk()).toBe("{unreadable");
});
it("retains a failed read without writing and establishes genuine absence only after a successful retry", () => {
    const f = fixture(null);
    f.read.mockImplementation(() => {
        throw Error("Invented denied read");
    });
    f.store.reload();
    expect(f.store.getSnapshot().phase).toBe("unreadable");
    expect(f.store.update((value) => ({ ...value, enabled: true }))).toBe(false);
    expect(f.write).not.toHaveBeenCalled();
    f.read.mockImplementation(() => null);
    expect(f.store.reload()).toBe(true);
    expect(f.disk()).toBeNull();
});
it("never publishes new resources before a successful write and exact readback", () => {
    const f = fixture();
    f.write.mockImplementationOnce(() => {
        throw Error("Invented full storage");
    });
    const edit = f.store.prepare((value) => ({ ...value, cpuResources: cpu }));
    expect(() => edit.save()).toThrow(/full storage/);
    expect(f.store.getSnapshot().value.cpuResources).toBeNull();
    edit.save();
    expect(f.store.getSnapshot().value.cpuResources).toEqual(cpu);
    expect(edit.isApplied()).toBe(true);
});
it("retries a failed resource edit while preserving a newer independent Pause", () => {
    const f = fixture();
    f.write.mockImplementationOnce(() => {
        throw Error("Invented full storage");
    });
    const edit = f.store.prepare((value) => ({ ...value, cpuResources: cpu }));
    expect(() => edit.save()).toThrow(/storage/);
    f.store.update((value) => ({ ...value, enabled: false }));
    edit.save();
    expect(f.store.getSnapshot().value.enabled).toBe(false);
    expect(f.store.getSnapshot().value.cpuResources).toEqual(cpu);
    expect(JSON.parse(f.disk()!).enabled).toBe(false);
});
it("refuses an old retry after a newer edit to the same fields", () => {
    const f = fixture();
    const edit = f.store.prepare((value) => ({ ...value, cpuResources: cpu }));
    const newer = { ...cpu, hashMb: 65 };
    f.store.update((value) => ({ ...value, cpuResources: newer }));
    expect(() => edit.save()).toThrow(/Newer/);
    expect(f.store.getSnapshot().value.cpuResources).toEqual(newer);
});
it("keeps a foreign disk change and refuses a stale field edit without a write", () => {
    const f = fixture();
    const edit = f.store.prepare((value) => ({ ...value, cpuResources: cpu }));
    const text = JSON.stringify({
        ...DEFAULT_PHONE_ENGINE_SETTINGS,
        cpuResources: { ...cpu, hashMb: 65 },
        ownerOption: "external",
    });
    f.external(text);
    expect(() => edit.save()).toThrow(/Newer/);
    expect(f.disk()).toBe(text);
    expect(f.write).not.toHaveBeenCalled();
});
it("restores only its resource field while keeping newer independent fields and unknown data", () => {
    const f = fixture();
    const edit = f.store.prepare((value) => ({ ...value, cpuResources: cpu }));
    edit.save();
    f.store.update((value) => ({ ...value, enabled: false }));
    edit.restore();
    expect(f.store.getSnapshot().value.enabled).toBe(false);
    expect(f.store.getSnapshot().value.cpuResources).toBeNull();
    expect(JSON.parse(f.disk()!).ownerOption).toBe("keep");
});
it("restores a failed unwritten edit without creating absent preference bytes", () => {
    const f = fixture(null);
    f.write.mockImplementationOnce(() => {
        throw Error("Invented full storage");
    });
    const edit = f.store.prepare((value) => ({ ...value, cpuResources: cpu }));
    expect(() => edit.save()).toThrow(/storage/);
    edit.restore();
    expect(f.disk()).toBeNull();
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.store.getSnapshot().error).toBeNull();
});
it("removes only its exact newly-created bytes when restoring a missing-store edit", () => {
    const f = fixture(null);
    const edit = f.store.prepare((value) => ({ ...value, cpuResources: cpu }));
    edit.save();
    edit.restore();
    expect(f.disk()).toBeNull();
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.store.getSnapshot().value.enabled).toBe(false);
});
it("does not remove a new store after another field was saved", () => {
    const f = fixture(null);
    const edit = f.store.prepare((value) => ({ ...value, cpuResources: cpu }));
    edit.save();
    f.store.update((value) => ({ ...value, enabled: true }));
    edit.restore();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.store.getSnapshot().value.enabled).toBe(true);
    expect(f.store.getSnapshot().value.cpuResources).toBeNull();
});
it("rejects an initialization after a manual edit or externally created existing preferences", () => {
    const f = fixture(null);
    const edit = f.store.prepare(
        (value) => ({ ...value, cpuResources: cpu }),
        () => true,
        true,
    );
    f.store.update((value) => ({ ...value, enabled: true }));
    expect(() => edit.save()).toThrow(/Newer/);
    const other = fixture(null),
        before = other.store.prepare(
            (value) => ({ ...value, cpuResources: cpu }),
            () => true,
            true,
        );
    other.external(JSON.stringify(DEFAULT_PHONE_ENGINE_SETTINGS));
    expect(() => before.save()).toThrow(/Newer/);
});
it("preserves ownership across a write that succeeded before readback temporarily failed", () => {
    const f = fixture(null);
    const edit = f.store.prepare(
        (value) => ({ ...value, cpuResources: cpu }),
        () => true,
        true,
    );
    const original = f.write.getMockImplementation()!;
    f.write.mockImplementationOnce((text) => {
        original(text);
        f.read.mockImplementationOnce(() => {
            throw Error("Invented readback failure");
        });
    });
    expect(() => edit.save()).toThrow(/readback failure/);
    expect(f.store.getSnapshot().value.cpuResources).toBeNull();
    edit.save();
    expect(f.store.getSnapshot().value.cpuResources).toEqual(cpu);
    expect(f.write).toHaveBeenCalledTimes(1);
});
it("keeps resource reference identity stable for an independent settings edit", () => {
    const f = fixture();
    f.store.update((value) => ({ ...value, cpuResources: cpu }));
    const selected = f.store.getSnapshot().value.cpuResources;
    f.store.update((value) => ({ ...value, depth: 22 }));
    expect(f.store.getSnapshot().value.cpuResources).toBe(selected);
});
