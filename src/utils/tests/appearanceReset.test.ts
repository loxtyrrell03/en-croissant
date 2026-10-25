import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boardImageAtom,
  boardManualSizeAtom,
  boardStyleAtom,
  fontSizeAtom,
  pieceSetAtom,
} from "@/state/atoms";
import { atomWithDebouncedStorage } from "@/state/store/debouncedLocalStorage";
import { workspaceLayoutAtom } from "@/state/store/workspaceLayout";
import {
  APPEARANCE_BACKUP_KEY,
  APPEARANCE_RESET_KEYS,
  createAppearanceReset,
} from "../appearanceReset";

let store: ReturnType<typeof createStore>;
let unmount: (() => void)[] = [];
const original = {
  "board-style": '"chess-com"',
  "piece-set": '"alpha"',
  "board-image": '"wood.svg"',
  "font-size": " 130 ",
  "board-manual-size": "620",
  boardWorkspaceLayout:
    '{ "rightWidthPercent": 63, "topRightHeight": 280, "bottomRightHeight": 140 }',
};
function mount() {
  store = createStore();
  for (const atom of [
    boardStyleAtom,
    pieceSetAtom,
    boardImageAtom,
    fontSizeAtom,
    boardManualSizeAtom,
    workspaceLayoutAtom,
  ])
    unmount.push(store.sub(atom, () => {}));
  return createAppearanceReset(store);
}
function values() {
  return Object.fromEntries(APPEARANCE_RESET_KEYS.map((key) => [key, localStorage.getItem(key)]));
}
function backup() {
  return JSON.parse(localStorage.getItem(APPEARANCE_BACKUP_KEY)!);
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  for (const [key, value] of Object.entries(original)) localStorage.setItem(key, value);
  localStorage.setItem("sessions", "synthetic accounts");
  localStorage.setItem("daily-goal-history", "synthetic progress");
  localStorage.setItem("file-board-preferences", "synthetic source settings");
  sessionStorage.setItem("tabs", "synthetic unsaved annotated game");
});
afterEach(() => {
  for (const stop of unmount) stop();
  unmount = [];
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("recoverable native appearance reset", () => {
  it("updates the real atoms while retaining accounts, progress and the open workspace", () => {
    const reset = mount();
    reset.reset();
    expect(values()).toEqual(Object.fromEntries(APPEARANCE_RESET_KEYS.map((key) => [key, null])));
    expect(backup().values).toEqual(original);
    expect(store.get(fontSizeAtom)).toBe(100);
    expect(store.get(pieceSetAtom)).toBe("staunty");
    expect(store.get(boardImageAtom)).toBe("gray.svg");
    expect(store.get(boardManualSizeAtom)).toBeNull();
    expect(store.get(workspaceLayoutAtom)).toEqual({
      rightWidthPercent: 54,
      topRightHeight: null,
      bottomRightHeight: null,
    });
    expect(localStorage.getItem("sessions")).toBe("synthetic accounts");
    expect(localStorage.getItem("daily-goal-history")).toBe("synthetic progress");
    expect(localStorage.getItem("file-board-preferences")).toBe("synthetic source settings");
    expect(sessionStorage.getItem("tabs")).toBe("synthetic unsaved annotated game");
  });
  it("refuses to mutate preferences if the backup fails or cannot be read back", () => {
    const reset = mount();
    const write = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === APPEARANCE_BACKUP_KEY) throw new DOMException("Full", "QuotaExceededError");
      write.call(this, key, value);
    });
    expect(() => reset.reset()).toThrow("Could not save the undo copy");
    expect(values()).toEqual(original);
    expect(store.get(fontSizeAtom)).toBe(130);
    spy.mockImplementation(function (this: Storage, key, value) {
      if (key !== APPEARANCE_BACKUP_KEY) write.call(this, key, value);
    });
    expect(() => reset.reset()).toThrow("Could not save the undo copy");
    expect(values()).toEqual(original);
  });
  it("retains the undo record after a partial reset failure and recovers on retry", () => {
    const reset = mount();
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem")
      .mockImplementationOnce(function (this: Storage, key) {
        remove.call(this, key);
      })
      .mockImplementation(function (this: Storage, key) {
        if (key === "board-image") throw Error("Denied");
        remove.call(this, key);
      });
    expect(() => reset.reset()).toThrow("The reset could not finish");
    expect(backup().values).toEqual(original);
    expect(values()).toEqual(original);
    vi.restoreAllMocks();
    reset.restore();
    expect(values()).toEqual(original);
    expect(localStorage.getItem(APPEARANCE_BACKUP_KEY)).toBeNull();
  });
  it("snapshots pending board/pane drags and prevents their timers undoing a reset or restore", () => {
    const reset = mount();
    const other = atomWithDebouncedStorage("unrelated-drag", 0);
    store.set(boardManualSizeAtom, 701);
    store.set(workspaceLayoutAtom, {
      rightWidthPercent: 68,
      topRightHeight: null,
      bottomRightHeight: null,
    });
    store.set(other, 17);
    expect(localStorage.getItem("board-manual-size")).toBe("620");
    reset.reset();
    expect(backup().values["board-manual-size"]).toBe("701");
    vi.advanceTimersByTime(600);
    expect(localStorage.getItem("board-manual-size")).toBeNull();
    expect(localStorage.getItem("boardWorkspaceLayout")).toBeNull();
    expect(localStorage.getItem("unrelated-drag")).toBe("17");
    reset.restore();
    vi.advanceTimersByTime(600);
    expect(store.get(boardManualSizeAtom)).toBe(701);
    expect(localStorage.getItem("board-manual-size")).toBe("701");
    expect(store.get(workspaceLayoutAtom).rightWidthPercent).toBe(68);
  });
  it("keeps exact bytes, missing values and the backup across a failed remounted restore", () => {
    localStorage.removeItem("board-manual-size");
    const reset = mount();
    const saved = values();
    reset.reset();
    unmount.forEach((stop) => stop());
    unmount = [];
    const reopened = mount();
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "piece-set") throw Error("Denied");
      write.call(this, key, value);
    });
    expect(() => reopened.restore()).toThrow("The restore could not finish");
    expect(backup().values).toEqual(saved);
    vi.restoreAllMocks();
    reopened.restore();
    expect(values()).toEqual(saved);
    expect(store.get(boardManualSizeAtom)).toBeNull();
  });
  it("blocks an unreadable or unrecognized backup without clearing it or touching content", () => {
    const reset = mount();
    for (const raw of [
      "{ broken",
      JSON.stringify({ version: 2, values: original }),
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        values: { ...original, sessions: "injected" },
      }),
    ]) {
      localStorage.setItem(APPEARANCE_BACKUP_KEY, raw);
      expect(() => reset.reset()).toThrow("could not be read");
      expect(() => reset.restore()).toThrow("could not be read");
      expect(() => reset.keep()).toThrow("could not be read");
      expect(localStorage.getItem(APPEARANCE_BACKUP_KEY)).toBe(raw);
      expect(values()).toEqual(original);
      expect(localStorage.getItem("sessions")).toBe("synthetic accounts");
    }
  });
  it("preserves malformed original preference bytes while rendering safe defaults on restore", () => {
    localStorage.setItem("font-size", "{ broken");
    const reset = mount();
    reset.reset();
    reset.restore();
    expect(localStorage.getItem("font-size")).toBe("{ broken");
    expect(store.get(fontSizeAtom)).toBe(100);
  });
  it("requires resolving an existing backup, and Keep current changes only that backup", () => {
    const reset = mount();
    reset.reset();
    const first = localStorage.getItem(APPEARANCE_BACKUP_KEY);
    store.set(fontSizeAtom, 115);
    expect(() => reset.reset()).toThrow("before another reset");
    expect(localStorage.getItem(APPEARANCE_BACKUP_KEY)).toBe(first);
    reset.keep();
    expect(localStorage.getItem(APPEARANCE_BACKUP_KEY)).toBeNull();
    expect(store.get(fontSizeAtom)).toBe(115);
    expect(localStorage.getItem("font-size")).toBe("115");
  });
});
