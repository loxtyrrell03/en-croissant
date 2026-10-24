import { MantineProvider } from "@mantine/core";
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BoardControls from "@/components/boards/BoardControls";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { createTreeStore } from "@/state/store/tree";
import { ownTabTree } from "@/state/store/treeOwner";
import {
  FILE_BOARD_PREFERENCES_KEY,
  loadFileBoardPreferences,
  saveFileBoardPreferences,
} from "@/utils/fileBoardPreferences";
import type { Tab } from "@/utils/tabs";
import { RenameModal } from "./Modals";
import type { FileMetadata } from "./file";
const io = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", async (original) => ({
  ...(await original<typeof import("@tauri-apps/plugin-fs")>()),
  rename: io.rename,
  exists: async () => false,
}));
vi.mock("@tauri-apps/api/path", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/path")>()),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")),
  resolve: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
vi.mock("@tanstack/react-router", () => ({ useLoaderData: () => ({ documentDir: "/fixture" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (value: string) => value }) }));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
beforeEach(() => {
  io.rename.mockReset().mockResolvedValue(undefined);
  localStorage.removeItem(FILE_BOARD_PREFERENCES_KEY);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());
const file: FileMetadata = {
  type: "file",
  path: "C:/Prep/Lesson.pgn",
  name: "Lesson",
  numGames: 1,
  lastModified: 1,
  metadata: { type: "game", tags: [] },
};
const tab: Tab = {
  value: "control-owner",
  name: "Lesson",
  type: "analysis",
  gameOrigin: { kind: "file", file, gameNumber: 0, sourceIdentity: "original" },
};
it("wires the actual Flip control to remembered presentation without dirtying the game", () => {
  const atoms = createStore();
  atoms.set(tabsAtom, [tab]);
  atoms.set(activeTabAtom, tab.value);
  const tree = createTreeStore();
  ownTabTree(tree, tab.value);
  const originalRoot = tree.getState().root;
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <MantineProvider>
          <Provider store={atoms}>
            <TreeStateContext.Provider value={tree}>
              <BoardControls editingMode={false} toggleEditingMode={() => {}} dirty={false} />
            </TreeStateContext.Provider>
          </Provider>
        </MantineProvider>,
      ),
    );
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Board.Action.FlipBoard"]',
    )!;
    expect(button).not.toBeNull();
    act(() => button.click());
    expect(tree.getState().headers.orientation).toBe("black");
    expect(tree.getState().dirty).toBe(false);
    expect(tree.getState().root).toBe(originalRoot);
    expect(loadFileBoardPreferences(file.path)?.orientation).toBe("black");
  } finally {
    act(() => root.unmount());
  }
});
it("wires Rename through source rebinding and preferences even when an optional sidecar move fails", async () => {
  const atoms = createStore();
  atoms.set(tabsAtom, [tab]);
  atoms.set(activeTabAtom, tab.value);
  saveFileBoardPreferences(file.path, { orientation: "black" });
  io.rename
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(new Error("Optional sidecar unavailable"));
  const onRenamed = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <MantineProvider>
          <Provider store={atoms}>
            <RenameModal
              opened
              setOpened={() => {}}
              entry={file}
              mutate={() => {}}
              setSelected={() => {}}
              onRenamed={onRenamed}
            />
          </Provider>
        </MantineProvider>,
      ),
    );
    const input = document.querySelector<HTMLInputElement>('input[value="Lesson"]')!;
    expect(input).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Changed",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(io.rename.mock.calls[0]).toEqual([file.path, "C:/Prep/Changed.pgn"]);
    expect(onRenamed).toHaveBeenCalledOnce();
    expect(atoms.get(tabsAtom)[0].gameOrigin).toMatchObject({
      sourceIdentity: "original",
      file: { path: "C:/Prep/Changed.pgn", name: "Changed" },
    });
    expect(loadFileBoardPreferences("C:/Prep/Changed.pgn")?.orientation).toBe("black");
    expect(loadFileBoardPreferences(file.path)).toBeUndefined();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
