import { expect, it } from "vitest";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase } from "../pgn";
import { mergeImportedWebDatabases } from "../databaseSync";
import {
    phoneDatabaseArchive,
    phoneHostedArchiveAncestor,
    phoneHostedEntries,
    phoneVisibleDatabases,
    phoneVisibleHostedFolders,
    setPhoneDatabaseArchived,
    setPhoneHostedArchived,
    validPhoneSourceArchives,
} from "../sourceArchives";
import {
    setPhoneDatabasePreference,
    phoneWorkspaceKey,
    phoneWorkspaceOwner,
} from "../workspacePreferences";

function fixture() {
    const first = parsePgnDatabase("Invented Alpha", "1. e4 e5 *", 1);
    const second = parsePgnDatabase("Invented Beta", "1. d4 d5 *", 2);
    const state = {
        ...createEmptyWebState(),
        databases: [first.database, second.database],
        gamesByDatabase: { [first.database.id]: first.games, [second.database.id]: second.games },
    };
    return { state, first, second };
}

it("reversibly hides a device collection without changing games, workspace choices or the board", () => {
    const { state, first, second } = fixture();
    const archived = setPhoneDatabaseArchived(state, first.database, true);
    expect(phoneVisibleDatabases(archived)).toEqual([second.database]);
    expect(phoneVisibleDatabases(archived, [first.database.id])).toEqual(state.databases);
    expect(archived.databases).toBe(state.databases);
    expect(archived.gamesByDatabase).toBe(state.gamesByDatabase);
    expect(archived.board).toBe(state.board);
    expect(archived.prepWorkspaces).toBe(state.prepWorkspaces);
    expect(setPhoneDatabaseArchived(archived, first.database, true)).toBe(archived);
    const restored = setPhoneDatabaseArchived(archived, first.database, false);
    expect(phoneVisibleDatabases(restored)).toEqual(state.databases);
    expect(setPhoneDatabaseArchived(restored, { ...first.database, id: "gone" }, true)).toBe(
        restored,
    );
});

it("matches hosted folder boundaries and keeps explicit child labels when its parent is restored", () => {
    const { state } = fixture();
    const child = setPhoneHostedArchived(state, "Databases/Lesson/one.pgn", true);
    const archived = setPhoneHostedArchived(child, "Databases\\Lesson\\", true);
    expect(phoneHostedArchiveAncestor(archived, "Databases/Lesson/sub/two.pgn")).toBe(
        "Databases/Lesson",
    );
    expect(phoneHostedArchiveAncestor(archived, "Databases/Lessons/one.pgn")).toBeNull();
    expect(phoneHostedArchiveAncestor(archived, "Databases/lesson/one.pgn")).toBeNull();
    const restored = setPhoneHostedArchived(archived, "Databases/Lesson", false);
    expect(phoneHostedArchiveAncestor(restored, "Databases/Lesson/one.pgn")).toBe(
        "Databases/Lesson/one.pgn",
    );
    expect(phoneHostedArchiveAncestor(restored, "Databases/Lesson/sub/two.pgn")).toBeNull();
    expect(setPhoneHostedArchived(state, "", true)).toBe(state);
});

it("keeps hosted archive identity through collection refresh and retains only the explicitly chosen source", () => {
    const { state, first, second } = fixture();
    first.database.hostedPath = "Databases/Prep/Alpha";
    second.database.hostedPath = "Databases/Prep/Beta";
    const archived = setPhoneDatabaseArchived(state, first.database, true);
    const replacement = {
        ...first,
        database: { ...first.database, id: "refreshed" },
        games: first.games.map((game, index) => ({
            ...game,
            databaseId: "refreshed",
            id: `refreshed:${index}`,
        })),
    };
    const refreshed = mergeImportedWebDatabases(archived, [replacement]);
    expect(phoneDatabaseArchive(refreshed, replacement.database)).toEqual({
        path: first.database.hostedPath,
    });
    expect(phoneVisibleDatabases(refreshed).map((database) => database.id)).toEqual([
        second.database.id,
    ]);
    expect(phoneVisibleDatabases(refreshed, ["refreshed"]).map((database) => database.id)).toEqual([
        "refreshed",
        second.database.id,
    ]);
    const folders = [first, second].map((item) => ({
        path: item.database.hostedPath!,
        name: item.database.name,
        label: item.database.name,
        fileCount: 1,
        sizeBytes: 20,
        lastModified: 1,
    }));
    expect(phoneVisibleHostedFolders(refreshed, folders)).toEqual([folders[1]]);
    expect(phoneVisibleHostedFolders(refreshed, folders, [folders[0].path])).toEqual(folders);
    expect(setPhoneDatabaseArchived(refreshed, replacement.database, false).gamesByDatabase).toBe(
        refreshed.gamesByDatabase,
    );
});

it("restores only the requested marker and keeps archived catalogue entries accessible", () => {
    const { state, first } = fixture();
    first.database.hostedFilePath = "Databases/Prep/one.pgn";
    const archived = setPhoneHostedArchived(state, "Databases/Prep", true);
    expect(setPhoneDatabaseArchived(archived, first.database, false)).toBe(archived);
    const entry = {
        type: "file" as const,
        extension: "pgn" as const,
        name: "One",
        filename: "one.pgn",
        path: first.database.hostedFilePath,
        url: "one.pgn",
        lastModified: 1,
        sizeBytes: 20,
    };
    expect(phoneHostedEntries(archived, [entry], false)).toEqual([]);
    expect(phoneHostedEntries(archived, [entry], true)).toEqual([entry]);
});

it("captures a legacy selected source before archive filtering can replace its active workspace", () => {
    const { state, first } = fixture();
    const remembered = setPhoneDatabasePreference(
        state,
        phoneWorkspaceOwner(state),
        "local",
        (current) => current,
        `id:${first.database.id}`,
    );
    expect(remembered.workspacePreferences?.[phoneWorkspaceKey(state)]?.database?.local).toBe(
        `id:${first.database.id}`,
    );
    expect(
        setPhoneDatabasePreference(
            remembered,
            phoneWorkspaceOwner(state),
            "local",
            (current) => current,
            `id:${first.database.id}`,
        ),
    ).toBe(remembered);
});

it("preserves legacy workspaces and rejects malformed saved archive labels", () => {
    expect(validPhoneSourceArchives(undefined)).toBe(true);
    expect(validPhoneSourceArchives({ databaseIds: [], hostedPaths: ["Databases/Prep"] })).toBe(
        true,
    );
    for (const invalid of [
        null,
        [],
        {},
        { databaseIds: [], hostedPaths: [42] },
        { databaseIds: [""], hostedPaths: [] },
    ])
        expect(validPhoneSourceArchives(invalid)).toBe(false);
});
