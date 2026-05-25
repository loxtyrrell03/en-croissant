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
    engineRank: number | null;
    engineCpLoss: number | null;
    engineSource: PrepBuilderEngineMove["source"] | null;
    databaseRank: number | null;
    databaseScore: number | null;
    databaseWdlLoss: number | null;
    opponentGames: number;
    opponentShare: number;
    opponentScore: number | null;
    referenceOpponentScore: number | null;
    opponentReferenceDelta: number | null;
    referenceGames: number;
    referenceShare: number;
    reasons: string[];
};

type ScoredPrepBuilderMoveChoice = PrepBuilderMoveChoice & {
    engineUnsafe: boolean;
    strengthLoss: number;
};

export type PrepMoveStrength = {
    move: string;
    score: number;
    engineCp: number | null;
    engineCpLoss: number | null;
    engineSource: PrepBuilderEngineMove["source"] | null;
    databaseScore: number | null;
    databaseWdlLoss: number | null;
    engineUnsafe: boolean;
    label: string;
    detail: string;
};

type PrepStrengthCandidate = {
    move: string;
    total: number;
    databaseScore: number | null;
};

type EvaluatedPrepStrengthCandidate = PrepMoveStrength & {
    engineRank: number | null;
    strengthLoss: number;
};

const DEFAULT_STATS_MAX_PLY = 10;
const DEFAULT_STATS_MAX_POSITIONS = 12;
export const DEFAULT_PREP_BUILDER_SETTINGS: PrepBuilderSettings = {
    mode: "smart",
    size: "balanced",
    maxPly: 22,
    opponentMoveLimit: 24,
    minOpponentGames: 2,
    minOpponentMoveShare: 5,
    minBranchShare: 0.25,
    breadthBias: 100,
    engineWeight: 55,
    maxEngineCpLoss: 70,
    useCloudEngine: true,
    useLichessAll: true,
};

const DATABASE_STRENGTH_FULL_STEP = 0.18;

export function getFenTurn(fen: string): PrepColor {
    return fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
}

export function oppositePrepColor(color: PrepColor): PrepColor {
    return color === "white" ? "black" : "white";
}

export function getOpeningTotal(opening: Pick<Opening, "white" | "draw" | "black">) {
    return opening.white + opening.draw + opening.black;
}

export function hasPrepBuilderDatabaseCandidates(openings: Opening[], minGames: number) {
    return getPlayableOpenings(openings).some((opening) => getOpeningTotal(opening) >= minGames);
}

export function getPrepBuilderEvidenceMinGames({
    settings,
    rootGames,
    ply,
}: {
    settings: PrepBuilderSettings;
    rootGames: number | null | undefined;
    ply: number;
}) {
    const base = Math.max(1, settings.minOpponentGames);
    if (!rootGames || rootGames < 10_000) return base;

    const sourceFloor =
        rootGames >= 1_000_000
            ? settings.size === "deep"
                ? 25
                : settings.size === "quick"
                  ? 80
                  : 50
            : rootGames >= 100_000
              ? settings.size === "deep"
                  ? 10
                  : settings.size === "quick"
                    ? 30
                    : 20
              : settings.size === "deep"
                ? 4
                : settings.size === "quick"
                  ? 10
                  : 6;
    const depthMultiplier = ply >= 18 ? 1.35 : ply >= 12 ? 1.15 : 1;

    return Math.max(base, Math.ceil(sourceFloor * depthMultiplier));
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
        maxPly: clampInteger(settings?.maxPly, 2, 60, sizePreset.maxPly),
        opponentMoveLimit: clampInteger(
            settings?.opponentMoveLimit,
            1,
            120,
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
            0,
            80,
            sizePreset.minOpponentMoveShare,
        ),
        minBranchShare: clampNumber(settings?.minBranchShare, 0, 50, sizePreset.minBranchShare),
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
    return getOpponentPrepEligibleOpenings(openings, minGames)
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
    const totalGames = getOpponentPrepEligibleOpenings(openings, minGames).reduce(
        (sum, opening) => sum + getOpeningTotal(opening),
        0,
    );

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

export function getPrepMoveStrengthMap({
    openings,
    engineMoves = [],
    side,
    settings,
}: {
    openings: Opening[];
    engineMoves?: PrepBuilderEngineMove[];
    side: PrepColor;
    settings: PrepBuilderSettings;
}) {
    const candidates = getPlayableOpenings(openings).map((opening) => ({
        move: opening.move,
        total: getOpeningTotal(opening),
        databaseScore: getSidePracticalWdlRateForOpening(opening, side),
    }));

    return new Map(
        evaluatePrepStrengthCandidates({
            candidates,
            engineMoves,
            settings,
        }).map((candidate) => [normalizeSanForPrep(candidate.move), candidate]),
    );
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
    branchValue = 1,
    ply,
    settings,
}: {
    branchShare: number;
    branchValue?: number;
    ply: number;
    settings: PrepBuilderSettings;
}) {
    const commonness = clamp(branchShare / 0.15, 0, 1);
    const shallowBoost =
        1 + (1 - commonness) * Math.max(0, 1 - ply / Math.max(1, settings.maxPly)) * 0.35;
    const depthMomentum = 1 + commonness * clamp(ply / Math.max(1, settings.maxPly), 0, 1) * 0.25;
    const breadthExponent = clamp(settings.breadthBias / 100, 0.2, 1);
    return Math.pow(branchShare, breadthExponent) * shallowBoost * depthMomentum * branchValue;
}

