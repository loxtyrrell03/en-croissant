import { getPGN } from "./chess";
import { getGameName, type GameHeaders, type TreeNode } from "./treeReducer";
import type {
    BlindfoldGameSettings,
    BlindfoldLostTrackMark,
    BlindfoldSavedGame,
} from "@/state/atoms";

export const BLINDFOLD_LOST_TRACK_COMMENT = "Blindfold: lost track here.";
const MAX_BLINDFOLD_SAVED_GAMES = 80;

export function blindfoldPathKey(path: number[]) {
    return path.join(".");
}

export function addLostTrackComment(comment: string) {
    if (comment.includes(BLINDFOLD_LOST_TRACK_COMMENT)) return comment;
    return [comment.trim(), BLINDFOLD_LOST_TRACK_COMMENT].filter(Boolean).join("\n");
}

export function removeLostTrackComment(comment: string) {
    return comment
        .split(/\r?\n/)
        .filter((line) => line.trim() !== BLINDFOLD_LOST_TRACK_COMMENT)
        .join("\n")
        .trim();
}

export function hasLostTrackComment(comment: string) {
    return comment.split(/\r?\n/).some((line) => line.trim() === BLINDFOLD_LOST_TRACK_COMMENT);
}

export function getNodeAtBlindfoldPath(root: TreeNode, path: number[]) {
    let node = root;
    for (const index of path) {
        const child = node.children[index];
        if (!child) return null;
        node = child;
    }
    return node;
}

export function getBlindfoldSanLine(root: TreeNode, path: number[]) {
    const sanLine: string[] = [];
    let node = root;
    for (const index of path) {
        const child = node.children[index];
        if (!child) break;
        if (child.san) sanLine.push(child.san);
        node = child;
    }
    return sanLine;
}

export function formatBlindfoldPlyLabel(node: TreeNode) {
    if (!node.san || node.halfMoves <= 0) return "Start position";
    const moveNumber = Math.ceil(node.halfMoves / 2);
    return node.halfMoves % 2 === 1 ? `${moveNumber}. ${node.san}` : `${moveNumber}... ${node.san}`;
}

export function createBlindfoldLostTrackMark({
    id,
    root,
    path,
    now,
}: {
    id: string;
    root: TreeNode;
    path: number[];
    now: number;
}): BlindfoldLostTrackMark | null {
    const node = getNodeAtBlindfoldPath(root, path);
    if (!node) return null;

    return {
        id,
        fen: node.fen,
        path,
        ply: node.halfMoves,
        label: formatBlindfoldPlyLabel(node),
        sanLine: getBlindfoldSanLine(root, path),
        createdAt: now,
    };
}

function getMainlineEnd(root: TreeNode) {
    let node = root;
    while (node.children.length > 0) {
        node = node.children[0];
    }
    return node;
}

function countMainlineMoves(root: TreeNode) {
    let count = 0;
    let node = root;
    while (node.children.length > 0) {
        count += 1;
        node = node.children[0];
    }
    return count;
}

function defaultBlindfoldTitle(headers: GameHeaders) {
    const gameName = getGameName(headers);
    if (gameName && gameName !== "Unknown" && gameName !== "? - ?") return gameName;
    return "Blindfold game";
}

export function buildBlindfoldSavedGame({
    id,
    root,
    headers,
    settings,
    marks,
    humanColor,
    existing,
    now,
}: {
    id: string;
    root: TreeNode;
    headers: GameHeaders;
    settings: BlindfoldGameSettings;
    marks: BlindfoldLostTrackMark[];
    humanColor: "white" | "black" | null;
    existing?: BlindfoldSavedGame | null;
    now: number;
}): BlindfoldSavedGame {
    const mainlineEnd = getMainlineEnd(root);
    const pgn = getPGN(root, {
        headers,
        comments: true,
        extraMarkups: true,
        glyphs: true,
        variations: true,
    });

    return {
        id,
        title: existing?.title || defaultBlindfoldTitle(headers),
        pgn,
        initialFen: root.fen,
        result: headers.result,
        white: headers.white || "?",
        black: headers.black || "?",
        humanColor,
        moveCount: countMainlineMoves(root),
        lastMoveSan: mainlineEnd.san,
        settings,
        marks,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
}

export function upsertBlindfoldSavedGame(
    games: BlindfoldSavedGame[],
    nextGame: BlindfoldSavedGame,
) {
    return [nextGame, ...games.filter((game) => game.id !== nextGame.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_BLINDFOLD_SAVED_GAMES);
}
