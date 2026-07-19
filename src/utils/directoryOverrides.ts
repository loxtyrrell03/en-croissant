const EPHEMERAL_DIRECTORY_MARKERS = ["/outpost-fork-parity-"];

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
