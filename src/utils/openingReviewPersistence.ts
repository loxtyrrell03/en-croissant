import type { Position } from "@/components/files/opening";
import { getNodeAtPath, type TreeNode } from "@/utils/treeReducer";

export type ReviewPositionTreeMatch = {
    positionIndex: number;
    node: TreeNode;
    path: number[];
};

export type ReviewPositionFenIndex = Map<string, number>;

export function createReviewPositionFenIndex(positions: Position[]): ReviewPositionFenIndex {
    const index = new Map<string, number>();
    positions.forEach((position, positionIndex) => {
        const key = reviewPositionFenKey(position.fen);
        if (!index.has(key)) {
            index.set(key, positionIndex);
        }
    });
    return index;
}

export function getReviewPositionsForPath(
    positions: Position[],
    root: TreeNode,
    path: number[],
    preferredPositionIndex?: number | null,
    fenIndex?: ReviewPositionFenIndex,
): ReviewPositionTreeMatch[] {
    const matches: ReviewPositionTreeMatch[] = [];

    for (let depth = 0; depth <= path.length; depth += 1) {
        const nodePath = path.slice(0, depth);
        const node = getNodeAtPath(root, nodePath);
        const positionIndex = findReviewPositionIndexForFen(
            positions,
            node.fen,
            preferredPositionIndex,
            fenIndex,
        );

        if (positionIndex !== -1) {
            matches.push({ positionIndex, node, path: nodePath });
        }
    }

    return matches;
}

export function sameReviewPosition(a: string | undefined | null, b: string | undefined | null) {
    if (!a || !b) return false;
    return reviewPositionFenKey(a) === reviewPositionFenKey(b);
}

function reviewPositionFenKey(fen: string) {
    return fen.split(" ", 4).join(" ");
}

export function findReviewPositionIndexForFen(
    positions: Position[],
    fen: string,
    preferredPositionIndex?: number | null,
    fenIndex?: ReviewPositionFenIndex,
) {
    if (preferredPositionIndex !== undefined && preferredPositionIndex !== null) {
        const preferred = positions[preferredPositionIndex];
        if (preferred && sameReviewPosition(preferred.fen, fen)) {
            return preferredPositionIndex;
        }
    }

    const targetKey = reviewPositionFenKey(fen);
    const indexed = fenIndex?.get(targetKey);
    if (indexed !== undefined) return indexed;

    return positions.findIndex((position) => reviewPositionFenKey(position.fen) === targetKey);
}
