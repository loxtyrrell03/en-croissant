import { notifications } from "@mantine/notifications";
import type { TreeStore } from "@/state/store/tree";
import { tabTreeOwner } from "@/state/store/treeOwner";
import type { TabSaveTarget } from "./tabSaveTarget";
import type { TreeState } from "./treeReducer";
import {
    findWorkspacePreference,
    moveWorkspacePreferences,
    readPreferenceMap,
    setWorkspacePreference,
} from "./workspacePreferences";

export const FILE_BOARD_PREFERENCES_KEY = "en-croissant.file-board-preferences";
export type FilePrepSource = {
    source: "local" | "lch_all" | "lch_master";
    databasePath: string | null;
    databaseLabel: string | null;
};
export type FilePrepScope = "side" | "underBoard";
export type FilePrepMode = "player" | "general";
export type FileBoardPreferences = {
    orientation?: "white" | "black";
    prepSources?: Partial<Record<`${FilePrepScope}:${FilePrepMode}`, FilePrepSource>>;
    prepModes?: Partial<Record<FilePrepScope, FilePrepMode>>;
};

function validate(values: Record<string, FileBoardPreferences>) {
    for (const value of Object.values(values)) {
        if (
            value.orientation !== undefined &&
            value.orientation !== "white" &&
            value.orientation !== "black"
        )
            throw new Error("Saved board orientation is invalid. It has been preserved.");
        if (value.prepSources !== undefined) {
            if (
                !value.prepSources ||
                typeof value.prepSources !== "object" ||
                Array.isArray(value.prepSources)
            )
                throw new Error("Saved Prep sources are invalid. They have been preserved.");
            for (const [key, source] of Object.entries(value.prepSources)) {
                if (
                    !source ||
                    !["local", "lch_all", "lch_master"].includes(source.source) ||
                    !(source.databasePath === null || typeof source.databasePath === "string") ||
                    !(source.databaseLabel === null || typeof source.databaseLabel === "string") ||
                    (key.endsWith(":player") && source.source !== "local")
                )
                    throw new Error("Saved Prep source is invalid. It has been preserved.");
            }
        }
        if (
            value.prepModes !== undefined &&
            (!value.prepModes ||
                typeof value.prepModes !== "object" ||
                Array.isArray(value.prepModes) ||
                Object.values(value.prepModes).some(
                    (mode) => mode !== "player" && mode !== "general",
                ))
        )
            throw new Error("Saved Prep mode is invalid. It has been preserved.");
    }
    return values;
}
function loadAll() {
    return validate(readPreferenceMap<FileBoardPreferences>(FILE_BOARD_PREFERENCES_KEY));
}

export function loadFileBoardPreferences(path: string) {
    return findWorkspacePreference(loadAll(), path);
}
export function saveFileBoardPreferences(path: string, patch: FileBoardPreferences) {
    const values = loadAll(),
        previous = findWorkspacePreference(values, path) ?? {};
    const next = {
        ...previous,
        ...patch,
        ...(patch.prepSources
            ? { prepSources: { ...previous.prepSources, ...patch.prepSources } }
            : {}),
        ...(patch.prepModes ? { prepModes: { ...previous.prepModes, ...patch.prepModes } } : {}),
    };
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const updated = validate(setWorkspacePreference(values, path, next));
    localStorage.setItem(FILE_BOARD_PREFERENCES_KEY, JSON.stringify(updated));
}
export function moveFileBoardPreferences(from: string, to: string, directory: boolean) {
    const values = loadAll(),
        moved = moveWorkspacePreferences(values, from, to, directory);
    if (moved !== values) localStorage.setItem(FILE_BOARD_PREFERENCES_KEY, JSON.stringify(moved));
}
export function reportFilePreferenceFailure(error: unknown) {
    notifications.show({
        title: "Could not remember board choices",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
    });
}
export function applyFileOrientation<T extends TreeState>(tree: T, path: string): T {
    try {
        const orientation = loadFileBoardPreferences(path)?.orientation;
        return orientation ? { ...tree, headers: { ...tree.headers, orientation } } : tree;
    } catch (error) {
        reportFilePreferenceFailure(error);
        return tree;
    }
}
export function flipBoardOrientation(tree: TreeStore, target: TabSaveTarget) {
    const state = tree.getState();
    const orientation = state.headers.orientation === "black" ? "white" : "black";
    state.setOrientation(orientation);
    const owner = target.get();
    if (!owner || tabTreeOwner(tree) !== owner.value) return;
    const origin = owner.gameOrigin;
    if (origin.kind === "file" || origin.kind === "temp_file") {
        try {
            saveFileBoardPreferences(origin.file.path, { orientation });
        } catch (error) {
            reportFilePreferenceFailure(error);
        }
    }
}
