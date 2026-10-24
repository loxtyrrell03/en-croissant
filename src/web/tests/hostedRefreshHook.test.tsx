import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { useHostedDatabaseFolders } from "../useHostedDatabaseFolders";
const load = vi.hoisted(() => vi.fn());
vi.mock("../hostedFiles", () => ({ getHostedWebLibrary: load, getHostedDatabaseFolders: (library: { manifest: { sourceName: string } }) => [library.manifest.sourceName] }));
test("a failed forced refresh retains the last successful phone listing", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    load.mockResolvedValueOnce({ available: true, manifest: { sourceName: "Existing source" } }).mockRejectedValueOnce(new Error("PC offline"));
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    function Harness() { const state = useHostedDatabaseFolders(); return <><span>{state.folders.join(",")}</span><span role="alert">{state.error}</span><button onClick={() => void state.refresh().catch(() => {})}>Refresh</button></>; }
    try {
        await act(async () => root.render(<Harness />));
        await act(async () => container.querySelector("button")!.click());
        expect(load).toHaveBeenLastCalledWith({ forceRefresh: true });
        expect(container.textContent).toContain("Existing source"); expect(container.textContent).toContain("PC offline");
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
