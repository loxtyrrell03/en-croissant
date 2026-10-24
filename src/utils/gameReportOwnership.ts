import { makeUci } from "chessops";
import type { TreeNode } from "./treeReducer";

type ReportTree = {
    getState: () => { root: TreeNode };
    subscribe: (listener: () => void) => () => void;
};
const owners = new WeakMap<object, { token: symbol; unsubscribe: () => void }>();
export function gameReportGameKey(root: TreeNode): string | null {
    const moves: unknown[] = [],
        seen = new Set<TreeNode>([root]);
    let node = root;
    while (node.children[0]) {
        node = node.children[0];
        if (seen.has(node) || moves.length >= 2000) return null;
        seen.add(node);
        moves.push([node.fen, node.move ? makeUci(node.move) : node.san]);
    }
    return JSON.stringify([root.fen, moves]);
}

/** A late response belongs to its original tree, game and request. Comments,
 * board navigation and live evaluation changes do not change game identity. */
export function beginGameReport(store: ReportTree, onGameChanged: () => void) {
    const key = gameReportGameKey(store.getState().root);
    if (!key) throw new Error("The main line is invalid or exceeds 2,000 moves.");
    owners.get(store)?.unsubscribe();
    const token = Symbol("game-report");
    let changed = false;
    const isOwner = () => owners.get(store)?.token === token;
    const unsubscribe = store.subscribe(() => {
        if (isOwner() && !changed && gameReportGameKey(store.getState().root) !== key) {
            changed = true;
            onGameChanged();
        }
    });
    owners.set(store, { token, unsubscribe });
    return {
        isOwner,
        hasSameGame: () => !changed && gameReportGameKey(store.getState().root) === key,
        finish: () => {
            unsubscribe();
            if (isOwner()) owners.delete(store);
        },
    };
}
