import { makePgn, parsePgn } from "chessops/pgn";
import type { WebCompanionState, WebGame } from "./model";
import { parsePgnDatabase } from "./pgn";
import { getWebServerUrl } from "./serverUrl";
import { savePersonalSyncRecovery } from "./storage";
import { webStateSession } from "./webStateSession";
import { clearHostedWebLibraryCache } from "./hostedFiles";
import { receiveSharedArchives, type SharedArchiveSnapshot } from "./sourceArchives";

export const PERSONAL_LIBRARY_CHANGED = "personal-chess-library-changed";
export type PersonalSyncStatus = {
    enabled: boolean;
    id?: string;
    revision?: string;
    phase?: string;
    lastSuccess?: string | null;
    conflicts?: { reason?: string; path?: string }[];
    errors?: { error: string }[];
    message?: string;
    pending?: number;
    updateAvailable?: boolean;
    archives?: SharedArchiveSnapshot;
    archivePending?: number;
    archiveConflict?: boolean;
};
type Saved = { ref: string; revision: string; pgn: string };
export function syncMetadata(pgn: string) {
    const game = parsePgn(pgn)[0];
    if (!game) return null;
    const ref = game.headers.get("PersonalSyncRef"),
        revision = game.headers.get("PersonalSyncRevision"),
        base = game.headers.get("PersonalSyncBase");
    if (!ref || !revision || !base) return null;
    for (const key of game.headers.keys())
        if (key.startsWith("PersonalSync")) game.headers.delete(key);
    return { ref, revision, base, body: makePgn(game) };
}
async function sha256(value: string) {
    return [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
}
export async function hasPersonalChanges(pgn: string) {
    const meta = syncMetadata(pgn);
    return Boolean(meta && (await sha256(meta.body)) !== meta.base);
}
function replaceGame(state: WebCompanionState, id: string, databaseId: string, pgn: string) {
    const old = state.gamesByDatabase[databaseId]?.find((g) => g.id === id);
    if (!old) return state;
    const parsed = parsePgnDatabase(old.databaseName, pgn, old.importedAt).games[0];
    if (!parsed) throw Error("The updated shared game could not be read.");
    const game = {
        ...parsed,
        id: old.id,
        index: old.index,
        databaseId: old.databaseId,
        databaseName: old.databaseName,
    };
    return {
        ...state,
        gamesByDatabase: {
            ...state.gamesByDatabase,
            [databaseId]: state.gamesByDatabase[databaseId].map((g) => (g.id === id ? game : g)),
        },
    };
}
export function acknowledgePersonalSave(
    state: WebCompanionState,
    requested: WebGame,
    saved: Saved,
) {
    const current = state.gamesByDatabase[requested.databaseId]?.find((g) => g.id === requested.id);
    if (!current) return state;
    const metadata = syncMetadata(current.pgn);
    if (metadata?.ref !== saved.ref) return state;
    if (current.pgn === requested.pgn)
        return replaceGame(state, current.id, current.databaseId, saved.pgn);
    // An annotation made while the request was in flight keeps its content,
    // and gets the acknowledged revision so the next save is checked against it.
    const parsed = parsePgn(current.pgn)[0],
        ack = parsePgn(saved.pgn)[0];
    parsed.headers.set("PersonalSyncRevision", saved.revision);
    parsed.headers.set("PersonalSyncBase", ack.headers.get("PersonalSyncBase")!);
    return replaceGame(state, current.id, current.databaseId, makePgn(parsed));
}
async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(getWebServerUrl(`api/personal-sync/${path}`), {
        method: body === undefined ? "GET" : "PUT",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const value = await response.json();
    if (!response.ok)
        throw Object.assign(Error(value.error ?? "Shared library is temporarily unavailable."), {
            status: response.status,
        });
    return value;
}
type Session = Pick<typeof webStateSession, "getSnapshot" | "setState" | "flush">;
export function createPersonalSync({
    session = webStateSession,
    read = request,
    backup = savePersonalSyncRecovery,
    publish = (_status: PersonalSyncStatus) => {},
}: {
    session?: Session;
    read?: typeof request;
    backup?: typeof savePersonalSyncRecovery;
    publish?: (status: PersonalSyncStatus) => void;
} = {}) {
    let running: Promise<void> | null = null,
        stopped = false,
        cursor = 0,
        lastRevision = "";
    const checked = new Map<string, string>();
    const tick = () =>
        running ??
        (running = (async () => {
            const snapshot = session.getSnapshot();
            if (!snapshot.loaded || stopped) return;
            let status: PersonalSyncStatus = { enabled: Boolean(snapshot.state.personalSyncId) };
            try {
                status = await read<PersonalSyncStatus>("status");
                if (stopped) return;
                if (!status.enabled) {
                    publish(status);
                    return;
                }
                if (!status.id) throw Error("Shared library identity is missing.");
                if (status.revision && status.revision !== lastRevision) {
                    lastRevision = status.revision;
                    clearHostedWebLibraryCache();
                    window.dispatchEvent(new Event(PERSONAL_LIBRARY_CHANGED));
                }
                if (snapshot.state.personalSyncId !== status.id) {
                    await session.flush();
                    if (stopped) return;
                    await backup(status.id, snapshot.state);
                    if (stopped) return;
                    const oldIds = snapshot.state.databases
                        .filter(
                            (d) =>
                                !(snapshot.state.gamesByDatabase[d.id] ?? []).some((g) =>
                                    syncMetadata(g.pgn),
                                ),
                        )
                        .map((d) => d.id);
                    session.setState((current) => ({
                        ...current,
                        personalSyncId: status.id,
                        sourceArchives: {
                            hostedPaths: current.sourceArchives?.hostedPaths ?? [],
                            databaseIds: [
                                ...new Set([
                                    ...(current.sourceArchives?.databaseIds ?? []),
                                    ...oldIds,
                                ]),
                            ],
                        },
                    }));
                    await session.flush();
                }
                if (stopped) return;
                if (status.archives) {
                    session.setState((current) => receiveSharedArchives(current, status.archives!));
                    for (const change of session.getSnapshot().state.sourceArchives?.shared
                        ?.pending ?? []) {
                        if (stopped) return;
                        await session.flush();
                        if (stopped) return;
                        const owned = session
                            .getSnapshot()
                            .state.sourceArchives?.shared?.pending.find(
                                (current) =>
                                    current.requestId === change.requestId &&
                                    current.libraryId === status.id,
                            );
                        if (!owned) continue;
                        publish({
                            ...status,
                            phase: "syncing",
                            pending:
                                session.getSnapshot().state.sourceArchives?.shared?.pending.length,
                        });
                        const saved = await read<SharedArchiveSnapshot>("archive", owned);
                        if (stopped) return;
                        session.setState((current) => receiveSharedArchives(current, saved, owned));
                        await session.flush();
                    }
                }
                const beforeImport = session.getSnapshot().state;
                for (const database of beforeImport.databases) {
                    const games = beforeImport.gamesByDatabase[database.id] ?? [];
                    if (
                        database.hostedPath ||
                        database.hostedFilePath ||
                        database.sourceKind === "opened-file" ||
                        beforeImport.sourceArchives?.databaseIds.includes(database.id) ||
                        !games.length ||
                        games.some((g) => syncMetadata(g.pgn))
                    )
                        continue;
                    await session.flush();
                    publish({ ...status, phase: "syncing", pending: games.length });
                    const result = await read<{ collection: number; name: string; games: Saved[] }>(
                        "import",
                        {
                            clientId: database.id,
                            name: database.name,
                            pgn: games.map((g) => g.pgn).join("\n\n"),
                        },
                    );
                    if (result.games.length !== games.length)
                        throw Error("The shared import count differs; the phone copy was kept.");
                    session.setState((state) => {
                        let next = state;
                        for (const [index, original] of games.entries()) {
                            const current = next.gamesByDatabase[database.id]?.find(
                                (g) => g.id === original.id,
                            );
                            if (!current) continue;
                            // Preserve an annotation added while the initial import
                            // was running, then send it through the checked writer.
                            const linked = parsePgn(current.pgn)[0],
                                saved = parsePgn(result.games[index].pgn)[0];
                            for (const key of [
                                "PersonalSyncRef",
                                "PersonalSyncRevision",
                                "PersonalSyncBase",
                            ])
                                linked.headers.set(key, saved.headers.get(key)!);
                            next = replaceGame(next, current.id, database.id, makePgn(linked));
                        }
                        return next;
                    });
                    await session.flush();
                }
                const games = Object.values(session.getSnapshot().state.gamesByDatabase).flat();
                const linked: WebGame[] = [];
                let pending = 0;
                for (const game of games) {
                    if (stopped) return;
                    const meta = syncMetadata(game.pgn);
                    if (!meta) continue;
                    linked.push(game);
                    if (checked.get(game.id) === game.pgn) continue;
                    if (!(await hasPersonalChanges(game.pgn))) {
                        checked.set(game.id, game.pgn);
                        continue;
                    }
                    pending++;
                    publish({ ...status, phase: "syncing", pending });
                    await session.flush();
                    const saved = await read<Saved>("game", {
                        ref: meta.ref,
                        revision: meta.revision,
                        pgn: game.pgn,
                    });
                    if (stopped) return;
                    session.setState((current) => acknowledgePersonalSave(current, game, saved));
                    await session.flush();
                }
                // Refresh a bounded number of cached games. An open board keeps its
                // snapshot and analysis; reopening it loads the updated saved game.
                let updateAvailable = false;
                for (let i = 0; i < Math.min(8, linked.length); i++) {
                    const old = linked[(cursor + i) % linked.length],
                        current = session
                            .getSnapshot()
                            .state.gamesByDatabase[old.databaseId]?.find((g) => g.id === old.id);
                    if (!current || (await hasPersonalChanges(current.pgn))) continue;
                    const meta = syncMetadata(current.pgn)!;
                    const saved = await read<Saved>(`game?ref=${encodeURIComponent(meta.ref)}`);
                    if (saved.revision === meta.revision) continue;
                    session.setState((state) => {
                        const latest = state.gamesByDatabase[current.databaseId]?.find(
                            (g) => g.id === current.id,
                        );
                        if (latest?.pgn !== current.pgn) return state;
                        if (
                            state.board.sourceGameId === current.id &&
                            state.board.sourceDatabaseId === current.databaseId
                        ) {
                            updateAvailable = true;
                            return state;
                        }
                        return replaceGame(state, current.id, current.databaseId, saved.pgn);
                    });
                }
                cursor += 8;
                publish({ ...status, pending: 0, updateAvailable });
            } catch (error) {
                publish({
                    ...status,
                    enabled: status.enabled || Boolean(session.getSnapshot().state.personalSyncId),
                    phase: "attention",
                    archivePending:
                        session.getSnapshot().state.sourceArchives?.shared?.pending.length ?? 0,
                    archiveConflict: (error as { status?: number })?.status === 409,
                    message:
                        error instanceof Error
                            ? error.message
                            : "Shared library is offline. Changes remain saved on this phone.",
                });
            }
        })().finally(() => {
            running = null;
        }));
    return {
        tick,
        async resolveArchives(usePhone: boolean) {
            if (stopped) return;
            try {
                session.setState((state) => {
                    const archives = state.sourceArchives,
                        shared = archives?.shared;
                    if (!archives || !shared) return state;
                    const pending = usePhone
                        ? shared.pending.map((change) => ({
                              ...change,
                              expected: shared.targets[change.path] ?? change.expected,
                          }))
                        : [];
                    return {
                        ...state,
                        sourceArchives: { ...archives, shared: { ...shared, pending } },
                    };
                });
                await session.flush();
                await tick();
            } catch (error) {
                if (!stopped)
                    publish({
                        enabled: Boolean(session.getSnapshot().state.personalSyncId),
                        phase: "attention",
                        archivePending:
                            session.getSnapshot().state.sourceArchives?.shared?.pending.length ?? 0,
                        message:
                            error instanceof Error
                                ? error.message
                                : "Archive choices could not be saved. Retry sync.",
                    });
            }
        },
        stop() {
            stopped = true;
        },
    };
}
