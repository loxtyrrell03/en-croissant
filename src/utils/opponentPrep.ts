import { isNormal, makeUci, type Move } from "chessops";
import { parseSan } from "chessops/san";
import type { Opening } from "@/utils/db";
import { positionFromFen } from "@/utils/chessops";
import { getNodeAtPath, type TreeNode } from "@/utils/treeReducer";

export type PrepColor = "white" | "black";
export type OpponentPrepBranchStatus = "new" | "started" | "prepared" | "skipped";

export type OpponentPrepMoveRow = Opening & {
    key: string;
    uci: string | null;
    total: number;
    share: number;
    childIndex: number | null;
    status: OpponentPrepBranchStatus;
};

export type OpponentPrepBranch = {
    branchPath: number[];
    movePath: number[];
    fen: string;
    san: string;
    uci: string | null;
    key: string;
};

export function getFenTurn(fen: string): PrepColor {
    return fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
}

export function oppositePrepColor(color: PrepColor): PrepColor {
    return color === "white" ? "black" : "white";
}

export function getOpeningTotal(opening: Pick<Opening, "white" | "draw" | "black">) {
    return opening.white + opening.draw + opening.black;
}

export function sortOpponentPrepOpenings(openings: Opening[], minGames: number, limit: number) {
    return [...openings]
        .filter((opening) => opening.move !== "*" && opening.move !== "Total")
        .filter((opening) => getOpeningTotal(opening) >= Math.max(1, minGames))
        .sort(
            (a, b) =>
                getOpeningTotal(b) - getOpeningTotal(a) ||
                getOpeningDateSortValue(b) - getOpeningDateSortValue(a) ||
                a.move.localeCompare(b.move),
        )
        .slice(0, Math.max(1, limit));
}

export function getOpponentPrepMoveRows({
    fen,
    node,
    openings,
    minGames,
    moveLimit,
    completedBranches,
    skippedBranches,
}: {
    fen: string;
    node: TreeNode;
    openings: Opening[];
    minGames: number;
    moveLimit: number;
    completedBranches: Record<string, number>;
    skippedBranches: Record<string, number>;
}): OpponentPrepMoveRow[] {
    const sorted = sortOpponentPrepOpenings(openings, minGames, moveLimit);
    const totalGames = sorted.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);

    return sorted.map((opening) => {
        const key = getOpponentPrepBranchKey(fen, opening.move);
        const childIndex = findMatchingChildIndex(node, fen, opening.move);
        const child = childIndex === null ? null : node.children[childIndex];
        const prepared =
            Boolean(completedBranches[key]) || Boolean(child && child.children.length > 0);
        const skipped = Boolean(skippedBranches[key]);
        const status: OpponentPrepBranchStatus = prepared
            ? "prepared"
            : skipped
              ? "skipped"
              : child
                ? "started"
                : "new";

        return {
            ...opening,
            key,
            uci: getMoveUciFromSan(fen, opening.move),
            total: getOpeningTotal(opening),
            share: totalGames > 0 ? getOpeningTotal(opening) / totalGames : 0,
            childIndex,
            status,
        };
    });
}

export function getOpponentPrepBranchKey(fen: string, san: string) {
    return `${normalizeFenForPrep(fen)}|${getMoveUciFromSan(fen, san) ?? normalizeSanForPrep(san)}`;
}

export function findLastOpponentBranch(
    root: TreeNode,
    path: number[],
    opponentColor: PrepColor,
    rootPath: number[] = [],
): OpponentPrepBranch | null {
    for (let length = path.length; length > rootPath.length; length--) {
        const branchPath = path.slice(0, length - 1);
        const movePath = path.slice(0, length);
        const parent = getNodeAtPath(root, branchPath);
        const child = getNodeAtPath(root, movePath);
        if (getFenTurn(parent.fen) !== opponentColor || !child.san) continue;

        return {
            branchPath,
            movePath,
            fen: parent.fen,
            san: child.san,
            uci: child.move ? getMoveUci(child.move) : getMoveUciFromSan(parent.fen, child.san),
            key: getOpponentPrepBranchKey(parent.fen, child.san),
        };
    }

    return null;
}

export function collectOpponentBranchPaths({
    root,
    path,
    opponentColor,
    rootPath = [],
    excludeCurrent = false,
}: {
    root: TreeNode;
    path: number[];
    opponentColor: PrepColor;
    rootPath?: number[];
    excludeCurrent?: boolean;
}) {
    const paths: number[][] = [];
    const endLength = excludeCurrent ? Math.max(rootPath.length, path.length - 1) : path.length;

    for (let length = rootPath.length; length <= endLength; length++) {
        const branchPath = path.slice(0, length);
        const node = getNodeAtPath(root, branchPath);
        if (getFenTurn(node.fen) === opponentColor) {
            paths.push(branchPath);
        }
    }

    return paths;
}

export function pathExists(root: TreeNode, path: number[]) {
    let node = root;
    for (const index of path) {
        if (!node.children[index]) return false;
        node = node.children[index];
    }
    return true;
}

export function getLineSans(root: TreeNode, path: number[], fromPath: number[] = []) {
    const sans: string[] = [];
    let node = getNodeAtPath(root, fromPath);
    for (let i = fromPath.length; i < path.length; i++) {
        const child = node.children[path[i]];
        if (!child) break;
        if (child.san) sans.push(child.san);
        node = child;
    }
    return sans;
}

function findMatchingChildIndex(node: TreeNode, fen: string, san: string) {
    const moveUci = getMoveUciFromSan(fen, san);
    if (moveUci) {
        const uciIndex = node.children.findIndex((child) => getMoveUci(child.move) === moveUci);
        if (uciIndex !== -1) return uciIndex;
    }

    const normalizedSan = normalizeSanForPrep(san);
    const sanIndex = node.children.findIndex(
        (child) => normalizeSanForPrep(child.san) === normalizedSan,
    );
    return sanIndex === -1 ? null : sanIndex;
}

function getMoveUciFromSan(fen: string, san: string) {
    const [pos] = positionFromFen(fen);
    if (!pos) return null;

    const move = parseSan(pos, san);
    if (!move || !isNormal(move)) return null;

    return makeUci(move);
}

function getMoveUci(move: Move | null | undefined) {
    if (!move || !isNormal(move)) return null;
    return makeUci(move);
}

function normalizeFenForPrep(fen: string) {
    return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

function normalizeSanForPrep(value: string | null | undefined) {
    return (value ?? "")
        .trim()
        .replace(/^0-0-0/, "O-O-O")
        .replace(/^0-0/, "O-O")
        .replace(/[+#?!]+$/g, "");
}

function getOpeningDateSortValue(opening: Opening) {
    const digits = opening.lastPlayed?.replace(/\D/g, "");
    return digits ? Number(digits.padEnd(8, "0")) : 0;
}
