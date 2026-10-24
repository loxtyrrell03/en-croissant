import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import useSWR from "swr/immutable";
import { expect, test, vi } from "vitest";
import LiveDatabaseFolderSelect from "./LiveDatabaseFolderSelect";
const fetchList = vi.hoisted(() => vi.fn());
vi.mock("@/utils/db", () => ({ getDatabases: fetchList }));
test("opening a native source picker refreshes its immutable shared catalogue without selecting a source", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const old = { value: "old", label: "Old source" }, added = { value: "new", label: "New source" };
    fetchList.mockResolvedValueOnce([old]).mockResolvedValue([old, added]);
    const change = vi.fn(), container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    function Harness() {
        const { data } = useSWR("databases", fetchList);
        return <LiveDatabaseFolderSelect data={[{ group: "Unfiled", items: data ?? [] }]} value="old" onChange={change} />;
    }
    try {
        await act(async () => root.render(<MantineProvider env="test"><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Harness /></SWRConfig></MantineProvider>));
        await act(async () => container.querySelector("button")!.click());
        expect(fetchList).toHaveBeenCalledTimes(2); expect(change).not.toHaveBeenCalled();
        expect(container.querySelector("button")?.textContent).toContain("Old source");
        await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent?.includes("New source"))!.click());
        expect(change).toHaveBeenCalledExactlyOnceWith("new");
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
