import { afterEach, expect, test, vi } from "vitest";
import { clearHostedWebLibraryCache, getHostedWebLibrary, getHostedWebLibraryPath, getHostedWebLibraryScope } from "../hostedFiles";

const manifest = (name: string) => ({ version: 1, generatedAt: "2026-10-24", sourceName: name, files: [] });
afterEach(() => { clearHostedWebLibraryCache(); vi.unstubAllGlobals(); });
test.each(["root", "directory", "recursive"] as const)("a superseded %s manifest cannot overwrite a forced refresh", async kind => {
    clearHostedWebLibraryCache();
    let resolveOld!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
        .mockResolvedValue(new Response(JSON.stringify(manifest("New source"))));
    vi.stubGlobal("fetch", fetcher);
    const load = (forceRefresh = false) => kind === "root" ? getHostedWebLibrary({ forceRefresh }) : kind === "directory" ? getHostedWebLibraryPath("Databases", { forceRefresh }) : getHostedWebLibraryScope("Databases", { forceRefresh });
    const old = load(); const current = await load(true);
    expect(JSON.stringify(current)).toContain("New source");
    resolveOld(new Response(JSON.stringify(manifest("Old source")))) ; await old;
    expect(await load()).toEqual(current);
    expect(fetcher).toHaveBeenCalledTimes(2);
});