export function getPrepBuilderEffectiveMaxPly({
    branchShare,
    settings,
}: {
    branchShare: number;
    settings: PrepBuilderSettings;
}) {
    const percent = branchShare * 100;
    if (percent >= 15) return settings.maxPly;
    if (percent >= 6) return Math.max(8, Math.round(settings.maxPly * 0.75));
    if (percent >= 2) return Math.max(6, Math.round(settings.maxPly * 0.45));

    const rareDepth = settings.size === "deep" ? 6 : settings.size === "quick" ? 3 : 4;
    return Math.min(settings.maxPly, rareDepth);
}

export function getPrepBuilderReplyPolicy({
    branchShare,
    settings,
}: {
    branchShare: number;
    settings: PrepBuilderSettings;
}) {
    const percent = branchShare * 100;
    const fullLimit = Math.max(1, settings.opponentMoveLimit);

    if (percent >= 15) {
        return {
            moveLimit: fullLimit,
            minMoveShare: settings.minOpponentMoveShare,
        };
    }

    if (percent >= 6) {
        return {
            moveLimit: Math.max(6, Math.ceil(fullLimit * 0.55)),
            minMoveShare: Math.max(settings.minOpponentMoveShare, settings.size === "deep" ? 2 : 5),
        };
    }

    if (percent >= 2) {
        return {
            moveLimit: Math.max(4, Math.ceil(fullLimit * 0.25)),
            minMoveShare: Math.max(
                settings.minOpponentMoveShare,
                settings.size === "deep" ? 5 : 10,
            ),
        };
    }

    return {
        moveLimit: Math.max(2, Math.ceil(fullLimit * 0.08)),
        minMoveShare: Math.max(settings.minOpponentMoveShare, settings.size === "deep" ? 10 : 15),
    };
}

export function getPrepBuilderUserResponseChildIndex(node: TreeNode) {
    return node.children.length > 0 ? 0 : null;
}

export function getPrepBuilderStopReason({
    branchShare,
    depthShare = branchShare,
    ply,
    availableGames,
    minGames,
    settings,
}: {
    branchShare: number;
    depthShare?: number;
    ply: number;
    availableGames?: number | null;
    minGames?: number;
    settings: PrepBuilderSettings;
}) {
    if (ply >= getPrepBuilderEffectiveMaxPly({ branchShare: depthShare, settings })) {
        return "Depth cap reached";
    }
    if (depthShare * 100 < settings.minBranchShare) return "Line became too rare";
    if (availableGames !== undefined && availableGames !== null) {
        if (availableGames < Math.max(1, minGames ?? settings.minOpponentGames)) {
            return "Not enough games left";
        }
    }
    return null;
}

