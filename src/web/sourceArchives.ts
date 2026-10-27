import type { WebCompanionState, WebDatabase } from "./model";
import type { WebHostedDatabaseFolder, WebHostedEntry } from "./hostedFiles";

export type SharedArchiveSnapshot = {
    version: 1;
    libraryId: string;
    revision: string;
    hostedPaths: string[];
    targets: Record<string, string>;
    collectionPaths?: Record<string, string>;
};
export type SharedArchiveChange = {
    requestId: string;
    path: string;
    archived: boolean;
    expected: string;
    libraryId: string;
};
export type PhoneSourceArchives = {
    databaseIds: string[];
    hostedPaths: string[];
    shared?: SharedArchiveSnapshot & { pending: SharedArchiveChange[] };
};
const pathKey = (path: string) => path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
const inside = (path: string, ancestor: string) =>
    path === ancestor || path.startsWith(`${ancestor}/`);

export function validPhoneSourceArchives(value: unknown): boolean {
    if (value === undefined) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const archives = value as Partial<PhoneSourceArchives>;
    return (
        [archives.databaseIds, archives.hostedPaths].every(
            (items) =>
                Array.isArray(items) &&
                items.every((item) => typeof item === "string" && item.length > 0),
        ) &&
        (archives.shared === undefined ||
            (validSharedArchiveSnapshot(archives.shared) &&
                Array.isArray(archives.shared.pending) &&
                archives.shared.pending.every(
                    (change) =>
                        change &&
                        typeof change === "object" &&
                        typeof change.requestId === "string" &&
                        typeof change.path === "string" &&
                        typeof change.archived === "boolean" &&
                        typeof change.expected === "string" &&
                        typeof change.libraryId === "string",
                )))
    );
}

export function validSharedArchiveSnapshot(value: unknown): value is SharedArchiveSnapshot {
    if (!value || typeof value !== "object") return false;
    const snapshot = value as Partial<SharedArchiveSnapshot>;
    return (
        snapshot.version === 1 &&
        typeof snapshot.libraryId === "string" &&
        typeof snapshot.revision === "string" &&
        Array.isArray(snapshot.hostedPaths) &&
        snapshot.hostedPaths.every((path) => typeof path === "string" && path.length > 0) &&
        Boolean(
            snapshot.targets &&
            typeof snapshot.targets === "object" &&
            !Array.isArray(snapshot.targets) &&
            Object.values(snapshot.targets).every((revision) => typeof revision === "string"),
        ) &&
        (snapshot.collectionPaths === undefined ||
            Boolean(
                snapshot.collectionPaths &&
                typeof snapshot.collectionPaths === "object" &&
                !Array.isArray(snapshot.collectionPaths) &&
                Object.values(snapshot.collectionPaths).every((path) => typeof path === "string"),
            ))
    );
}

export function receiveSharedArchives(
    state: WebCompanionState,
    snapshot: SharedArchiveSnapshot,
    acknowledged?: SharedArchiveChange,
): WebCompanionState {
    if (!validSharedArchiveSnapshot(snapshot) || snapshot.libraryId !== state.personalSyncId)
        throw Error("Shared archive labels could not be read. Existing labels are preserved.");
    const previous = state.sourceArchives ?? { databaseIds: [], hostedPaths: [] };
    const pending =
        previous.shared?.libraryId === snapshot.libraryId
            ? previous.shared.pending
                  .filter((change) => change.requestId !== acknowledged?.requestId)
                  .map((change) =>
                      acknowledged &&
                      change.path === acknowledged.path &&
                      change.expected === acknowledged.expected
                          ? {
                                ...change,
                                expected: snapshot.targets[change.path] ?? change.expected,
                            }
                          : change,
                  )
            : [];
    if (
        previous.shared?.revision === snapshot.revision &&
        previous.shared.pending.every((change, index) => change === pending[index]) &&
        previous.shared.pending.length === pending.length
    )
        return state;
    return { ...state, sourceArchives: { ...previous, shared: { ...snapshot, pending } } };
}

/** Hosted paths are virtual catalogue paths, with the same case semantics as
 * hostedFiles/databaseSync. Device-only collections keep their stable IDs. */
export function phoneHostedArchiveAncestor(
    state: Pick<WebCompanionState, "sourceArchives">,
    path: string,
): string | null {
    const key = pathKey(path);
    const shared = state.sourceArchives?.shared;
    if (shared && Object.hasOwn(shared.targets, key)) {
        return (
            shared.hostedPaths
                .filter((ancestor) => inside(key, pathKey(ancestor)))
                .sort((a, b) => b.length - a.length)[0] ?? null
        );
    }
    return (
        state.sourceArchives?.hostedPaths.find((ancestor) => inside(key, pathKey(ancestor))) ?? null
    );
}

export function phoneDatabaseArchivePath(
    state: Pick<WebCompanionState, "sourceArchives"> &
        Partial<Pick<WebCompanionState, "gamesByDatabase">>,
    database: WebDatabase,
): string | undefined {
    const hosted = database.hostedFilePath ?? database.hostedPath;
    if (hosted) return hosted;
    const game = state.gamesByDatabase?.[database.id]?.[0];
    const collection = game?.pgn.match(/\[PersonalSyncRef "database:([1-9]\d*):[1-9]\d*"\]/)?.[1];
    return collection ? state.sourceArchives?.shared?.collectionPaths?.[collection] : undefined;
}

export function phoneDatabaseArchive(
    state: Pick<WebCompanionState, "sourceArchives"> &
        Partial<Pick<WebCompanionState, "gamesByDatabase">>,
    database: WebDatabase,
): { path: string | null } | null {
    const path = phoneDatabaseArchivePath(state, database);
    const ancestor = path ? phoneHostedArchiveAncestor(state, path) : null;
    if (ancestor) return { path: ancestor };
    if (path && state.sourceArchives?.shared?.targets[path]) return null;
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
    if (previous.shared && Object.hasOwn(previous.shared.targets, key)) {
        const shared = previous.shared;
        const old = shared.pending.find((change) => change.path === key);
        if (old?.archived === archived && old.expected === shared.targets[key]) return state;
        const change: SharedArchiveChange = {
            requestId: crypto.randomUUID(),
            path: key,
            archived,
            expected: shared.targets[key],
            libraryId: shared.libraryId,
        };
        return {
            ...state,
            sourceArchives: {
                ...previous,
                shared: {
                    ...shared,
                    pending: [...shared.pending.filter((item) => item.path !== key), change],
                },
            },
        };
    }
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
    const path = phoneDatabaseArchivePath(state, database);
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
