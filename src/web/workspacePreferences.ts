import { filePreferenceIdentity } from "@/utils/workspacePreferences";
import { validPhoneGameDateRanges } from "./gameDates";
import { getWebDatabaseSourceStorageValue, resolveWebDatabaseSourceId } from "./databaseSync";
import type {
    WebColor,
    WebCompanionState,
    WebDatabasePreferenceKey,
    WebWorkspacePreferences,
} from "./model";
import type { WebPrepSetupSelection } from "./prepSettings";

/** A file's games share view choices; Prep and blank boards have separate owners. */
export function phoneWorkspaceKey(state: WebCompanionState): string {
    const prep = state.prepWorkspaces.find((item) => item.id === state.activePrepId);
    if (prep) return JSON.stringify(["prep", prep.id]);
    const board = state.board;
    const database = state.databases.find((item) => item.id === board.sourceDatabaseId);
    if (database) {
        const path = database.hostedFilePath ?? database.hostedPath;
        return JSON.stringify(
            path ? ["file", filePreferenceIdentity(path)] : ["database", database.id],
        );
    }
    return JSON.stringify([
        "board",
        board.annotationOwnerId ?? null,
        board.sourceDatabaseId,
        board.sourceGameId,
    ]);
}

/** Captures the actual displayed source, so a late action cannot flip its replacement. */
export function phoneWorkspaceOwner(state: WebCompanionState): string {
    return JSON.stringify([
        phoneWorkspaceKey(state),
        state.activePrepId,
        state.board.annotationOwnerId,
        state.board.sourceGameId,
        state.board.startFen,
    ]);
}

export function phoneBoardOrientation(state: WebCompanionState): WebColor {
    const preference = state.workspacePreferences?.[phoneWorkspaceKey(state)]?.orientation;
    if (preference === "white" || preference === "black") return preference;
    return (
        state.prepWorkspaces.find((item) => item.id === state.activePrepId)?.userColor ??
        state.board.orientation
    );
}

export function flipPhoneBoard(state: WebCompanionState, owner: string): WebCompanionState {
    if (phoneWorkspaceOwner(state) !== owner) return state;
    const orientation = phoneBoardOrientation(state) === "white" ? "black" : "white";
    const key = phoneWorkspaceKey(state);
    return {
        ...state,
        board: { ...state.board, orientation },
        workspacePreferences: {
            ...state.workspacePreferences,
            [key]: { ...state.workspacePreferences?.[key], orientation },
        },
    };
}

/** An explicit training-side change/reset wins over the manual view choice. */
export function alignPhoneBoard(
    state: WebCompanionState,
    owner: string,
    color: WebColor,
    explicit = true,
): WebCompanionState {
    if (phoneWorkspaceOwner(state) !== owner) return state;
    const key = phoneWorkspaceKey(state);
    const previous = state.workspacePreferences?.[key];
    if (!explicit && previous?.orientation !== undefined) return state;
    const orientation = color;
    if (previous?.orientation === undefined && state.board.orientation === orientation)
        return state;
    const next = { ...previous };
    delete next.orientation;
    return {
        ...state,
        board: { ...state.board, orientation },
        workspacePreferences: { ...state.workspacePreferences, [key]: next },
    };
}

export function setPhoneDatabasePreference(
    state: WebCompanionState,
    owner: string,
    field: WebDatabasePreferenceKey,
    update: string | ((current: string) => string),
    fallback: string,
): WebCompanionState {
    if (phoneWorkspaceOwner(state) !== owner) return state;
    const key = phoneWorkspaceKey(state),
        previous = state.workspacePreferences?.[key];
    const value =
        typeof update === "function" ? update(previous?.database?.[field] ?? fallback) : update;
    if (previous?.database?.[field] === value) return state;
    return {
        ...state,
        workspacePreferences: {
            ...state.workspacePreferences,
            [key]: { ...previous, database: { ...previous?.database, [field]: value } },
        },
    };
}

export function rememberPhonePrepSource(
    state: WebCompanionState,
    owner: string,
    selection: WebPrepSetupSelection,
): WebCompanionState {
    if (phoneWorkspaceOwner(state) !== owner || selection.source === "temporary") return state;
    const key = phoneWorkspaceKey(state),
        previous = state.workspacePreferences?.[key];
    const database =
        selection.source === "local"
            ? state.databases.find((item) => item.id === selection.sourceId)
            : null;
    const source = {
        source: selection.source,
        sourceRef: database ? getWebDatabaseSourceStorageValue(database) : null,
    };
    if (
        previous?.prep?.mode === selection.mode &&
        JSON.stringify(previous.prep.sources?.[selection.mode]) === JSON.stringify(source)
    )
        return state;
    return {
        ...state,
        workspacePreferences: {
            ...state.workspacePreferences,
            [key]: {
                ...previous,
                prep: {
                    ...previous?.prep,
                    mode: selection.mode,
                    sources: { ...previous?.prep?.sources, [selection.mode]: source },
                },
            },
        },
    };
}

/** Only a mode change restores its former source. An explicit source choice
 * (which may itself change mode) always remains authoritative. */
export function restorePhonePrepSource(
    state: WebCompanionState,
    selection: WebPrepSetupSelection,
): WebPrepSetupSelection {
    const saved =
        state.workspacePreferences?.[phoneWorkspaceKey(state)]?.prep?.sources?.[selection.mode];
    if (!saved || (selection.mode === "player" && saved.source !== "local")) return selection;
    return {
        ...selection,
        source: saved.source,
        sourceId:
            saved.source === "local"
                ? resolveWebDatabaseSourceId(saved.sourceRef, state.databases)
                : null,
        temporarySource: null,
    };
}

export function validPhoneWorkspacePreferences(value: unknown): boolean {
    return (
        value === undefined ||
        (!!value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            Object.values(value).every(
                (entry) =>
                    entry &&
                    typeof entry === "object" &&
                    !Array.isArray(entry) &&
                    validPreferenceEntry(entry),
            ))
    );
}

function validPreferenceEntry(entry: WebWorkspacePreferences) {
    if (
        entry.gameDates !== undefined &&
        (!entry.gameDates ||
            typeof entry.gameDates !== "object" ||
            Array.isArray(entry.gameDates) ||
            Object.entries(entry.gameDates).some(
                ([scope, ranges]) =>
                    !["database", "prep"].includes(scope) || !validPhoneGameDateRanges(ranges),
            ))
    )
        return false;
    if (
        entry.orientation !== undefined &&
        entry.orientation !== "white" &&
        entry.orientation !== "black"
    )
        return false;
    if (
        entry.database !== undefined &&
        (!entry.database ||
            typeof entry.database !== "object" ||
            Array.isArray(entry.database) ||
            Object.values(entry.database).some((value) => typeof value !== "string"))
    )
        return false;
    if (entry.prep !== undefined) {
        const prep = entry.prep;
        if (
            !prep ||
            typeof prep !== "object" ||
            Array.isArray(prep) ||
            (prep.mode !== undefined && prep.mode !== "player" && prep.mode !== "general")
        )
            return false;
        if (
            prep.sources !== undefined &&
            (!prep.sources ||
                typeof prep.sources !== "object" ||
                Array.isArray(prep.sources) ||
                Object.entries(prep.sources).some(
                    ([mode, source]) =>
                        !source ||
                        typeof source !== "object" ||
                        !["local", "lichess-all", "lichess-masters"].includes(source.source) ||
                        (source.sourceRef !== null && typeof source.sourceRef !== "string") ||
                        (mode === "player" && source.source !== "local"),
                ))
        )
            return false;
    }
    return true;
}
