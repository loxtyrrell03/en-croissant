// @vitest-environment jsdom
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { createEmptyWebState } from "../storage";
import { createWebStateSession } from "../webStateSession";
import { createPersonalSync, type PersonalSyncStatus } from "../personalSync";
import {
    phoneDatabaseArchive,
    phoneHostedArchiveAncestor,
    receiveSharedArchives,
    setPhoneHostedArchived,
    validPhoneSourceArchives,
    type SharedArchiveSnapshot,
} from "../sourceArchives";
import { parsePgnDatabase } from "../pgn";

const snapshot = (archived = false): SharedArchiveSnapshot => ({
    version: 1,
    libraryId: "shared",
    revision: archived ? "two" : "one",
    hostedPaths: archived ? ["Folder"] : [],
    targets: { Folder: archived ? "yes" : "no", "Folder/game.pgn": "no" },
});

test("a superseded queued archive command cannot run after an earlier request finishes", async () => {
    const remote = { ...snapshot(), revision: "two-targets", targets: { A: "no", B: "no" } };
    let durable = receiveSharedArchives(
        { ...createEmptyWebState(), personalSyncId: "shared" },
        remote,
    );
    durable = setPhoneHostedArchived(setPhoneHostedArchived(durable, "A", true), "B", true);
    const session = createWebStateSession({
        load: async () => durable,
        save: async (value) => {
            durable = value;
        },
    });
    await session.load();
    const sent: string[] = [];
    const sync = createPersonalSync({
        session,
        read: async <T>(url: string, body?: unknown) => {
            if (url === "status") return { enabled: true, id: "shared", archives: remote } as T;
            const change = body as { path: string };
            sent.push(change.path);
            if (change.path === "A") session.setState((s) => setPhoneHostedArchived(s, "B", false));
            return {
                ...remote,
                revision: "after-A",
                hostedPaths: ["A"],
                targets: { A: "yes", B: "no" },
            } as T;
        },
    });
    await sync.tick();
    expect(sent).toEqual(["A"]);
    expect(durable.sourceArchives?.shared?.pending).toHaveLength(1);
    expect(durable.sourceArchives?.shared?.pending[0].archived).toBe(false);
    sync.stop();
});

