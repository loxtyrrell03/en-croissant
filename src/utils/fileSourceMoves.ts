import type { createStore } from "jotai";
import {
    archivedFileEntriesAtom,
    comparePanelSettingsByFileAtom,
    databasePanelSettingsByFileAtom,
    pinnedFileEntriesAtom,
    recentFilesAtom,
    tabsAtom,
} from "@/state/atoms";
import { moveFileBoardPreferences, reportFilePreferenceFailure } from "./fileBoardPreferences";
import { filePreferenceIdentity, moveWorkspacePreferences } from "./workspacePreferences";

function movedPath(path: string, from: string, to: string, directory: boolean): string | null {
    const key = filePreferenceIdentity(path),
        old = filePreferenceIdentity(from);
    if (key !== old && !(directory && key.startsWith(`${old}/`))) return null;
    const display = (value: string) =>
        value
            .replaceAll("\\", "/")
            .replace(/^\/\/\?\/UNC\//i, "//")
            .replace(/^\/\/\?\//, "");
    const suffix = display(path).slice(display(from).length);
    return to + (to.includes("\\") && !to.includes("/") ? suffix.replaceAll("/", "\\") : suffix);
}

/** Called only after a successful physical move; optional preferences cannot
 * prevent open boards from following their actual source file. */
export function noteFileMove(
    atoms: ReturnType<typeof createStore>,
    from: string,
    to: string,
    directory: boolean,
    name?: string,
) {
    const errors: unknown[] = [];
    const safely = (run: () => void) => {
        try {
            run();
        } catch (error) {
            errors.push(error);
        }
    };
    safely(() => {
        const current = atoms.get(tabsAtom);
        let changed = false;
        const next = current.map((tab) => {
            const origin = tab.gameOrigin;
            if (origin.kind !== "file" && origin.kind !== "temp_file") return tab;
            const path = movedPath(origin.file.path, from, to, directory);
            if (!path) return tab;
            changed = true;
            const nextName = !directory && name ? name : origin.file.name;
            return {
                ...tab,
                name: tab.name === origin.file.name ? nextName : tab.name,
                gameOrigin: { ...origin, file: { ...origin.file, path, name: nextName } },
            };
        });
        if (changed) atoms.set(tabsAtom, next);
    });
    safely(() => {
        const current = atoms.get(recentFilesAtom);
        let changed = false;
        const next = current.map((entry) => {
            const path = movedPath(entry.path, from, to, directory);
            if (!path) return entry;
            changed = true;
            return { ...entry, path, name: !directory && name ? name : entry.name };
        });
        if (changed) atoms.set(recentFilesAtom, next);
    });
    for (const atom of [pinnedFileEntriesAtom, archivedFileEntriesAtom])
        safely(() => {
            const current = atoms.get(atom);
            const next = Array.from(
                new Set(current.map((path) => movedPath(path, from, to, directory) ?? path)),
            );
            if (
                next.some((value, index) => value !== current[index]) ||
                next.length !== current.length
            )
                atoms.set(atom, next);
        });
    safely(() => moveFileBoardPreferences(from, to, directory));
    safely(() => {
        const current = atoms.get(databasePanelSettingsByFileAtom);
        const next = moveWorkspacePreferences(current, from, to, directory);
        if (next !== current) atoms.set(databasePanelSettingsByFileAtom, next);
    });
    safely(() => {
        const current = atoms.get(comparePanelSettingsByFileAtom);
        const next = moveWorkspacePreferences(current, from, to, directory);
        if (next !== current) atoms.set(comparePanelSettingsByFileAtom, next);
    });
    if (errors.length)
        reportFilePreferenceFailure(new Error(errors.map((error) => String(error)).join("\n")));
}
