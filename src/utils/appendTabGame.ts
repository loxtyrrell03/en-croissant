import { pgnFiles } from "@/bindings/pgnFiles";
import type { TreeStore } from "@/state/store/tree";
import { defaultPGN } from "./chess";
import type { TabSaveTarget } from "./tabSaveTarget";
import type { PgnWriteResult } from "@/bindings/pgnFiles";
import { withPgnFileTask } from "./pgnFileQueue";

/** Save current edits first and do not reset a board that changed during IO. */
export async function appendTabGame(
    target: TabSaveTarget,
    tree: TreeStore,
    saveCurrent: () => Promise<boolean>,
    noteWrite: (path: string, result: PgnWriteResult) => void,
): Promise<boolean> {
    if (tree.getState().dirty && (!(await saveCurrent()) || tree.getState().dirty)) return false;
    const owner = target.get();
    const origin = owner?.gameOrigin;
    if (!owner || (origin?.kind !== "file" && origin?.kind !== "temp_file")) return false;
    return withPgnFileTask(origin.file.path, async () => {
        const queuedOwner = target.get()?.gameOrigin;
        if (
            !queuedOwner ||
            (queuedOwner.kind !== "file" && queuedOwner.kind !== "temp_file") ||
            queuedOwner.file.path !== origin.file.path ||
            queuedOwner.gameNumber !== origin.gameNumber ||
            queuedOwner.sourceIdentity !== origin.sourceIdentity ||
            tree.getState().dirty
        )
            throw new Error(
                "The current game changed while waiting. Save your changes and add a game again.",
            );
        const { root, headers } = tree.getState();
        const appended = await pgnFiles.append(
            origin.file.path,
            defaultPGN(),
            JSON.stringify(origin.file.metadata),
        );
        noteWrite(origin.file.path, appended);
        const current = target.get();
        const binding = current?.gameOrigin;
        if (
            binding &&
            (binding.kind === "file" || binding.kind === "temp_file") &&
            binding.file.path === origin.file.path &&
            binding.gameNumber === origin.gameNumber &&
            binding.sourceIdentity === origin.sourceIdentity &&
            tree.getState().root === root &&
            tree.getState().headers === headers &&
            !tree.getState().dirty
        ) {
            target.update((tab) => ({
                ...tab,
                gameOrigin: {
                    ...binding,
                    gameNumber: appended.index,
                    sourceIdentity: appended.identity,
                },
            }));
            tree.getState().reset();
            return true;
        }
        throw new Error(
            "The new game was added to the file. Your current changes are still open; select the new game from the list.",
        );
    });
}
