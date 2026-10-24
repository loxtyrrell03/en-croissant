import { INITIAL_FEN } from "chessops/fen";
import type { TreeState } from "./treeReducer";

export function hasMeaningfulTabContent(state: TreeState): boolean {
    const root = state.root;
    if (
        root.children.length ||
        root.comment.trim() ||
        root.shapes.length ||
        root.annotations.length ||
        root.clock !== undefined ||
        root.timestamp !== undefined ||
        root.fen.trim().replace(/\s+/g, " ") !== INITIAL_FEN
    )
        return true;
    return Object.entries(state.headers).some(([key, value]) => {
        if (["id", "fen", "orientation", "start"].includes(key)) return false;
        if (typeof value === "string")
            return value.trim() !== "" && !/^[?.*\s]+$/.test(value) && value !== "Unknown";
        if (key === "other" && value && typeof value === "object")
            return Object.values(value).some((item) => typeof item === "string" && item.trim());
        return false;
    });
}
