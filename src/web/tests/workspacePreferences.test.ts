import { expect, it } from "vitest";
import {
    alignPhoneBoard,
    flipPhoneBoard,
    phoneBoardOrientation,
    phoneWorkspaceKey,
    phoneWorkspaceOwner,
    validPhoneWorkspacePreferences,
    setPhoneDatabasePreference,
    rememberPhonePrepSource,
    restorePhonePrepSource,
} from "../workspacePreferences";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase, webGameToLine } from "../pgn";
import { mergeImportedWebDatabases } from "../databaseSync";
import {
    applyWebPrepModeChange,
    applyWebPrepSourceChange,
    type WebPrepSetupSelection,
} from "../prepSettings";

function fixture() {
    const parsed = parsePgnDatabase("Invented preference games", "1. e4 e5 *\n\n1. d4 d5 *", 1);
    parsed.database.hostedFilePath = "C:/Lessons/White.pgn";
    const state = createEmptyWebState();
    state.databases = [parsed.database];
    state.gamesByDatabase = { [parsed.database.id]: parsed.games };
    state.board = {
        ...state.board,
        annotationOwnerId: "first",
        sourceDatabaseId: parsed.database.id,
        sourceGameId: parsed.games[0].id,
        line: webGameToLine(parsed.games[0]),
    };
    return { state, parsed };
}

it("remembers a view across games and refresh identities of the same hosted file", () => {
    const { state, parsed } = fixture();
    const flipped = flipPhoneBoard(state, phoneWorkspaceOwner(state));
    expect(phoneBoardOrientation(flipped)).toBe("black");
    expect(flipped.board.line).toBe(state.board.line);
    expect(flipped.gamesByDatabase).toBe(state.gamesByDatabase);
    const otherGame = {
        ...flipped,
        board: {
            ...flipped.board,
            annotationOwnerId: "second",
            sourceGameId: parsed.games[1].id,
            line: webGameToLine(parsed.games[1]),
            orientation: "white" as const,
        },
    };
    expect(phoneBoardOrientation(otherGame)).toBe("black");
    const updated = {
        ...parsed,
        database: {
            ...parsed.database,
            id: "replacement",
            hostedPath: "C:/Lessons/White.pgn",
            hostedFilePath: "c:\\lessons\\WHITE.pgn",
        },
    };
    const refreshed = mergeImportedWebDatabases(
        { ...otherGame, databases: [{ ...parsed.database, hostedPath: "C:/Lessons/White.pgn" }] },
        [updated],
    );
    expect(refreshed.board.sourceDatabaseId).toBe("replacement");
    expect(phoneWorkspaceKey(refreshed)).toBe(phoneWorkspaceKey(state));
    expect(phoneBoardOrientation(refreshed)).toBe("black");
});

it("isolates other files, Prep workspaces and new blank boards and rejects late controls", () => {
    const { state, parsed } = fixture();
    const owner = phoneWorkspaceOwner(state);
    const flipped = flipPhoneBoard(state, owner);
    const other = {
        ...flipped,
        databases: [{ ...parsed.database, hostedFilePath: "C:/Lessons/Other.pgn" }],
        board: { ...flipped.board, orientation: "white" as const, annotationOwnerId: "other" },
    };
    expect(phoneBoardOrientation(other)).toBe("white");
    expect(flipPhoneBoard(other, owner)).toBe(other);
    expect(alignPhoneBoard(other, owner, "black")).toBe(other);
    const blank = {
        ...flipped,
        board: { ...createEmptyWebState().board, annotationOwnerId: "new" },
    };
    expect(phoneBoardOrientation(blank)).toBe("white");
});

it("retains manual Prep view on remount but an explicit side choice realigns it", () => {
    const { state } = fixture();
    state.prepWorkspaces = [
        {
            id: "prep",
            name: "Invented Prep",
            opponent: "Fixture",
            userColor: "black",
            sourceIds: [],
            startFen: state.board.startFen,
            line: [],
            notesByFen: {},
            preparedMoves: {},
            createdAt: 1,
            updatedAt: 1,
        },
    ];
    state.activePrepId = "prep";
    const owner = phoneWorkspaceOwner(state);
    expect(phoneBoardOrientation(state)).toBe("black");
    const flipped = flipPhoneBoard(state, owner);
    expect(phoneBoardOrientation(flipped)).toBe("white");
    expect(flipped.prepWorkspaces).toBe(state.prepWorkspaces);
    expect(alignPhoneBoard(flipped, owner, "black", false)).toBe(flipped);
    const aligned = alignPhoneBoard(flipped, owner, "black");
    expect(phoneBoardOrientation(aligned)).toBe("black");
    expect(aligned.workspacePreferences?.[phoneWorkspaceKey(state)]?.orientation).toBeUndefined();
    expect(aligned.prepWorkspaces).toBe(state.prepWorkspaces);
});

it("validates saved preference shape without rejecting existing workspaces", () => {
    expect(validPhoneWorkspacePreferences(undefined)).toBe(true);
    expect(validPhoneWorkspacePreferences({ file: { orientation: "black" } })).toBe(true);
    for (const invalid of [
        null,
        [],
        { file: null },
        { file: [] },
        { file: { orientation: "sideways" } },
        { file: { database: { source: 42 } } },
        { file: { prep: { sources: { player: { source: "lichess-all", sourceRef: null } } } } },
    ])
        expect(validPhoneWorkspacePreferences(invalid)).toBe(false);
});

it("merges Database fields and independent Prep mode sources, without applying stale choices", () => {
    const { state, parsed } = fixture();
    const owner = phoneWorkspaceOwner(state);
    const choice: WebPrepSetupSelection = {
        mode: "player",
        source: "local",
        sourceId: parsed.database.id,
        temporarySource: null,
        opponent: "Invented",
        userColor: "black",
        firstLocalSourceId: parsed.database.id,
    };
    const player = rememberPhonePrepSource(state, owner, choice);
    const generalChoice = applyWebPrepSourceChange(
        applyWebPrepModeChange(choice, "general"),
        "lichess-masters",
        null,
    );
    const general = rememberPhonePrepSource(player, owner, generalChoice);
    const dated = setPhoneDatabasePreference(general, owner, "startDate", "2026-09-01", "");
    const local = setPhoneDatabasePreference(
        dated,
        owner,
        "local",
        (current) => `${current}source`,
        "id:",
    );
    expect(local.workspacePreferences?.[phoneWorkspaceKey(state)]?.database).toEqual({
        startDate: "2026-09-01",
        local: "id:source",
    });
    expect(
        restorePhonePrepSource(local, applyWebPrepModeChange(generalChoice, "player")),
    ).toMatchObject({ mode: "player", source: "local", sourceId: parsed.database.id });
    expect(restorePhonePrepSource(local, applyWebPrepModeChange(choice, "general"))).toMatchObject({
        mode: "general",
        source: "lichess-masters",
        sourceId: null,
    });
    const navigated = { ...local, board: { ...local.board, annotationOwnerId: "newer" } };
    expect(setPhoneDatabasePreference(navigated, owner, "local", "old-source", "")).toBe(navigated);
    expect(rememberPhonePrepSource(navigated, owner, choice)).toBe(navigated);
    expect(local.gamesByDatabase).toBe(state.gamesByDatabase);
    expect(local.board).toBe(state.board);
});