export function getPrepBuilderBranchValue({
    opening,
    userColor,
    settings,
}: {
    opening: Pick<Opening, "white" | "draw" | "black">;
    userColor: PrepColor;
    settings: PrepBuilderSettings;
}) {
    const games = getOpeningTotal(opening);
    const userScore = getSideScoreForOpening(opening, userColor);
    const practicalRisk = 1 - userScore;
    const sampleConfidence = clamp(games / Math.max(settings.minOpponentGames * 12, 1), 0, 1);
    const uncertainty = 1 - sampleConfidence * 0.65;

    return clamp(0.55 + practicalRisk * 0.75 + uncertainty * 0.3, 0.45, 1.65);
}

export function choosePrepBuilderMove({
    opponentOpenings,
    referenceOpenings = [],
    engineMoves = [],
    userColor,
    settings,
    minGames,
}: {
    opponentOpenings: Opening[];
    referenceOpenings?: Opening[];
    engineMoves?: PrepBuilderEngineMove[];
    userColor: PrepColor;
    settings: PrepBuilderSettings;
    minGames?: number;
}): PrepBuilderMoveChoice | null {
    const requiredGames = Math.max(1, minGames ?? settings.minOpponentGames);
    const playableOpponent = getPlayableOpenings(opponentOpenings);
    const playableReference = getPlayableOpenings(referenceOpenings);
    const eligibleOpponent = playableOpponent.filter(
        (opening) => getOpeningTotal(opening) >= requiredGames,
    );
    const opponentTotal = playableOpponent.reduce(
        (sum, opening) => sum + getOpeningTotal(opening),
        0,
    );
    const referenceTotal = playableReference.reduce(
        (sum, opening) => sum + getOpeningTotal(opening),
        0,
    );
    const opponentBaseline = getWeightedSidePracticalWdlRate(playableOpponent, userColor);
    const referenceBaseline = getWeightedSidePracticalWdlRate(playableReference, userColor);
    const opponentByMove = new Map(
        playableOpponent.map((opening) => [normalizeSanForPrep(opening.move), opening]),
    );
    const referenceByMove = new Map(
        playableReference.map((opening) => [normalizeSanForPrep(opening.move), opening]),
    );
    if (eligibleOpponent.length === 0) return null;

    const moves = new Set<string>();

    for (const opening of eligibleOpponent) {
        moves.add(normalizeSanForPrep(opening.move));
    }

    const strengthCandidates = Array.from(moves)
        .map<{
            moveKey: string;
            move: string;
            opponent: Opening | null;
            reference: Opening | null;
            opponentGames: number;
            referenceGames: number;
            opponentShare: number;
            referenceShare: number;
            opponentSideScore: number | null;
            referenceSideScore: number | null;
            posteriorSideScore: number;
            referenceDelta: number | null;
        } | null>((moveKey) => {
            const opponent = opponentByMove.get(moveKey) ?? null;
            const reference = referenceByMove.get(moveKey) ?? null;
            const move = opponent?.move ?? reference?.move;
            if (!move) return null;

            const opponentGames = opponent ? getOpeningTotal(opponent) : 0;
            const referenceGames = reference ? getOpeningTotal(reference) : 0;
            const opponentShare = opponentTotal > 0 ? opponentGames / opponentTotal : 0;
            const referenceShare = referenceTotal > 0 ? referenceGames / referenceTotal : 0;
            const opponentSideScore = opponent
                ? getSidePracticalWdlRateForOpening(opponent, userColor)
                : null;
            const referenceSideScore = reference
                ? getSidePracticalWdlRateForOpening(reference, userColor)
                : null;
            const practicalBaseline =
                opponentTotal > 0 ? opponentBaseline : referenceTotal > 0 ? referenceBaseline : 0.5;
            const referenceDelta =
                opponentSideScore !== null && referenceSideScore !== null
                    ? opponentSideScore - referenceSideScore
                    : null;
            const referencePriorGames = getPrepBuilderReferencePriorGames(referenceGames, settings);
            const posteriorSideScore = getPrepBuilderPosteriorSideScore({
                opponentScore: opponentSideScore,
                opponentGames,
                referenceScore:
                    referenceSideScore ??
                    (referenceTotal > 0 ? referenceBaseline : practicalBaseline),
                referencePriorGames,
            });

            return {
                moveKey,
                move,
                opponent,
                reference,
                opponentGames,
                referenceGames,
                opponentShare,
                referenceShare,
                opponentSideScore,
                referenceSideScore,
                posteriorSideScore,
                referenceDelta,
            };
        })
        .filter((choice): choice is NonNullable<typeof choice> => choice !== null);
    const databaseRanks = getPrepBuilderDatabaseRanksFromScores(
        strengthCandidates.map((candidate) => ({
            key: candidate.moveKey,
            move: candidate.move,
            total: candidate.opponentGames,
            databaseScore: candidate.posteriorSideScore,
        })),
    );
    const strengthByMove = new Map(
        evaluatePrepStrengthCandidates({
            candidates: strengthCandidates.map((candidate) => ({
                move: candidate.move,
                total: candidate.opponentGames,
                databaseScore: candidate.posteriorSideScore,
            })),
            engineMoves,
            settings,
        }).map((candidate) => [normalizeSanForPrep(candidate.move), candidate]),
    );
    const scoredChoices = strengthCandidates.map<ScoredPrepBuilderMoveChoice>((candidate) => {
        const strength = strengthByMove.get(candidate.moveKey)!;
        const opponentScore =
            candidate.opponentSideScore === null ? null : 1 - candidate.opponentSideScore;
        const referenceOpponentScore =
            candidate.referenceSideScore === null ? null : 1 - candidate.referenceSideScore;
        const databaseRank = databaseRanks.get(candidate.moveKey) ?? null;

        return {
            move: candidate.move,
            score: strength.score,
            engineRank: strength.engineRank,
            engineCpLoss: strength.engineCpLoss,
            engineSource: strength.engineSource,
            databaseRank,
            databaseScore: strength.databaseScore,
            databaseWdlLoss: strength.databaseWdlLoss,
            opponentGames: candidate.opponentGames,
            opponentShare: candidate.opponentShare,
            opponentScore,
            referenceOpponentScore,
            opponentReferenceDelta:
                candidate.referenceDelta === null ? null : -candidate.referenceDelta,
            referenceGames: candidate.referenceGames,
            referenceShare: candidate.referenceShare,
            reasons: getPrepBuilderMoveReasons({ strength }),
            engineUnsafe: strength.engineUnsafe,
            strengthLoss: strength.strengthLoss,
        };
    });
    const safeChoices = scoredChoices.filter((choice) => !choice.engineUnsafe);
    const choices = (safeChoices.length > 0 ? safeChoices : scoredChoices).sort(
        comparePrepBuilderChoices,
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

function getOpponentPrepEligibleOpenings(openings: Opening[], minGames: number) {
    return getPlayableOpenings(openings).filter(
        (opening) => getOpeningTotal(opening) >= Math.max(1, minGames),
    );
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
                maxPly: 8,
                opponentMoveLimit: 8,
                minOpponentGames: 2,
                minOpponentMoveShare: 15,
                minBranchShare: 5,
            };
        case "deep":
            return {
                maxPly: 40,
                opponentMoveLimit: 100,
                minOpponentGames: 2,
                minOpponentMoveShare: 1,
                minBranchShare: 0.02,
            };
        case "balanced":
            return {
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

function comparePrepBuilderChoices(a: ScoredPrepBuilderMoveChoice, b: ScoredPrepBuilderMoveChoice) {
    return (
        a.strengthLoss - b.strengthLoss ||
        (a.engineRank ?? 99) - (b.engineRank ?? 99) ||
        b.opponentGames - a.opponentGames ||
        a.move.localeCompare(b.move)
    );
}

function getPrepBuilderReferencePriorGames(referenceGames: number, settings: PrepBuilderSettings) {
    const base = settings.mode === "engine" ? 22 : settings.mode === "practical" ? 10 : 16;
    if (referenceGames <= 0) return base;

    const max = settings.mode === "engine" ? 44 : settings.mode === "practical" ? 24 : 36;
    return clamp(Math.sqrt(referenceGames) * 1.5, base, max);
}

function getPrepBuilderPosteriorSideScore({
    opponentScore,
    opponentGames,
    referenceScore,
    referencePriorGames,
}: {
    opponentScore: number | null;
    opponentGames: number;
    referenceScore: number;
    referencePriorGames: number;
}) {
    if (opponentScore === null || opponentGames <= 0) return referenceScore;

    return (
        (opponentScore * opponentGames + referenceScore * referencePriorGames) /
        (opponentGames + referencePriorGames)
    );
}

function evaluatePrepStrengthCandidates({
    candidates,
    engineMoves,
    settings,
}: {
    candidates: PrepStrengthCandidate[];
    engineMoves: PrepBuilderEngineMove[];
    settings: PrepBuilderSettings;
}): EvaluatedPrepStrengthCandidate[] {
    const playable = candidates.filter((candidate) => candidate.total > 0);
    const scoredEngineMoves = settings.useCloudEngine
        ? engineMoves.filter((move) => move.scoreCpForSide !== null)
        : [];
    const bestEngineScore =
        scoredEngineMoves.length > 0
            ? Math.max(...scoredEngineMoves.map((move) => move.scoreCpForSide!))
            : null;
    const bestDatabaseScore =
        playable.length > 0
            ? Math.max(
                  ...playable.map((candidate) =>
                      candidate.databaseScore === null ? 0 : candidate.databaseScore,
                  ),
              )
            : null;
    const engineByMove = new Map(engineMoves.map((move) => [normalizeSanForPrep(move.san), move]));
    const maxEngineCpLoss = Math.max(1, settings.maxEngineCpLoss);
    const smartEngineWeight = clamp(settings.engineWeight / 100, 0, 1);

    return playable.map((candidate) => {
        const key = normalizeSanForPrep(candidate.move);
        const engine = engineByMove.get(key) ?? null;
        const engineCp = engine?.scoreCpForSide ?? null;
        const engineCpLoss =
            engineCp !== null && bestEngineScore !== null
                ? Math.max(0, bestEngineScore - engineCp)
                : null;
        const databaseScore = candidate.databaseScore;
        const databaseWdlLoss =
            databaseScore !== null && bestDatabaseScore !== null
                ? Math.max(0, bestDatabaseScore - databaseScore)
                : null;
        const hasEngineCloud = settings.useCloudEngine && engineMoves.length > 0;
        const engineUnsafe =
            hasEngineCloud &&
            (engineCpLoss === null
                ? settings.mode !== "practical"
                : engineCpLoss > maxEngineCpLoss);
        const engineLossNorm =
            !settings.useCloudEngine || engineMoves.length === 0
                ? 0
                : engineCpLoss === null
                  ? settings.mode === "practical"
                      ? 0.55
                      : 1.25
                  : clamp(engineCpLoss / maxEngineCpLoss, 0, 1.5);
        const databaseLossNorm =
            databaseWdlLoss === null
                ? 0.75
                : clamp(databaseWdlLoss / DATABASE_STRENGTH_FULL_STEP, 0, 1.5);
        const strengthLoss = getPrepStrengthLoss({
            settings,
            engineLossNorm,
            databaseLossNorm,
            smartEngineWeight,
        });
        const score = Math.round((1 - clamp(strengthLoss, 0, 1)) * 100);

        return {
            move: candidate.move,
            score,
            engineCp,
            engineCpLoss,
            engineSource: engine?.source ?? null,
            databaseScore,
            databaseWdlLoss,
            engineUnsafe,
            label: score.toString(),
            detail: formatPrepStrengthDetail({
                engineCp,
                engineCpLoss,
                databaseScore,
                databaseWdlLoss,
                engineMoves,
                settings,
            }),
            engineRank: engine?.rank ?? null,
            strengthLoss,
        };
    });
}

function getPrepStrengthLoss({
    settings,
    engineLossNorm,
    databaseLossNorm,
    smartEngineWeight,
}: {
    settings: PrepBuilderSettings;
    engineLossNorm: number;
    databaseLossNorm: number;
    smartEngineWeight: number;
}) {
    if (settings.mode === "engine") {
        return engineLossNorm + databaseLossNorm * 0.12;
    }
    if (settings.mode === "practical") {
        return databaseLossNorm + engineLossNorm * 0.18;
    }

    return engineLossNorm * smartEngineWeight + databaseLossNorm * (1 - smartEngineWeight);
}

function getWeightedSidePracticalWdlRate(openings: Opening[], side: PrepColor) {
    const total = openings.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);
    if (total <= 0) return 0.5;

    return (
        openings.reduce(
            (sum, opening) =>
                sum + getSidePracticalWdlRateForOpening(opening, side) * getOpeningTotal(opening),
            0,
        ) / total
    );
}

function getPrepBuilderDatabaseRanksFromScores(
    candidates: { key: string; move: string; total: number; databaseScore: number | null }[],
) {
    const ranked = candidates
        .filter((candidate) => candidate.total > 0 && candidate.databaseScore !== null)
        .sort(
            (a, b) =>
                b.databaseScore! - a.databaseScore! ||
                b.total - a.total ||
                a.move.localeCompare(b.move),
        );

    return new Map(ranked.map((candidate, index) => [candidate.key, index + 1]));
}

function getSideScoreForOpening(
    opening: Pick<Opening, "white" | "draw" | "black">,
    side: PrepColor,
) {
    const total = getOpeningTotal(opening);
    if (total <= 0) return 0.5;

    const wins = side === "white" ? opening.white : opening.black;
    return (wins + opening.draw * 0.5) / total;
}

function getSidePracticalWdlRateForOpening(
    opening: Pick<Opening, "white" | "draw" | "black">,
    side: PrepColor,
) {
    const total = getOpeningTotal(opening);
    if (total <= 0) return 0;

    const wins = side === "white" ? opening.white : opening.black;
    return (wins + opening.draw * 0.35) / total;
}

function getPrepBuilderMoveReasons({ strength }: { strength: EvaluatedPrepStrengthCandidate }) {
    const reasons: string[] = [];

    if (strength.engineCpLoss !== null) {
        reasons.push(
            strength.engineCpLoss <= 0
                ? "Engine: best cloud move"
                : `Engine: -${Math.round(strength.engineCpLoss)} cp from best`,
        );
    } else {
        reasons.push("Engine: unavailable");
    }

    if (strength.databaseWdlLoss !== null) {
        reasons.push(
            strength.databaseWdlLoss <= 0
                ? "Database: best WDL"
                : `Database: -${formatPrepWdlPointLoss(strength.databaseWdlLoss)} pts`,
        );
    } else {
        reasons.push("Database: unavailable");
    }

    return reasons;
}

function formatPrepStrengthDetail({
    engineCp,
    engineCpLoss,
    databaseScore,
    databaseWdlLoss,
    engineMoves,
    settings,
}: {
    engineCp: number | null;
    engineCpLoss: number | null;
    databaseScore: number | null;
    databaseWdlLoss: number | null;
    engineMoves: PrepBuilderEngineMove[];
    settings: PrepBuilderSettings;
}) {
    const parts: string[] = [];

    if (!settings.useCloudEngine) {
        parts.push("Engine off");
    } else if (engineMoves.length === 0) {
        parts.push("Engine unavailable");
    } else if (engineCpLoss === null) {
        parts.push("Engine not in cloud moves");
    } else {
        const cp =
            engineCp === null ? "" : ` (${engineCp > 0 ? "+" : ""}${Math.round(engineCp)} cp)`;
        parts.push(
            engineCpLoss <= 0 ? `Engine best${cp}` : `Engine -${Math.round(engineCpLoss)} cp${cp}`,
        );
    }

    if (databaseScore === null) {
        parts.push("WDL unavailable");
    } else {
        const scoreText = `${(databaseScore * 100).toFixed(1)}%`;
        parts.push(
            databaseWdlLoss === null || databaseWdlLoss <= 0
                ? `WDL best ${scoreText}`
                : `WDL -${formatPrepWdlPointLoss(databaseWdlLoss)} pts (${scoreText})`,
        );
    }

    return parts.join("; ");
}

function formatPrepWdlPointLoss(value: number) {
    return (value * 100).toFixed(value >= 0.1 ? 0 : 1).replace(/\.0$/, "");
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

function clampNumber(value: number | null | undefined, min: number, max: number, fallback: number) {
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
