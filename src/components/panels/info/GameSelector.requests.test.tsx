import { MantineProvider } from "@mantine/core";
import { atom } from "jotai";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PgnGameListEntry } from "@/utils/pgnGameList";
import { defaultTree } from "@/utils/treeReducer";
import GameSelector from "./GameSelector";

const io = vi.hoisted(() => ({
  read: vi.fn(),
  parse: vi.fn(),
  first: 0,
  last: 1,
  remove: vi.fn(),
  page: vi.fn(),
  total: 4,
}));
vi.mock("@/bindings/pgnFiles", () => ({
  pgnFiles: {
    readBatch: async (...args: unknown[]) => ({
      games: await io.read(...args),
      gameCount: io.total,
    }),
  },
}));
vi.mock("@/utils/chess", () => ({ parsePGN: io.parse }));
vi.mock("@/state/atoms", () => ({ fontSizeAtom: atom(100) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () =>
      Array.from({ length: io.last - io.first + 1 }, (_, n) => ({
        index: io.first + n,
        size: 30,
        start: (io.first + n) * 30,
      })),
    getTotalSize: () => 120,
  }),
}));
const snapshots = (prefix: string, start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, n) => ({
    pgn: `${prefix}${start + n}`,
    index: start + n,
    identity: `${prefix}-id-${start + n}`,
    gameCount: 4,
  }));
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  io.total = 4;
  io.first = 0;
  io.last = 1;
  io.parse.mockImplementation(async (name: string) => ({
    ...defaultTree(),
    headers: { ...defaultTree().headers, event: name },
  }));
  io.remove.mockResolvedValue(true);
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

it("refreshes a changed game count without treating the shorter batch as a read failure", async () => {
  io.total = 1;
  io.read.mockImplementation(async (_path, start, end) =>
    snapshots("Current", start, Math.min(end, 0)),
  );
  const view = await mount();
  try {
    await view.render();
    expect(view.cache().get(0)?.name).toBe("Current0");
    expect(view.host.querySelector('[role="alert"]')).toBeNull();
    expect(io.read).toHaveBeenLastCalledWith("/a.pgn", 0, 0);
  } finally {
    await view.dispose();
  }
});

it("a retry invalidates older pending ranges before they can replace fresh rows", async () => {
  let rejectFirst!: (error: Error) => void;
  const first = new Promise<ReturnType<typeof snapshots>>((_resolve, reject) => {
    rejectFirst = reject;
  });
  const old = pending<ReturnType<typeof snapshots>>();
  io.read
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(snapshots("Fresh", 2, 3));
  const view = await mount();
  try {
    await view.render();
    io.first = 2;
    io.last = 3;
    await view.render();
    await act(async () => rejectFirst(new Error("Read failed")));
    await act(async () =>
      [...view.host.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry")!
        .click(),
    );
    await act(async () => old.resolve(snapshots("Stale", 2, 3)));
    expect(view.cache().get(2)?.name).toBe("Fresh2");
  } finally {
    await view.dispose();
  }
});
async function mount() {
  let cache = new Map<number, PgnGameListEntry>();
  function Fixture({ path, version }: { path: string; version: number }) {
    const [games, setGames] = useState(cache);
    const [total, setTotal] = useState(4);
    cache = games;
    return (
      <GameSelector
        path={path}
        version={version}
        total={total}
        onCountChange={setTotal}
        games={games}
        setGames={setGames}
        activePage={0}
        setPage={io.page}
        deleteGame={io.remove}
      />
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return {
    host,
    cache: () => cache,
    render: async (path = "/a.pgn", version = 1) =>
      act(async () =>
        root.render(
          <MantineProvider>
            <Fixture path={path} version={version} />
          </MantineProvider>,
        ),
      ),
    click: async (selector: string) =>
      act(async () => (document.querySelector(selector) as HTMLButtonElement).click()),
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
it("awaits parsing and merges non-overlapping ranges that finish out of order", async () => {
  const a = pending<ReturnType<typeof snapshots>>(),
    b = pending<ReturnType<typeof snapshots>>();
  io.read.mockImplementation((_path, start) => (start === 0 ? a.promise : b.promise));
  const view = await mount();
  try {
    await view.render();
    await view.render();
    expect(io.read).toHaveBeenCalledOnce();
    io.first = 2;
    io.last = 3;
    await view.render();
    await act(async () => b.resolve(snapshots("B", 2, 3)));
    await act(async () => a.resolve(snapshots("A", 0, 1)));
    expect([...view.cache().keys()].sort()).toEqual([0, 1, 2, 3]);
    expect(view.cache().get(0)?.name).toBe("A0");
    expect(view.cache().get(3)?.name).toBe("B3");
  } finally {
    await view.dispose();
  }
});
it("ignores old parses after the same file is refreshed to a newer generation", async () => {
  const slow = pending<ReturnType<typeof defaultTree>>();
  io.read.mockResolvedValueOnce(snapshots("Old", 0, 1)).mockResolvedValue(snapshots("New", 0, 1));
  io.parse.mockImplementation(async (pgn: string) =>
    pgn.startsWith("Old")
      ? slow.promise
      : { ...defaultTree(), headers: { ...defaultTree().headers, event: pgn } },
  );
  const view = await mount();
  try {
    await view.render();
    expect(view.cache().size).toBe(0);
    await view.render("/a.pgn", 2);
    await act(async () =>
      slow.resolve({ ...defaultTree(), headers: { ...defaultTree().headers, event: "Stale" } }),
    );
    expect(view.cache().get(0)?.name).toBe("New0");
    expect(view.host.textContent).not.toContain("Stale");
  } finally {
    await view.dispose();
  }
});
it("shows failed reads beside the list and retries without a request loop", async () => {
  io.read
    .mockRejectedValueOnce(new Error("File locked"))
    .mockResolvedValue(snapshots("Recovered", 0, 1));
  const view = await mount();
  try {
    await view.render();
    await view.render();
    expect(io.read).toHaveBeenCalledOnce();
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("File locked");
    await act(async () =>
      [...view.host.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry")!
        .click(),
    );
    expect(view.cache().get(0)?.name).toBe("Recovered0");
  } finally {
    await view.dispose();
  }
});
it("captures the displayed identity for deletion and dismisses it on source replacement", async () => {
  io.read.mockImplementation(async (path, start, end) => snapshots(path, start, end));
  const view = await mount();
  try {
    await view.render();
    await view.click('[aria-label="Remove game 1"]');
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Common.Delete")!
        .click(),
    );
    expect(io.remove).toHaveBeenCalledExactlyOnceWith(0, "/a.pgn-id-0");
    await view.click('[aria-label="Remove game 1"]');
    await view.render("/b.pgn");
    expect(document.body.textContent).not.toContain("Remove /a.pgn0 from this file?");
    expect(io.remove).toHaveBeenCalledOnce();
  } finally {
    await view.dispose();
  }
});
