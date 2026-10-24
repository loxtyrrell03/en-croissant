import type { useStore } from "jotai";
import type { PgnWriteResult } from "@/bindings/pgnFiles";
import { tabsAtom } from "@/state/atoms";
import { getTabTreeStore } from "@/state/store/treeRegistry";
import { pgnPathKey } from "./pgnFileQueue";

export function samePgnPath(a: string, b: string) {
    return pgnPathKey(a) === pgnPathKey(b);
}

/** File-wide counts/cache epochs change together. Deleting a source unbinds its
 * open boards while preserving their trees; neighbouring indices follow it. */
export function notePgnFileWrite(
    store: ReturnType<typeof useStore>,
    path: string,
    result: PgnWriteResult,
    removed?: { requestedIndex: number; identity: string },
) {
    const detached: string[] = [];
    store.set(tabsAtom, (tabs) =>
        tabs.map((tab) => {
            const origin = tab.gameOrigin;
            if (
                (origin.kind !== "file" && origin.kind !== "temp_file") ||
                !samePgnPath(origin.file.path, path)
            )
                return tab;
            if (
                removed &&
                ((origin.sourceIdentity === removed.identity &&
                    (origin.gameNumber === result.index ||
                        result.index !== removed.requestedIndex)) ||
                    (!origin.sourceIdentity && origin.gameNumber === result.index))
            ) {
                detached.push(tab.value);
                return { ...tab, gameOrigin: { kind: "none" as const } };
            }
            return {
                ...tab,
                gameOrigin: {
                    ...origin,
                    gameNumber:
                        removed && origin.gameNumber > result.index
                            ? origin.gameNumber - 1
                            : origin.gameNumber,
                    file: {
                        ...origin.file,
                        numGames: result.gameCount,
                        numGamesKnown: true,
                        lastModified: Math.max(Date.now(), origin.file.lastModified + 1),
                    },
                },
            };
        }),
    );
    for (const id of detached) getTabTreeStore(id).setState({ dirty: true });
}
