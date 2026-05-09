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

export type PrepBuilderSettings = {
    mode: "smart" | "engine" | "practical";
    size: "quick" | "balanced" | "deep";
    maxMoves: number;
    maxPly: number;
    opponentMoveLimit: number;
    minOpponentGames: number;
    minOpponentMoveShare: number;
    minBranchShare: number;
    breadthBias: number;
    engineWeight: number;
    maxEngineCpLoss: number;
    useCloudEngine: boolean;
    useLichessAll: boolean;
};

export type PrepBuilderEngineMove = {
    san: string;
    scoreCpForSide: number | null;
    rank: number | null;
    source: "lichess" | "chessdb";
};

export type PrepBuilderMoveChoice = {
    move: string;
    score: number;
    annotation: "!" | "!?";
    engineRank: number | null;
    engineCpLoss: number | null;
    engineSource: PrepBuilderEngineMove["source"] | null;
    opponentGames: number;
    opponentShare: number;
    opponentScore: number | null;
    referenceOpponentScore: number | null;
    opponentReferenceDelta: number | null;
    referenceGames: number;
    referenceShare: number;
    reasons: string[];
};

const DEFAULT_STATS_MAX_PLY = 10;
const DEFAULT_STATS_MAX_POSITIONS = 12;
export const DEFAULT_PREP_BUILDER_SETTINGS: PrepBuilderSettings = {
    mode: "smart",
    size: "balanced",
    maxMoves: 18,
    maxPly: 12,
    opponentMoveLimit: 4,
    minOpponentGames: 2,
    minOpponentMoveShare: 10,
    minBranchShare: 4,
    breadthBias: 100,
    engineWeight: 55,
    maxEngineCpLoss: 70,
    useCloudEngine: true,
    useLichessAll: true,
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

export function normalizePrepBuilderSettings(
    settings: Partial<PrepBuilderSettings> | null | undefined,
): PrepBuilderSettings {
    const mode = isPrepBuilderMode(settings?.mode) ? settings.mode : "smart";
    const size = isPrepBuilderSize(settings?.size) ? settings.size : "balanced";
    const sizePreset = getPrepBuilderSizePreset(size);
    const modePreset = getPrepBuilderModePreset(mode);

    return {
        mode,
        size,
        maxMoves: clampInteger(settings?.maxMoves, 4, 80, sizePreset.maxMoves),
        maxPly: clampInteger(settings?.maxPly, 2, 32, sizePreset.maxPly),
        opponentMoveLimit: clampInteger(
            settings?.opponentMoveLimit,
            1,
            10,
            sizePreset.opponentMoveLimit,
        ),
        minOpponentGames: clampInteger(
            settings?.minOpponentGames,
            1,
            100,
            sizePreset.minOpponentGames,
        ),
        minOpponentMoveShare: clampNumber(
            settings?.minOpponentMoveShare,
            1,
            80,
            sizePreset.minOpponentMoveShare,
        ),
        minBranchShare: clampNumber(
            settings?.minBranchShare,
            0,
            50,
            sizePreset.minBranchShare,
        ),
        breadthBias: clampNumber(settings?.breadthBias, 0, 100, modePreset.breadthBias),
        engineWeight: clampNumber(settings?.engineWeight, 0, 100, modePreset.engineWeight),
        maxEngineCpLoss: clampInteger(
            settings?.maxEngineCpLoss,
            0,
            300,
            modePreset.maxEngineCpLoss,
        ),
        useCloudEngine: settings?.useCloudEngine ?? DEFAULT_PREP_BUILDER_SETTINGS.useCloudEngine,
        useLichessAll: settings?.useLichessAll ?? DEFAULT_PREP_BUILDER_SETTINGS.useLichessAll,
    };
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

export function getPrepBuilderTaskPriority({
    branchShare,
    ply,
    settings,
}: {
    branchShare: number;
    ply: number;
    settings: PrepBuilderSettings;
}) {
    const shallowBoost = 1 + Math.max(0, 1 - ply / Math.max(1, settings.maxPly)) * 0.35;
    return branchShare * shallowBoost;
}

export function getPrepBuilderStopReason({
    branchShare,
    ply,
    availableGames,
    settings,
}: {
    branchShare: number;
    ply: number;
    availableGames?: number | null;
    settings: PrepBuilderSettings;
}) {
    if (ply >= settings.maxPly) return "Depth cap reached";
    if (branchShare * 100 < settings.minBranchShare) return "Line became too rare";
    if (availableGames !== undefined && availableGames !== null) {
        if (availableGames < settings.minOpponentGames) return "Not enough games left";
    }
    return null;
}

export function choosePrepBuilderMove({
    opponentOpenings,
    referenceOpenings = [],
    engineMoves = [],
    userColor,
    settings,
}: {
    opponentOpenings: Opening[];
    referenceOpenings?: Opening[];
    engineMoves?: PrepBuilderEngineMove[];
    userColor: PrepColor;
    settings: PrepBuilderSettings;
}): PrepBuilderMoveChoice | null {
    const playableOpponent = getPlayableOpenings(opponentOpenings);
    const playableReference = getPlayableOpenings(referenceOpenings);
    const opponentTotal = playableOpponent.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);
    const referenceTotal = playableReference.reduce(
        (sum, opening) => sum + getOpeningTotal(opening),
        0,
    );
    const opponentBaseline = getWeightedSideScore(playableOpponent, userColor);
    const referenceBaseline = getWeightedSideScore(playableReference, userColor);
    const opponentByMove = new Map(
        playableOpponent.map((opening) => [normalizeSanForPrep(opening.move), opening]),
    );
    const referenceByMove = new Map(
        playableReference.map((opening) => [normalizeSanForPrep(opening.move), opening]),
    );
    const engineByMove = new Map(
        engineMoves.map((move) => [normalizeSanForPrep(move.san), move]),
    );
    const scoredEngineMoves = engineMoves.filter((move) => move.scoreCpForSide !== null);
    const bestEngineScore =
        scoredEngineMoves.length > 0
            ? Math.max(...scoredEngineMoves.map((move) => move.scoreCpForSide!))
            : null;
    const moves = new Set<string>();

    for (const opening of playableOpponent) {
        if (getOpeningTotal(opening) >= settings.minOpponentGames) {
            moves.add(normalizeSanForPrep(opening.move));
        }
    }
    if (settings.useLichessAll) {
        for (const opening of playableReference.slice(0, Math.max(8, settings.opponentMoveLimit))) {
            moves.add(normalizeSanForPrep(opening.move));
        }
    }
    if (settings.useCloudEngine) {
        for (const move of engineMoves.slice(0, Math.max(5, settings.opponentMoveLimit))) {
            moves.add(normalizeSanForPrep(move.san));
        }
    }

    const choices = Array.from(moves)
        .map<PrepBuilderMoveChoice | null>((moveKey) => {
            const opponent = opponentByMove.get(moveKey) ?? null;
            const reference = referenceByMove.get(moveKey) ?? null;
            const engine = engineByMove.get(moveKey) ?? null;
            const move = opponent?.move ?? reference?.move ?? engine?.san;
            if (!move) return null;

            const opponentGames = opponent ? getOpeningTotal(opponent) : 0;
            const referenceGames = reference ? getOpeningTotal(reference) : 0;
            const opponentShare = opponentTotal > 0 ? opponentGames / opponentTotal : 0;
            const referenceShare = referenceTotal > 0 ? referenceGames / referenceTotal : 0;
            const sideScore = opponent
                ? getSideScoreForOpening(opponent, userColor)
                : reference
                  ? getSideScoreForOpening(reference, userColor)
                  : null;
            const referenceSideScore = reference
                ? getSideScoreForOpening(reference, userColor)
                : null;
            const practicalBaseline =
                opponentTotal > 0
                    ? opponentBaseline
                    : referenceTotal > 0
                      ? referenceBaseline
                      : 0.5;
            const resultLift = sideScore === null ? 0 : sideScore - practicalBaseline;
            const referenceDelta =
                sideScore !== null && referenceSideScore !== null
                    ? sideScore - referenceSideScore
                    : null;
            const sampleConfidence = clamp(
                opponentGames / Math.max(settings.minOpponentGames * 4, 1),
                0,
                1,
            );
            const shareScore = clamp(opponentShare / 0.35, 0, 1);
            const referenceComparisonScore =
                referenceDelta === null ? 0.5 : clamp(0.5 + referenceDelta * 2.2, 0, 1);
            const practicalScore =
                sideScore === null
                    ? 0.42
                    : clamp(0.5 + resultLift * 2.4, 0, 1) * 0.38 +
                      referenceComparisonScore * 0.34 +
                      sampleConfidence * 0.16 +
                      shareScore * 0.12;

            const engineCpLoss =
                engine?.scoreCpForSide !== null &&
                engine?.scoreCpForSide !== undefined &&
                bestEngineScore !== null
                    ? Math.max(0, bestEngineScore - engine.scoreCpForSide)
                    : null;
            const rankScore =
                engine?.rank !== null && engine?.rank !== undefined
                    ? clamp(1 - (engine.rank - 1) * 0.14, 0.2, 1)
                    : engine
                      ? 0.72
                      : 0.36;
            const lossScore =
                engineCpLoss === null
                    ? engine
                        ? 0.72
                        : 0.36
                    : settings.maxEngineCpLoss <= 0
                      ? engineCpLoss <= 0
                          ? 1
                          : 0
                      : clamp(1 - engineCpLoss / Math.max(settings.maxEngineCpLoss, 1), 0, 1);
            const engineScore = rankScore * 0.35 + lossScore * 0.65;
            const referenceScore =
                referenceTotal > 0 && reference
                    ? clamp(referenceShare / 0.25, 0, 1) * 0.55 +
                      clamp(0.5 + (getSideScoreForOpening(reference, userColor) - referenceBaseline) * 1.5, 0, 1) *
                          0.45
                    : 0.45;
            const engineWeight = settings.useCloudEngine ? settings.engineWeight / 100 : 0;
            const practicalWeight = 1 - engineWeight;
            const blended =
                engineScore * engineWeight +
                practicalScore * practicalWeight +
                (settings.useLichessAll && reference ? (referenceScore - 0.5) * 0.14 : 0);
            const score = Math.round(clamp(blended, 0, 1) * 100);
            const opponentScore = sideScore === null ? null : 1 - sideScore;
            const referenceOpponentScore =
                referenceSideScore === null ? null : 1 - referenceSideScore;
            const reasons = getPrepBuilderMoveReasons({
                engine,
                engineCpLoss,
                opponentGames,
                opponentScore,
                referenceOpponentScore,
                opponentReferenceDelta: referenceDelta === null ? null : -referenceDelta,
                opponentShare,
                referenceGames,
                referenceShare,
            });

            return {
                move,
                score,
                annotation: score >= 72 ? "!" : "!?",
                engineRank: engine?.rank ?? null,
                engineCpLoss,
                engineSource: engine?.source ?? null,
                opponentGames,
                opponentShare,
                opponentScore,
                referenceOpponentScore,
                opponentReferenceDelta: referenceDelta === null ? null : -referenceDelta,
                referenceGames,
                referenceShare,
                reasons,
            };
        })
        .filter((choice): choice is PrepBuilderMoveChoice => choice !== null)
        .sort(
            (a, b) =>
                b.score - a.score ||
                (a.engineRank ?? 99) - (b.engineRank ?? 99) ||
                b.opponentGames - a.opponentGames ||
                a.move.localeCompare(b.move),
        );

    return choices[0] ?? null;
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

function getPlayableOpenings(openings: Opening[]) {
    return openings.filter((opening) => opening.move !== "*" && opening.move !== "Total");
}

function isPrepBuilderMode(value: unknown): value is PrepBuilderSettings["mode"] {
    return value === "smart" || value === "engine" || value === "practical";
}

function isPrepBuilderSize(value: unknown): value is PrepBuilderSettings["size"] {
    return value === "quick" || value === "balanced" || value === "deep";
}

function getPrepBuilderSizePreset(size: PrepBuilderSettings["size"]) {
    switch (size) {
        case "quick":
            return {
                maxMoves: 10,
                maxPly: 8,
                opponentMoveLimit: 3,
                minOpponentGames: 2,
                minOpponentMoveShare: 15,
                minBranchShare: 8,
            };
        case "deep":
            return {
                maxMoves: 28,
                maxPly: 16,
                opponentMoveLimit: 5,
                minOpponentGames: 2,
                minOpponentMoveShare: 10,
                minBranchShare: 2,
            };
        case "balanced":
            return {
                maxMoves: DEFAULT_PREP_BUILDER_SETTINGS.maxMoves,
                maxPly: DEFAULT_PREP_BUILDER_SETTINGS.maxPly,
                opponentMoveLimit: DEFAULT_PREP_BUILDER_SETTINGS.opponentMoveLimit,
                minOpponentGames: DEFAULT_PREP_BUILDER_SETTINGS.minOpponentGames,
                minOpponentMoveShare: DEFAULT_PREP_BUILDER_SETTINGS.minOpponentMoveShare,
                minBranchShare: DEFAULT_PREP_BUILDER_SETTINGS.minBranchShare,
            };
    }
}

function getPrepBuilderModePreset(mode: PrepBuilderSettings["mode"]) {
    switch (mode) {
        case "engine":
            return {
                engineWeight: 82,
                breadthBias: 100,
                maxEngineCpLoss: 45,
            };
        case "practical":
            return {
                engineWeight: 32,
                breadthBias: 100,
                maxEngineCpLoss: 100,
            };
        case "smart":
            return {
                engineWeight: DEFAULT_PREP_BUILDER_SETTINGS.engineWeight,
                breadthBias: DEFAULT_PREP_BUILDER_SETTINGS.breadthBias,
                maxEngineCpLoss: DEFAULT_PREP_BUILDER_SETTINGS.maxEngineCpLoss,
            };
    }
}

function getWeightedSideScore(openings: Opening[], side: PrepColor) {
    const total = openings.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);
    if (total <= 0) return 0.5;

    return (
        openings.reduce(
            (sum, opening) =>
                sum + getSideScoreForOpening(opening, side) * getOpeningTotal(opening),
            0,
        ) / total
    );
}

function getSideScoreForOpening(opening: Pick<Opening, "white" | "draw" | "black">, side: PrepColor) {
    const total = getOpeningTotal(opening);
    if (total <= 0) return 0.5;

    const wins = side === "white" ? opening.white : opening.black;
    return (wins + opening.draw * 0.5) / total;
}

function getPrepBuilderMoveReasons({
    engine,
    engineCpLoss,
    opponentGames,
    opponentScore,
    referenceOpponentScore,
    opponentReferenceDelta,
    opponentShare,
    referenceGames,
    referenceShare,
}: {
    engine: PrepBuilderEngineMove | null;
    engineCpLoss: number | null;
    opponentGames: number;
    opponentScore: number | null;
    referenceOpponentScore: number | null;
    opponentReferenceDelta: number | null;
    opponentShare: number;
    referenceGames: number;
    referenceShare: number;
}) {
    const reasons: string[] = [];

    if (engine) {
        const source = engine.source === "lichess" ? "Lichess Cloud" : "ChessDB";
        if ((engine.rank ?? 1) === 1 && (engineCpLoss ?? 0) <= 5) {
            reasons.push(`${source} top move`);
        } else if (engine.rank !== null) {
            reasons.push(
                `${source} #${engine.rank}${engineCpLoss !== null ? `, ${Math.round(engineCpLoss)} cp behind top` : ""}`,
            );
        } else {
            reasons.push(`${source} candidate`);
        }
    }

    if (opponentGames > 0 && opponentScore !== null) {
        reasons.push(
            `Opponent scores ${Math.round(opponentScore * 100)}% in ${opponentGames} game${opponentGames === 1 ? "" : "s"}`,
        );
        if (opponentReferenceDelta !== null && referenceOpponentScore !== null) {
            const delta = Math.round(Math.abs(opponentReferenceDelta) * 100);
            if (opponentReferenceDelta >= 0.04) {
                reasons.push(`They outperform Lichess All by ${delta}% here`);
            } else if (opponentReferenceDelta <= -0.04) {
                reasons.push(`They score ${delta}% worse than Lichess All here`);
            }
        }
        if (opponentShare >= 0.1) {
            reasons.push(`${Math.round(opponentShare * 100)}% of their games from here`);
        }
    }

    if (referenceGames > 0) {
        reasons.push(
            `Lichess All support: ${Math.round(referenceShare * 100)}% share in ${referenceGames} game${referenceGames === 1 ? "" : "s"}`,
        );
    }

    if (reasons.length === 0) {
        reasons.push("Best available balance of engine and database evidence");
    }

    return reasons.slice(0, 4);
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

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function clampNumber(
    value: number | null | undefined,
    min: number,
    max: number,
    fallback: number,
) {
    return Number.isFinite(value) ? clamp(Number(value), min, max) : fallback;
}

function clampInteger(
    value: number | null | undefined,
    min: number,
    max: number,
    fallback: number,
) {
    return Math.round(clampNumber(value, min, max, fallback));
}
