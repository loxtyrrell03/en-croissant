import type { WebCompanionState, WebDatabase } from "./model";
import type { WebHostedDatabaseFolder, WebHostedEntry } from "./hostedFiles";

export type PhoneSourceArchives = { databaseIds: string[]; hostedPaths: string[] };
const pathKey = (path: string) => path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
const inside = (path: string, ancestor: string) =>
    path === ancestor || path.startsWith(`${ancestor}/`);

export function validPhoneSourceArchives(value: unknown): boolean {
    if (value === undefined) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const archives = value as Partial<PhoneSourceArchives>;
    return [archives.databaseIds, archives.hostedPaths].every(
        (items) =>
            Array.isArray(items) &&
            items.every((item) => typeof item === "string" && item.length > 0),
    );
}

/** Hosted paths are virtual catalogue paths, with the same case semantics as
 * hostedFiles/databaseSync. Device-only collections keep their stable IDs. */
export function phoneHostedArchiveAncestor(
    state: Pick<WebCompanionState, "sourceArchives">,
    path: string,
): string | null {
    const key = pathKey(path);
    return (
        state.sourceArchives?.hostedPaths.find((ancestor) => inside(key, pathKey(ancestor))) ?? null
    );
}

export function phoneDatabaseArchive(
    state: Pick<WebCompanionState, "sourceArchives">,
    database: WebDatabase,
): { path: string | null } | null {
    const path = database.hostedFilePath ?? database.hostedPath;
    const ancestor = path ? phoneHostedArchiveAncestor(state, path) : null;
    if (ancestor) return { path: ancestor };
    return state.sourceArchives?.databaseIds.includes(database.id) ? { path: null } : null;
}

export function setPhoneHostedArchived(
    state: WebCompanionState,
    path: string,
    archived: boolean,
): WebCompanionState {
    const key = pathKey(path);
    if (!key) return state;
    const previous = state.sourceArchives ?? { databaseIds: [], hostedPaths: [] };
    const present = previous.hostedPaths.some((item) => pathKey(item) === key);
    if (present === archived) return state;
    const hostedPaths = previous.hostedPaths.filter((item) => pathKey(item) !== key);
    if (archived) hostedPaths.push(key);
    return { ...state, sourceArchives: { ...previous, hostedPaths } };
}

export function setPhoneDatabaseArchived(
    state: WebCompanionState,
    database: WebDatabase,
    archived: boolean,
): WebCompanionState {
    const path = database.hostedFilePath ?? database.hostedPath;
    if (path) return setPhoneHostedArchived(state, path, archived);
    if (!state.databases.some((item) => item.id === database.id)) return state;
    const previous = state.sourceArchives ?? { databaseIds: [], hostedPaths: [] };
    const present = previous.databaseIds.includes(database.id);
    if (present === archived) return state;
    const databaseIds = previous.databaseIds.filter((item) => item !== database.id);
    if (archived) databaseIds.push(database.id);
    return { ...state, sourceArchives: { ...previous, databaseIds } };
}

export function phoneVisibleDatabases(
    state: Pick<WebCompanionState, "databases" | "sourceArchives">,
    keepIds: readonly string[] = [],
) {
    return state.databases.filter(
        (database) => keepIds.includes(database.id) || !phoneDatabaseArchive(state, database),
    );
}

export function phoneVisibleHostedFolders(
    state: Pick<WebCompanionState, "sourceArchives">,
    folders: WebHostedDatabaseFolder[],
    keepPaths: readonly string[] = [],
) {
    return folders.filter(
        (folder) =>
            keepPaths.some((path) => pathKey(path) === pathKey(folder.path)) ||
            !phoneHostedArchiveAncestor(state, folder.path),
    );
}

/** Keep ancestor directories navigable when showing archived descendants. */
export function phoneHostedEntries(
    state: WebCompanionState,
    entries: WebHostedEntry[],
    showArchived: boolean,
) {
    return showArchived
        ? entries
        : entries.filter((entry) => !phoneHostedArchiveAncestor(state, entry.path));
}
