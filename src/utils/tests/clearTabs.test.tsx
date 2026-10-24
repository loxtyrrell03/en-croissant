import { MantineProvider } from "@mantine/core";
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClearTabsButton } from "@/components/tabs/ClearTabsButton";
import { activeTabAtom, gameStateFamily, tabsAtom } from "@/state/atoms";
import { getTabTreeStore, releaseTabTreeStore } from "@/state/store/treeRegistry";
import { removeDebouncedSessionStorageItem } from "@/state/store/debouncedStorage";
import { clearTabs } from "../clearTabs";
import { pendingReviewDeck, writeReviewDeck } from "../reviewDeckWrites";
import { getPGN } from "../chess";
import type { Tab } from "../tabs";

const io = vi.hoisted(() => ({
  create: vi.fn(),
  write: vi.fn(),
  db: vi.fn(),
  dialog: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  toast: vi.fn(),
  exists: vi.fn(),
}));
vi.mock("@/bindings", () => ({
  commands: { writeDbGame: io.db, killEngines: io.stop, abortGame: io.abort },
}));
vi.mock("@/bindings/pgnFiles", () => ({ pgnFiles: { create: io.create, write: io.write } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: io.dialog }));
vi.mock("@tauri-apps/plugin-fs", async (original) => ({ ...(await original<typeof import("@tauri-apps/plugin-fs")>()), exists: io.exists, copyFile: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({
  resolve: async (...parts: string[]) => parts.join("/"),
  tempDir: async () => "/tmp",
}));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
vi.mock("@/utils/aiCoachPersistence", () => ({
  getAiCoachPersistenceTarget: () => null,
  getAiCoachSidecarPath: (path: string) => path + ".coach",
}));
vi.mock("@mantine/notifications", () => ({ notifications: { show: io.toast } }));
vi.mock("@tanstack/react-router", () => ({ useLoaderData: () => ({ documentDir: "/files" }) }));

const ids: string[] = [];
let counter = 0;
beforeEach(() => {
  vi.resetAllMocks();
  io.stop.mockResolvedValue({ status: "ok", data: null });
  io.abort.mockResolvedValue({ status: "ok", data: null });
  io.create.mockImplementation(async (file: string) => ({
    file,
    index: 0,
    identity: "created",
    gameCount: 1,
  }));
  io.write.mockImplementation(async (file: string, index: number) => ({
    file,
    index,
    identity: "written",
    gameCount: 3,
  }));
  io.db.mockResolvedValue({ status: "ok", data: "db-written" });
  io.exists.mockResolvedValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const id of ids.splice(0)) {
    releaseTabTreeStore(id);
    removeDebouncedSessionStorageItem(id);
  }
});
function setup(
  kinds: ("none" | "file" | "database" | "temp_file" | "opening_review")[] = ["none", "none"],
) {
  const atoms = createStore();
  const tabs: Tab[] = kinds.map((kind) => {
    const id = `clear-fixture-${++counter}`;
    ids.push(id);
    const gameOrigin: Tab["gameOrigin"] =
      kind === "none"
        ? { kind }
        : kind === "database"
          ? { kind, database: "/games.db3", gameId: counter, sourceIdentity: "db-original" }
          : kind === "opening_review"
            ? { kind, path: `/review-${counter}.json`, name: "Deck" }
            : {
                kind,
                gameNumber: 2,
                sourceIdentity: "original",
                file: {
                  type: "file",
                  path: `/game-${counter}.pgn`,
                  name: "Game",
                  lastModified: 1,
                  numGames: 3,
                  metadata: { type: "game", tags: [] },
                },
              };
    return {
      value: id,
      name: id,
      type: kind === "opening_review" ? "opening-review" : "analysis",
      gameOrigin,
    };
  });
  atoms.set(tabsAtom, tabs);
  atoms.set(activeTabAtom, tabs[0]?.value ?? null);
  const trees = tabs.map((tab) => getTabTreeStore(tab.value));
  return { atoms, tabs, trees, clear: () => clearTabs(atoms, "/files") };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const created = { file: "/files/actual (2).pgn", index: 0, identity: "created", gameCount: 1 };

it("saves active/background annotations and variations automatically before closing any tab", async () => {
  const view = setup();
  for (const tree of view.trees) {
    tree.getState().setComment("Root note");
    tree.getState().makeMoves({ payload: ["e4", "e5"] });
    tree.getState().goToStart();
    tree.getState().makeMove({ payload: "d4" });
    tree.getState().setComment("Variation note");
  }
  const expected = view.trees.map((tree) =>
    getPGN(tree.getState().root, {
      headers: tree.getState().headers,
      comments: true,
      extraMarkups: true,
      glyphs: true,
      variations: true,
    }),
  );
  io.create.mockImplementation(async (file: string) => {
    expect(view.atoms.get(tabsAtom)).toHaveLength(2);
    expect(io.stop).not.toHaveBeenCalled();
    return { ...created, file };
  });
  expect(await view.clear()).toMatchObject({ ok: true, saved: 2, closed: 2 });
  expect(io.create.mock.calls.map((call) => call[1].trim())).toEqual(expected);
  expect(io.dialog).not.toHaveBeenCalled();
  expect(view.atoms.get(tabsAtom)).toEqual([]);
  expect(view.atoms.get(activeTabAtom)).toBeNull();
  expect(io.stop).toHaveBeenCalledTimes(2);
  expect(io.abort).toHaveBeenCalledTimes(2);
});

it.each(["comment", "headers", "custom-root"])(
  "saves clean unbound zero-move %s content",
  async (content) => {
    const view = setup(["none"]);
    const tree = view.trees[0];
    if (content === "comment") tree.getState().setComment("Only a root note");
    if (content === "headers")
      tree.getState().setHeaders({ ...tree.getState().headers, event: "A study" });
    if (content === "custom-root") tree.getState().setFen("7k/6pp/8/8/8/8/6PP/KR6 b - - 0 37");
    tree.getState().save();
    expect(await view.clear()).toMatchObject({ ok: true, saved: 1, closed: 1 });
    expect(io.dialog).not.toHaveBeenCalled();
  },
);

it("updates bound file/database sources and promotes meaningful temporary games without a dialog", async () => {
  const view = setup(["file", "database", "temp_file"]);
  view.trees.forEach((tree) => tree.getState().setComment("Changes"));
  io.create.mockResolvedValue({ ...created, index: 2, gameCount: 3 });
  io.exists.mockRejectedValue(new Error("Optional Coach sidecar unavailable"));
  expect(await view.clear()).toMatchObject({ ok: true, saved: 3, closed: 3 });
  expect(io.write.mock.calls[0].slice(0, 3)).toEqual([
    view.tabs[0].gameOrigin.kind === "file" && view.tabs[0].gameOrigin.file.path,
    2,
    "original",
  ]);
  expect(io.db.mock.calls[0][3]).toBe("db-original");
  expect(io.create.mock.calls[0][3]).toMatchObject({ index: 2, identity: "original" });
  expect(io.dialog).not.toHaveBeenCalled();
});

it("keeps all originals after a later save fails and retries only the remaining work", async () => {
  const view = setup();
  view.trees.forEach((tree) => tree.getState().setComment("Keep me"));
  io.create.mockResolvedValueOnce(created).mockRejectedValueOnce(new Error("Disk full"));
  expect(await view.clear()).toMatchObject({
    ok: false,
    saved: 1,
    closed: 0,
    message: expect.stringContaining("Disk full"),
  });
  expect(view.atoms.get(tabsAtom)).toHaveLength(2);
  expect(view.trees[1].getState().dirty).toBe(true);
  expect(io.stop).not.toHaveBeenCalled();
  expect(await view.clear()).toMatchObject({ ok: true, saved: 1, closed: 2 });
  expect(io.create).toHaveBeenCalledTimes(3);
});

it.each([false, true])("keeps an earlier board edited during the final write (already saved: %s)", async (dirty) => {
  const view = setup(["file", "none"]);
  if (dirty) view.trees[0].getState().setComment("First save");
  view.trees[1].getState().setComment("Last save");
  io.create.mockImplementation(async () => {
    view.trees[0].getState().setComment("Newer edit");
    return created;
  });
  expect(await view.clear()).toMatchObject({ ok: false, closed: 0 });
  expect(view.atoms.get(tabsAtom)).toHaveLength(2);
  expect(view.trees[0].getState().dirty).toBe(true);
  expect(io.stop).not.toHaveBeenCalled();
});

it.each(["CON", "Unsafe: name\u0001 / ?", "棋".repeat(300)])("uses a bounded safe automatic filename for %s", async (event) => {
  const view = setup(["none"]);
  view.trees[0].getState().setHeaders({ ...view.trees[0].getState().headers, event });
  expect(await view.clear()).toMatchObject({ ok: true, saved: 1 });
  const name = (io.create.mock.calls[0][0] as string).slice("/files/".length);
  expect(name).toMatch(/\.pgn$/);
  expect(name).not.toMatch(/^(con|prn|aux|nul)(?:\.|$)/i);
  expect(name).not.toMatch(/[\\/:*?"<>|\p{Cc}]/u);
  expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(169);
  expect(io.dialog).not.toHaveBeenCalled();
});

it("retains malformed restored tab state before performing any write or close", async () => {
  const view = setup(["none"]);
  releaseTabTreeStore(view.tabs[0].value);
  sessionStorage.setItem(view.tabs[0].value, JSON.stringify({ version: 9, state: {} }));
  expect(await view.clear()).toMatchObject({ ok: false, saved: 0, closed: 0 });
  expect(view.atoms.get(tabsAtom)).toHaveLength(1);
  expect(io.create).not.toHaveBeenCalled();
  expect(io.stop).not.toHaveBeenCalled();
});

it("keeps a successfully created binding when session persistence fails during rebinding", async () => {
  const view = setup(["none"]);
  view.trees[0].getState().setComment("Keep this saved game");
  const original = Storage.prototype.setItem;
  let fail = true;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "tabs" && fail) { fail = false; throw new Error("Rebinding storage failure"); }
    return original.call(this, key, value);
  });
  expect(await view.clear()).toMatchObject({ ok: false, closed: 0 });
  expect(view.atoms.get(tabsAtom)[0].gameOrigin.kind).toBe("file");
  expect(view.trees[0].getState().dirty).toBe(true);
  expect(await view.clear()).toMatchObject({ ok: true, saved: 1, closed: 1 });
  expect(io.create).toHaveBeenCalledOnce();
  expect(io.write).toHaveBeenCalledOnce();
});

it("keeps new tabs and a manual active selection; repeated requests share the operation", async () => {
  const view = setup(["none"]);
  view.trees[0].getState().setComment("Saved first");
  const wait = deferred<typeof created>();
  io.create.mockReturnValueOnce(wait.promise);
  const clearing = view.clear();
  expect(view.clear()).toBe(clearing);
  await vi.waitFor(() => expect(io.create).toHaveBeenCalledOnce());
  const added: Tab = {
    value: `new-${++counter}`,
    name: "New",
    type: "analysis",
    gameOrigin: { kind: "none" },
  };
  ids.push(added.value);
  view.atoms.set(tabsAtom, (tabs) => [...tabs, added]);
  view.atoms.set(activeTabAtom, added.value);
  wait.resolve(created);
  expect(await clearing).toMatchObject({ ok: true, closed: 1 });
  expect(view.atoms.get(tabsAtom)).toEqual([added]);
  expect(view.atoms.get(activeTabAtom)).toBe(added.value);
});

it("keeps a tab whose game phase changes during another save", async () => {
  const view = setup();
  view.trees[1].getState().setComment("Last");
  io.create.mockImplementation(async () => {
    view.atoms.set(gameStateFamily(view.tabs[0].value), "playing");
    return created;
  });
  expect(await view.clear()).toMatchObject({ ok: false, closed: 0 });
  expect(view.atoms.get(tabsAtom)).toHaveLength(2);
});

it("retains review progress and all tabs when its writer fails, then retries the retained snapshot", async () => {
  const view = setup(["opening_review", "none"]);
  const origin = view.tabs[0].gameOrigin;
  if (origin.kind !== "opening_review") throw new Error("Fixture");
  const writer = vi.fn().mockRejectedValue(new Error("Review locked"));
  await expect(writeReviewDeck(origin.path, { progress: 7 }, writer)).rejects.toThrow(
    "Review locked",
  );
  expect(await view.clear()).toMatchObject({
    ok: false,
    closed: 0,
    message: expect.stringContaining("Review locked"),
  });
  expect(view.atoms.get(tabsAtom)).toHaveLength(2);
  expect(pendingReviewDeck(origin.path)).toEqual({ progress: 7 });
  writer.mockImplementation(async (snapshot) => snapshot);
  expect(await view.clear()).toMatchObject({ ok: true, closed: 2 });
  expect(pendingReviewDeck(origin.path)).toBeNull();
  expect(io.create).not.toHaveBeenCalled();
});

it("restores the in-memory tab list when browser tab persistence throws", async () => {
  const view = setup(["none"]);
  view.trees[0].getState().setComment("Already durable before close");
  const original = Storage.prototype.setItem;
  let fail = true;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "tabs" && value === "[]" && fail) {
      fail = false;
      throw new Error("Session storage unavailable");
    }
    return original.call(this, key, value);
  });
  expect(await view.clear()).toMatchObject({ ok: false, closed: 0 });
  expect(view.atoms.get(tabsAtom)).toHaveLength(1);
  expect(view.atoms.get(activeTabAtom)).toBe(view.tabs[0].value);
  expect(io.stop).not.toHaveBeenCalled();
  expect(await view.clear()).toMatchObject({ ok: true, saved: 0, closed: 1 });
});

it("shows busy, failure and Retry on the actual Clear tabs control", async () => {
  const view = setup(["none"]);
  view.trees[0].getState().setComment("Keep this");
  const wait = deferred<never>();
  io.create.mockReturnValueOnce(wait.promise);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <MantineProvider>
          <Provider store={view.atoms}>
            <ClearTabsButton />
          </Provider>
        </MantineProvider>,
      ),
    );
    await act(async () => {
      host.querySelector("button")!.click();
    });
    expect(host.querySelector("button")?.disabled).toBe(true);
    await act(async () => {
      wait.reject(new Error("Locked"));
    });
    expect(host.textContent).toContain("Tabs kept open");
    expect(host.textContent).toContain("Locked");
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry Clear tabs",
    )!;
    expect(retry.disabled).toBe(false);
    await act(async () => {
      retry.click();
    });
    expect(view.atoms.get(tabsAtom)).toEqual([]);
    expect(io.dialog).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
