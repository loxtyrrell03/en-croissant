import type { SyncStorage } from "jotai/vanilla/utils/atomWithStorage";

export function filePreferenceIdentity(path: string): string {
    let value = path.replaceAll("\\", "/");
    if (/^\/\/\?\/unc\//i.test(value)) value = `//${value.slice(8)}`;
    else if (value.startsWith("//?/")) value = value.slice(4);
    return /^[a-z]:\//i.test(value) || value.startsWith("//") ? value.toLowerCase() : value;
}

export function workspacePreferenceKey(key: string): string {
    return key.startsWith("database:") ? key : filePreferenceIdentity(key);
}

export function findWorkspacePreference<T>(
    values: Record<string, T>,
    key: string | null,
): T | undefined {
    if (!key || !values || typeof values !== "object") return undefined;
    const canonical = workspacePreferenceKey(key);
    if (Object.hasOwn(values, canonical)) return values[canonical];
    return Object.entries(values).find(([old]) => workspacePreferenceKey(old) === canonical)?.[1];
}

export function setWorkspacePreference<T>(
    values: Record<string, T>,
    key: string,
    value: T,
): Record<string, T> {
    const canonical = workspacePreferenceKey(key);
    return {
        ...Object.fromEntries(
            Object.entries(values).filter(([old]) => workspacePreferenceKey(old) !== canonical),
        ),
        [canonical]: value,
    };
}

const DATABASE_SCOPE_SUFFIX = "::under-board-database";
export function moveWorkspacePreferences<T>(
    values: Record<string, T>,
    from: string,
    to: string,
    directory: boolean,
): Record<string, T> {
    const oldPath = filePreferenceIdentity(from),
        newPath = filePreferenceIdentity(to);
    const moved = Object.entries(values).flatMap(([key, value]) => {
        if (key.startsWith("database:")) return [];
        const suffix = key.endsWith(DATABASE_SCOPE_SUFFIX) ? DATABASE_SCOPE_SUFFIX : "";
        const path = filePreferenceIdentity(suffix ? key.slice(0, -suffix.length) : key);
        if (path !== oldPath && !(directory && path.startsWith(`${oldPath}/`))) return [];
        return [{ old: key, key: `${newPath}${path.slice(oldPath.length)}${suffix}`, value }];
    });
    if (!moved.length || moved.every((entry) => entry.old === entry.key)) return values;
    const result = { ...values };
    for (const entry of moved) delete result[entry.old];
    for (const entry of moved) result[entry.key] = entry.value;
    return result;
}

export function readPreferenceMap<T>(key: string): Record<string, T> {
    const raw = localStorage.getItem(key);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.values(parsed).some(
            (entry) => !entry || typeof entry !== "object" || Array.isArray(entry),
        )
    )
        throw new Error("Saved board preferences are invalid. They have been preserved.");
    return parsed as Record<string, T>;
}

/** Read synchronously before panel hydration, and never overwrite corrupt data. */
export function workspacePreferenceStorage<T>(
    onError: (error: unknown) => void,
): SyncStorage<Record<string, T>> {
    return {
        getItem(key, initial) {
            try {
                return readPreferenceMap<T>(key);
            } catch (error) {
                queueMicrotask(() => onError(error));
                return initial;
            }
        },
        setItem(key, value) {
            readPreferenceMap<T>(key);
            localStorage.setItem(key, JSON.stringify(value));
        },
        removeItem(key) {
            localStorage.removeItem(key);
        },
        subscribe(key, callback, initial) {
            const listener = (event: StorageEvent) => {
                if (event.key === key && (!event.storageArea || event.storageArea === localStorage))
                    callback(this.getItem(key, initial));
            };
            window.addEventListener("storage", listener);
            return () => window.removeEventListener("storage", listener);
        },
    };
}
