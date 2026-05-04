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

export type OpponentPrepStart = {
    branchPath: number[];
    branch: OpponentPrepBranch | null;
};

export type OpponentPrepBranchStats = {
    score: number;
    label: "No line" | "Thin" | "Needs work" | "Solid" | "Good";
    depthPly: number;
    opponentPositions: number;
    commonReplies: number;
    preparedReplies: number;
    startedReplies: number;
    replyCoverage: number;
    missingImportantMoves: string[];
};

const DEFAULT_STATS_MAX_PLY = 10;
const DEFAULT_STATS_MAX_POSITIONS = 12;

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

export function findFirstOpponentBranch(
    root: TreeNode,
    path: number[],
    opponentColor: PrepColor,
    rootPath: number[] = [],
): OpponentPrepBranch | null {
    for (let length = rootPath.length + 1; length <= path.length; length++) {
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

export function findOpponentPrepStart(
    root: TreeNode,
    rootPath: number[],
    opponentColor: PrepColor,
): OpponentPrepStart | null {
    const rootNode = getNodeAtPath(root, rootPath);
    if (getFenTurn(rootNode.fen) === opponentColor) {
        return {
            branchPath: rootPath,
            branch: null,
        };
    }

    const branch = findLastOpponentBranch(root, rootPath, opponentColor);
    if (!branch) return null;

    return {
        branchPath: branch.branchPath,
        branch,
    };
}

export async function getOpponentPrepBranchStats({
    parentNode,
    row,
    opponentColor,
    loadOpenings,
    minGames,
    moveLimit,
    completedBranches,
    skippedBranches,
    maxPly = DEFAULT_STATS_MAX_PLY,
    maxOpponentPositions = DEFAULT_STATS_MAX_POSITIONS,
}: {
    parentNode: TreeNode;
    row: OpponentPrepMoveRow;
    opponentColor: PrepColor;
    loadOpenings: (fen: string) => Promise<Opening[]>;
    minGames: number;
    moveLimit: number;
    completedBranches: Record<string, number>;
    skippedBranches: Record<string, number>;
    maxPly?: number;
    maxOpponentPositions?: number;
}): Promise<OpponentPrepBranchStats> {
    const branchNode =
        row.childIndex === null ? null : (parentNode.children[row.childIndex] ?? null);
    const depthPly = branchNode ? getMaxDescendantPly(branchNode, maxPly) : 0;
    const hasUserResponse = Boolean(branchNode?.children.length);
    const branchResponseScore = hasUserResponse ? 1 : row.status === "started" ? 0.25 : 0;

    if (!branchNode) {
        return createBranchStats({
            branchResponseScore,
            depthPly,
            opponentPositions: 0,
            commonReplies: 0,
            preparedReplies: 0,
            startedReplies: 0,
            replyCoverage: 0,
            missingImportantMoves: [],
        });
    }

    const opponentNodes = collectOpponentTurnNodes(
        branchNode,
        opponentColor,
        maxPly,
        maxOpponentPositions,
    );
    const positionStats = await Promise.all(
        opponentNodes.map(async ({ node, ply }) => {
            const openings = await loadOpenings(node.fen);
            const rows = getOpponentPrepMoveRows({
                fen: node.fen,
                node,
                openings,
                minGames,
                moveLimit,
                completedBranches,
                skippedBranches,
            });
            const total = rows.reduce((sum, item) => sum + item.total, 0);
            if (total <= 0 || rows.length === 0) return null;

            const replyCoverage =
                rows.reduce(
                    (sum, item) => sum + item.total * getBranchReplyCredit(item.status),
                    0,
                ) / total;
            const missingImportantMoves = rows
                .filter((item) => item.status !== "prepared" && item.total / total >= 0.2)
                .map((item) => item.move);

            return {
                ply,
                rows,
                total,
                replyCoverage,
                missingImportantMoves,
            };
        }),
    );
    const measuredPositions = positionStats.filter((item) => item !== null);
    let coverageWeight = 0;
    let weightedCoverage = 0;
    let commonReplies = 0;
    let preparedReplies = 0;
    let startedReplies = 0;
    const missingImportantMoves: string[] = [];

    for (const item of measuredPositions) {
        const depthWeight = 1 / (1 + Math.max(0, item.ply - 1) * 0.2);
        coverageWeight += depthWeight;
        weightedCoverage += item.replyCoverage * depthWeight;
        commonReplies += item.rows.length;
        preparedReplies += item.rows.filter((reply) => reply.status === "prepared").length;
        startedReplies += item.rows.filter((reply) => reply.status === "started").length;
        for (const move of item.missingImportantMoves) {
            if (!missingImportantMoves.includes(move)) missingImportantMoves.push(move);
        }
    }

    return createBranchStats({
        branchResponseScore,
        depthPly,
        opponentPositions: measuredPositions.length,
        commonReplies,
        preparedReplies,
        startedReplies,
        replyCoverage: coverageWeight > 0 ? weightedCoverage / coverageWeight : 0,
        missingImportantMoves,
    });
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

function collectOpponentTurnNodes(
    branchNode: TreeNode,
    opponentColor: PrepColor,
    maxPly: number,
    maxPositions: number,
) {
    const nodes: { node: TreeNode; ply: number }[] = [];
    const stack = branchNode.children.map((child) => ({ node: child, ply: 1 }));

    while (stack.length > 0 && nodes.length < maxPositions) {
        const { node, ply } = stack.shift()!;
        if (ply > maxPly) continue;

        if (getFenTurn(node.fen) === opponentColor) {
            nodes.push({ node, ply });
        }

        for (const child of node.children) {
            stack.push({ node: child, ply: ply + 1 });
        }
    }

    return nodes;
}

function getMaxDescendantPly(node: TreeNode, maxPly: number) {
    let max = 0;
    const stack = node.children.map((child) => ({ node: child, ply: 1 }));

    while (stack.length > 0) {
        const { node, ply } = stack.pop()!;
        if (ply > maxPly) continue;
        max = Math.max(max, ply);
        for (const child of node.children) {
            stack.push({ node: child, ply: ply + 1 });
        }
    }

    return max;
}

function getBranchReplyCredit(status: OpponentPrepBranchStatus) {
    switch (status) {
        case "prepared":
            return 1;
        case "started":
            return 0.35;
        case "skipped":
        case "new":
            return 0;
    }
}

function createBranchStats({
    branchResponseScore,
    depthPly,
    opponentPositions,
    commonReplies,
    preparedReplies,
    startedReplies,
    replyCoverage,
    missingImportantMoves,
}: {
    branchResponseScore: number;
    depthPly: number;
    opponentPositions: number;
    commonReplies: number;
    preparedReplies: number;
    startedReplies: number;
    replyCoverage: number;
    missingImportantMoves: string[];
}): OpponentPrepBranchStats {
    const depthScore = Math.min(1, depthPly / 8);
    const breadthScore = Math.min(1, opponentPositions / 3);
    const score = Math.round(
        100 *
            (0.2 * branchResponseScore +
                0.45 * replyCoverage +
                0.3 * depthScore +
                0.05 * breadthScore),
    );

    return {
        score,
        label: getBranchStatsLabel(score, depthPly),
        depthPly,
        opponentPositions,
        commonReplies,
        preparedReplies,
        startedReplies,
        replyCoverage,
        missingImportantMoves: missingImportantMoves.slice(0, 3),
    };
}

function getBranchStatsLabel(score: number, depthPly: number): OpponentPrepBranchStats["label"] {
    if (depthPly === 0) return "No line";
    if (score >= 80) return "Good";
    if (score >= 60) return "Solid";
    if (score >= 35) return "Needs work";
    return "Thin";
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
