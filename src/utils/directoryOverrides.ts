const EPHEMERAL_DIRECTORY_MARKERS = ["/outpost-fork-parity-"];
const PARITY_ARCHIVED_FILE_SUFFIXES = [
  "/documents/encroissant/ifan prep",
  "/documents/encroissant/oxford fide congress u2300 player games",
];
const PARITY_FILE_VISIBILITY_RECOVERY_KEY = "parity-file-visibility-recovery-v1";

type DirectoryStorage = Pick<Storage, "getItem" | "removeItem">;

export function isEphemeralDirectoryOverride(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return EPHEMERAL_DIRECTORY_MARKERS.some((marker) => normalized.includes(marker));
}

export function readStoredDirectoryOverride(
  key: string,
  storage: DirectoryStorage | undefined =
    typeof localStorage === "undefined" ? undefined : localStorage,
): string | null {
  if (!storage) return null;

  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    if (typeof value !== "string" || value.length === 0) return null;

    // UI smoke tests run against the same localhost origin as the Tauri dev
    // shell. Never let one of their disposable directories become a durable
    // user setting and hide the real library on the next app launch.
    if (isEphemeralDirectoryOverride(value)) {
      storage.removeItem(key);
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

export function recoverParityTestArchivedFileEntries(
  storage: DirectoryStorage & Pick<Storage, "setItem"> = localStorage,
): string[] | null {
  if (storage.getItem(PARITY_FILE_VISIBILITY_RECOVERY_KEY) === "done") return null;

  try {
    const stored = JSON.parse(storage.getItem("archived-file-entries") ?? "[]");
    if (!Array.isArray(stored) || !stored.every((path) => typeof path === "string")) {
      storage.setItem(PARITY_FILE_VISIBILITY_RECOVERY_KEY, "done");
      return null;
    }

    const recovered = stored.filter((path) => {
      const normalized = path.replaceAll("\\", "/").toLowerCase().replace(/\/$/, "");
      return !PARITY_ARCHIVED_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
    });

    if (recovered.length !== stored.length) {
      storage.setItem("archived-file-entries", JSON.stringify(recovered));
    }
    storage.setItem(PARITY_FILE_VISIBILITY_RECOVERY_KEY, "done");
    return recovered;
  } catch {
    return null;
  }
}
