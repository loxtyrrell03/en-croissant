import { MantineProvider } from "@mantine/core";
import { atom } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileMetadata } from "./file";
import { PgnFileCard } from "./FileCard";

const io = vi.hoisted(() => ({ read: vi.fn(), open: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));
vi.mock("@/bindings/pgnFiles", () => ({
  pgnFiles: {
    readBatch: async (...args: unknown[]) => ({ games: await io.read(...args), gameCount: 3 }),
  },
}));
vi.mock("@/utils/files", () => ({ openFile: io.open }));
vi.mock("@/state/atoms", () => ({ tabsAtom: atom([]), activeTabAtom: atom(null) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => io.navigate }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: io.toast } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../databases/GamePreview", () => ({
  default: ({ pgn }: { pgn: string }) => <div data-preview>{pgn}</div>,
}));
vi.mock("../panels/info/GameSelector", () => ({
  default: ({ setPage }: { setPage: (page: number) => void }) => (
    <>
      <button onClick={() => setPage(1)}>Game 2</button>
      <button onClick={() => setPage(2)}>Game 3</button>
    </>
  ),
}));
function pending() {
  let resolve!: (value: ReturnType<typeof snapshot>[]) => void;
  const promise = new Promise<ReturnType<typeof snapshot>[]>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const snapshot = (pgn: string, index = 0) => ({ pgn, index, identity: pgn, gameCount: 3 });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());
async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = async (path: string) => {
    const selected: FileMetadata = {
      type: "file",
      path,
      name: path,
      numGames: 3,
      lastModified: 1,
      metadata: { type: "game", tags: [] },
    };
    await act(async () =>
      root.render(
        <MantineProvider>
          <PgnFileCard
            selected={selected}
            games={new Map()}
            setGames={() => {}}
            toggleEditModal={() => {}}
          />
        </MantineProvider>,
      ),
    );
  };
  return {
    host,
    render,
    click: async (name: string) =>
      act(async () => {
        [...host.querySelectorAll("button")]
          .find(
            (button) => button.textContent === name || button.getAttribute("aria-label") === name,
          )!
          .click();
      }),
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
it("cannot show or open an old file after selection changes during a native read", async () => {
  const a = pending(),
    b = pending();
  io.read.mockImplementation((path) => (path === "/a.pgn" ? a.promise : b.promise));
  const view = await mount();
  try {
    await view.render("/a.pgn");
    await view.render("/b.pgn");
    expect(view.host.querySelector('[aria-label="Open game"]')?.hasAttribute("disabled")).toBe(
      true,
    );
    await act(async () => b.resolve([snapshot("B")]));
    await act(async () => a.resolve([snapshot("A")]));
    expect(view.host.querySelector("[data-preview]")?.textContent).toBe("B");
    await view.click("Open game");
    expect(io.open.mock.calls[0][0].path).toBe("/b.pgn");
    expect(io.open.mock.calls[0][3]).toMatchObject({
      pgn: "B",
      expectedIdentity: "B",
      gameNumber: 0,
    });
  } finally {
    await view.dispose();
  }
});
it("hides a previous preview immediately and accepts only the latest page request", async () => {
  const a = pending(),
    b = pending();
  io.read.mockImplementation((_path, page) =>
    page === 0 ? Promise.resolve([snapshot("Root")]) : page === 1 ? a.promise : b.promise,
  );
  const view = await mount();
  try {
    await view.render("/a.pgn");
    await view.click("Game 2");
    expect(view.host.querySelector("[data-preview]")).toBeNull();
    await view.click("Game 3");
    await act(async () => b.resolve([snapshot("Third", 2)]));
    await act(async () => a.resolve([snapshot("Second", 1)]));
    expect(view.host.querySelector("[data-preview]")?.textContent).toBe("Third");
    await view.click("Open game");
    expect(io.open.mock.calls[0][3]).toMatchObject({ pgn: "Third", gameNumber: 2 });
  } finally {
    await view.dispose();
  }
});
it("shows native failures with retry and refuses opening until a snapshot is ready", async () => {
  io.read
    .mockRejectedValueOnce(new Error("File locked"))
    .mockResolvedValue([snapshot("Recovered")]);
  const view = await mount();
  try {
    await view.render("/a.pgn");
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("File locked");
    await view.click("Open game");
    expect(io.open).not.toHaveBeenCalled();
    await view.click("Retry");
    expect(view.host.querySelector("[data-preview]")?.textContent).toBe("Recovered");
    io.open.mockRejectedValue(new Error("Source changed"));
    await view.click("Open game");
    expect(io.navigate).not.toHaveBeenCalled();
    expect(io.toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Source changed") }),
    );
  } finally {
    await view.dispose();
  }
});