test("a late status reply cannot adopt shared archive state after the coordinator stops", async () => {
    let resolve!: (value: PersonalSyncStatus) => void;
    const response = new Promise<PersonalSyncStatus>((done) => {
        resolve = done;
    });
    const initial = createEmptyWebState();
    const session = createWebStateSession({ load: async () => initial, save: async () => {} });
    await session.load();
    const backup = vi.fn(async () => {});
    const sync = createPersonalSync({
        session,
        backup,
        read: async <T>() => (await response) as T,
    });
    const running = sync.tick();
    sync.stop();
    resolve({ enabled: true, id: "shared", archives: snapshot() });
    await running;
    expect(session.getSnapshot().state).toBe(initial);
    expect(backup).not.toHaveBeenCalled();
});
function state() {
    return receiveSharedArchives(
        {
            ...createEmptyWebState(),
            personalSyncId: "shared",
            sourceArchives: { hostedPaths: ["Folder", "Reference"], databaseIds: ["old-phone"] },
        },
        snapshot(),
    );
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

test("desktop labels own shared paths while legacy phone and reference archives remain local", () => {
    let current = state();
    expect(phoneHostedArchiveAncestor(current, "Folder/game.pgn")).toBeNull();
    expect(phoneHostedArchiveAncestor(current, "Reference/a.pgn")).toBe("Reference");
    current = receiveSharedArchives(current, snapshot(true));
    expect(phoneHostedArchiveAncestor(current, "Folder/game.pgn")).toBe("Folder");
    expect(current.sourceArchives?.databaseIds).toEqual(["old-phone"]);
    expect(receiveSharedArchives(current, snapshot(true))).toBe(current);
    expect(validPhoneSourceArchives(current.sourceArchives)).toBe(true);
});

test("a newly listed child inherits its shared archived folder before the next snapshot", () => {
    const current = receiveSharedArchives(state(), snapshot(true));
    expect(phoneHostedArchiveAncestor(current, "Folder/new/sub/game.pgn")).toBe("Folder");
    expect(phoneHostedArchiveAncestor(current, "Folders/new.pgn")).toBeNull();
});

test("shared changes are durable requests and acknowledgements cannot erase a newer edit", () => {
    let current = setPhoneHostedArchived(state(), "Folder", true);
    const first = current.sourceArchives!.shared!.pending[0];
    expect(phoneHostedArchiveAncestor(current, "Folder")).toBeNull();
    current = setPhoneHostedArchived(current, "Folder", false);
    current = receiveSharedArchives(current, snapshot(true), first);
    const newer = current.sourceArchives!.shared!.pending[0];
    expect(newer.archived).toBe(false);
    expect(newer.expected).toBe("yes");
    expect(newer.requestId).not.toBe(first.requestId);
    current = receiveSharedArchives(current, snapshot(), newer);
    expect(current.sourceArchives?.shared?.pending).toHaveLength(0);
    expect(phoneHostedArchiveAncestor(current, "Folder")).toBeNull();
});

test("offline archive writes keep their command and retry after saving state", async () => {
    let durable = state();
    const session = createWebStateSession({
        load: async () => durable,
        save: async (value) => {
            durable = value;
        },
    });
    await session.load();
    session.setState((s) => setPhoneHostedArchived(s, "Folder", true));
    let online = false,
        last: PersonalSyncStatus = { enabled: false };
    const writes: unknown[] = [];
    const sync = createPersonalSync({
        session,
        publish: (value) => {
            last = value;
        },
        read: async <T>(url: string, body?: unknown) => {
            if (url === "status") return { enabled: true, id: "shared", archives: snapshot() } as T;
            expect(durable.sourceArchives?.shared?.pending).toHaveLength(1);
            writes.push(body);
            if (!online) throw Error("offline");
            return snapshot(true) as T;
        },
    });
    await sync.tick();
    expect(last.message).toBe("offline");
    expect(durable.sourceArchives?.shared?.pending).toHaveLength(1);
    online = true;
    await sync.tick();
    expect(durable.sourceArchives?.shared?.pending).toHaveLength(0);
    expect(phoneHostedArchiveAncestor(durable, "Folder/game.pgn")).toBe("Folder");
    expect(writes).toHaveLength(2);
    sync.stop();
});

test("invalid or wrong-library archive replies cannot change existing labels", () => {
    const current = state();
    expect(() => receiveSharedArchives(current, { ...snapshot(), libraryId: "other" })).toThrow(
        /preserved/,
    );
    expect(
        validPhoneSourceArchives({
            ...current.sourceArchives,
            shared: { ...snapshot(), pending: [null] },
        }),
    ).toBe(false);
    expect(
        validPhoneSourceArchives({
            ...current.sourceArchives,
            shared: { ...snapshot(), targets: [], pending: [] },
        }),
    ).toBe(false);
});

test("freshly linked phone imports use their shared collection labels and ignore stale local flags", () => {
    const imported = parsePgnDatabase(
        "New import",
        '[PersonalSyncRef "database:7:8"]\n\n1. e4 *',
        1,
    );
    const current = {
        ...state(),
        databases: [imported.database],
        gamesByDatabase: { [imported.database.id]: imported.games },
    };
    const shared = { ...snapshot(), targets: { Folder: "no" }, collectionPaths: { "7": "Folder" } };
    let next = receiveSharedArchives(current, { ...shared, revision: "linked" });
    next = {
        ...next,
        sourceArchives: { ...next.sourceArchives!, databaseIds: [imported.database.id] },
    };
    expect(phoneDatabaseArchive(next, imported.database)).toBeNull();
    next = receiveSharedArchives(next, {
        ...shared,
        revision: "archived",
        hostedPaths: ["Folder"],
    });
    expect(phoneDatabaseArchive(next, imported.database)).toEqual({ path: "Folder" });
});

test("explicit PC-label restoration clears only archive commands, preserving games and local archives", async () => {
    let durable = setPhoneHostedArchived(state(), "Folder", true);
    const session = createWebStateSession({
        load: async () => durable,
        save: async (value) => {
            durable = value;
        },
    });
    await session.load();
    let status: PersonalSyncStatus = { enabled: false };
    const sync = createPersonalSync({
        session,
        publish: (value) => {
            status = value;
        },
        read: async <T>(url: string) => {
            if (url === "status")
                return { enabled: true, id: "shared", archives: snapshot(true) } as T;
            throw Object.assign(Error("changed on the PC"), { status: 409 });
        },
    });
    await sync.tick();
    expect(status.archiveConflict).toBe(true);
    await sync.resolveArchives(false);
    expect(durable.sourceArchives?.shared?.pending).toHaveLength(0);
    expect(durable.sourceArchives?.hostedPaths).toEqual(["Folder", "Reference"]);
    expect(phoneHostedArchiveAncestor(durable, "Folder")).toBe("Folder");
    sync.stop();
});
