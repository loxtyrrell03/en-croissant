import { createStore, type WritableAtom } from "jotai";
import { RESET } from "jotai/utils";
import {
  boardImageAtom,
  boardManualSizeAtom,
  boardStyleAtom,
  fontSizeAtom,
  pieceSetAtom,
} from "@/state/atoms";
import {
  readBufferedStorageItem,
  writeBufferedStorageItem,
} from "@/state/store/debouncedLocalStorage";
import { workspaceLayoutAtom } from "@/state/store/workspaceLayout";
import { DEFAULT_BOARD_STYLE } from "./boardStyle";

type Store = ReturnType<typeof createStore>;
// Exact presentation keys only. No prefixes, native mirrors, content or sessions.
export const APPEARANCE_RESET_KEYS = [
  "board-style",
  "piece-set",
  "board-image",
  "font-size",
  "board-manual-size",
  "boardWorkspaceLayout",
] as const;
type Key = (typeof APPEARANCE_RESET_KEYS)[number];
type Values = Record<Key, string | null>;
export const APPEARANCE_BACKUP_KEY = "en-croissant.appearance-reset.backup.v1";
type Backup = { version: 1; createdAt: string; values: Values };
export type AppearanceResetStatus = { backup: boolean; customized: boolean };

function binding<T>(
  key: Key,
  atom: WritableAtom<T, [T | ((previous: T) => T) | typeof RESET], unknown>,
  initial: T,
  valid: (value: unknown) => boolean,
) {
  return {
    key,
    apply: (store: Store, raw: string | null) => {
      let value = initial;
      if (raw !== null) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (valid(parsed)) value = parsed as T;
        } catch {
          /* Preserve unreadable raw bytes; runtime uses its default. */
        }
      }
      store.set(atom, value);
      // Also cancels a pending board/pane drag, and retains exact original bytes.
      writeBufferedStorageItem(key, raw);
    },
  };
}

const bindings = [
  binding(
    "board-style",
    boardStyleAtom,
    DEFAULT_BOARD_STYLE,
    (value) => value === "default" || value === "chess-com",
  ),
  binding("piece-set", pieceSetAtom, "staunty", (value) => typeof value === "string"),
  binding("board-image", boardImageAtom, "gray.svg", (value) => typeof value === "string"),
  binding(
    "font-size",
    fontSizeAtom,
    100,
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
  ),
  binding(
    "board-manual-size",
    boardManualSizeAtom,
    null,
    (value) =>
      value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0),
  ),
  binding(
    "boardWorkspaceLayout",
    workspaceLayoutAtom,
    { rightWidthPercent: 54, topRightHeight: null, bottomRightHeight: null },
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const layout = value as Record<string, unknown>;
      return (
        typeof layout.rightWidthPercent === "number" &&
        Number.isFinite(layout.rightWidthPercent) &&
        [layout.topRightHeight, layout.bottomRightHeight].every(
          (height) =>
            height === null ||
            (typeof height === "number" && Number.isFinite(height) && height >= 0),
        )
      );
    },
  ),
];

function readBackup(): Backup | null {
  const raw = localStorage.getItem(APPEARANCE_BACKUP_KEY);
  if (raw === null) return null;
  try {
    const b = JSON.parse(raw) as Backup;
    if (
      b?.version !== 1 ||
      typeof b.createdAt !== "string" ||
      !Number.isFinite(Date.parse(b.createdAt)) ||
      !b.values ||
      typeof b.values !== "object" ||
      Array.isArray(b.values) ||
      Object.keys(b.values).length !== APPEARANCE_RESET_KEYS.length ||
      APPEARANCE_RESET_KEYS.some(
        (key) =>
          !Object.hasOwn(b.values, key) ||
          (b.values[key] !== null && typeof b.values[key] !== "string"),
      )
    )
      throw Error();
    return b;
  } catch {
    throw new Error(
      "The appearance backup could not be read. It has been kept; no settings were changed.",
    );
  }
}

function snapshot(): Values {
  return Object.fromEntries(
    APPEARANCE_RESET_KEYS.map((key) => [key, readBufferedStorageItem(key)]),
  ) as Values;
}

export function createAppearanceReset(store: Store) {
  function apply(values: Values) {
    for (const entry of bindings) entry.apply(store, values[entry.key]);
    for (const key of APPEARANCE_RESET_KEYS)
      if (localStorage.getItem(key) !== values[key])
        throw new Error("Appearance settings could not be verified.");
  }
  return {
    status(): AppearanceResetStatus {
      const backup = readBackup();
      return {
        backup: !!backup,
        customized: Object.values(snapshot()).some((value) => value !== null),
      };
    },
    reset() {
      if (readBackup())
        throw new Error(
          "Restore the previous appearance or keep the current appearance before another reset.",
        );
      const values = snapshot();
      if (Object.values(values).every((value) => value === null)) return;
      const serialized = JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        values,
      } satisfies Backup);
      try {
        localStorage.setItem(APPEARANCE_BACKUP_KEY, serialized);
        if (localStorage.getItem(APPEARANCE_BACKUP_KEY) !== serialized) throw Error();
      } catch {
        throw new Error(
          "Could not save the undo copy. No appearance settings were changed. Free some space and retry.",
        );
      }
      try {
        apply(Object.fromEntries(APPEARANCE_RESET_KEYS.map((key) => [key, null])) as Values);
      } catch {
        // Each key is independent; keep trying even if one write remains denied.
        for (const entry of bindings) {
          try {
            entry.apply(store, values[entry.key]);
          } catch {
            /* The durable backup remains. */
          }
        }
        throw new Error(
          "The reset could not finish. Your previous appearance is backed up; choose Restore previous to retry.",
        );
      }
    },
    restore() {
      const backup = readBackup();
      if (!backup) throw new Error("No appearance backup is available.");
      try {
        apply(backup.values);
        localStorage.removeItem(APPEARANCE_BACKUP_KEY);
      } catch {
        throw new Error(
          "The restore could not finish. The undo copy is still saved; retry Restore previous.",
        );
      }
    },
    keep() {
      if (readBackup()) localStorage.removeItem(APPEARANCE_BACKUP_KEY);
    },
  };
}
