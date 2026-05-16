import type { Position } from "@/components/files/opening";
import { getNodeAtPath, type TreeNode } from "@/utils/treeReducer";

export type ReviewPositionTreeMatch = {
    positionIndex: number;
    node: TreeNode;
    path: number[];
};

export function getReviewPositionsForPath(
    positions: Position[],
    root: TreeNode,
    path: number[],
    preferredPositionIndex?: number | null,
): ReviewPositionTreeMatch[] {
    const matches: ReviewPositionTreeMatch[] = [];

    for (let depth = 0; depth <= path.length; depth += 1) {
        const nodePath = path.slice(0, depth);
        const node = getNodeAtPath(root, nodePath);
        const positionIndex = findReviewPositionIndexForNode(
            positions,
            node.fen,
            preferredPositionIndex,
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

function findReviewPositionIndexForNode(
    positions: Position[],
    fen: string,
    preferredPositionIndex?: number | null,
) {
    if (preferredPositionIndex !== undefined && preferredPositionIndex !== null) {
        const preferred = positions[preferredPositionIndex];
        if (preferred && sameReviewPosition(preferred.fen, fen)) {
            return preferredPositionIndex;
        }
    }

    const targetKey = reviewPositionFenKey(fen);
    return positions.findIndex((position) => reviewPositionFenKey(position.fen) === targetKey);
}
