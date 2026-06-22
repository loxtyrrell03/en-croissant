import { isNormal, makeUci, type Move } from "chessops";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import type { Opening } from "@/utils/db";
import { positionFromFen } from "@/utils/chessops";
import {
    ENGINE_CLUSTER_FULL_PRACTICAL_SPREAD_CP,
    getEngineScoreSpreadCp,
    getSmartMoveStrengthEngineWeight,
    getUsageAwarePracticalWdlRate,
} from "@/utils/moveStrength";
import { getWinChance } from "@/utils/score";
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
    preparedLineImpact: OpponentPrepLineImpact | null;
};

export type OpponentPrepLineImpact = {
    surfaceScore: number;
    surfaceGames: number;
    userMove: string;
    userScore: number;
    userGames: number;
    userShare: number;
    opponentReplyMove: string | null;
    opponentReplyScore: number | null;
    opponentReplyGames: number | null;
    opponentReplyShare: number | null;
    userResponseMove: string | null;
    userResponseScore: number | null;
    userResponseGames: number | null;
    userResponseShare: number | null;
    userResponseStrengthScore: number | null;
    userResponseStrength: PrepMoveStrength | null;
    continuationMoves: string[];
    continuationUserScore: number | null;
    continuationOpponentScore: number | null;
    continuationGames: number | null;
    continuationStrengthScore: number | null;
    continuationStrength: PrepMoveStrength | null;
    continuationLineScore: number | null;
    continuationLineStrength: PrepMoveStrength | null;
    continuationDepthPly: number;
    continuationWeight: number;
    scoreDrop: number;
    weightedScoreDrop: number;
    weightedStrengthScore: number;
};

type PrepLineMoveImpact = {
    move: string;
    games: number;
    share: number;
    score: number;
    strengthScore: number | null;
    strength: PrepMoveStrength | null;
    lineScore: number | null;
    lineStrength: PrepMoveStrength | null;
};

type CandidateContinuationImpact = {
    moves: string[];
    userScore: number;
    opponentScore: number;
    games: number;
    strengthScore: number;
    strength: PrepMoveStrength;
    lineScore: number;
    lineStrength: PrepMoveStrength;
    depthPly: number;
    weight: number;
    scoreDrop: number;
    weightedScoreDrop: number;
    weightedStrengthScore: number;
    weightedLineScore: number;
    firstOpponentReply: PrepLineMoveImpact | null;
    firstUserResponse: PrepLineMoveImpact | null;
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
    source: "local-lichess" | "lichess" | "chessdb";
};

export type PrepBuilderLoadEngineMoves = (
    fen: string,
    side: PrepColor,
    settings: PrepBuilderSettings,
) => Promise<PrepBuilderEngineMove[]>;

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

export type PrepStraightLineStep = {
    actor: "user" | "opponent";
    fen: string;
    move: string;
    uci: string | null;
    total: number | null;
    share: number | null;
    secondMove: string | null;
    secondShare: number | null;
    engineCpForUser: number | null;
    bestMoveForOpponent: string | null;
};

export type PrepStraightLineSearchMode = "strict" | "venom";

export type PrepStraightLineCandidate = {
    steps: PrepStraightLineStep[];
    leafFen: string;
    leafBestMove: string | null;
    leafScoreCpForUser: number | null;
    bestOpportunityCpForUser: number | null;
    targetMove: string | null;
    targetPositionCpForUser: number | null;
    targetBestMoveForOpponent: string | null;
    reachProbability: number;
    opportunityScore: number;
    minOpponentShare: number;
    opponentGamesFloor: number;
    opponentMoveCount: number;
    searchedPositions: number;
};

export type PrepStraightLineForcedMove = {
    move: string;
    uci: string | null;
    total: number;
    share: number;
    secondMove: string | null;
    secondShare: number | null;
};

export type PrepStraightLineSearchSummary = {
    best: PrepStraightLineCandidate | null;
    candidates: PrepStraightLineCandidate[];
    checkedPositions: number;
    userPositionsWithoutMoves: number;
    opponentPositionsWithoutForcedMove: number;
    leafPositionsWithoutEngine: number;
    stopped: boolean;
};

export type PrepStraightLineSearchProgress = {
    phase: string;
    checkedPositions: number;
    candidates: number;
};

type PrepStrengthCandidate = {
    move: string;
    total: number;
    usageShare: number | null;
    databaseScore: number | null;
};

type EvaluatedPrepStrengthCandidate = PrepMoveStrength & {
    engineRank: number | null;
    strengthLoss: number;
};

const DEFAULT_STATS_MAX_PLY = 10;
const DEFAULT_STATS_MAX_POSITIONS = 12;
const PREP_LINE_IMPACT_MIN_SURFACE_SCORE = 0.55;
const PREP_LINE_IMPACT_MIN_SCORE_DROP = 0.12;
const PREP_LINE_IMPACT_MIN_USER_SHARE = 0.08;
const PREP_LINE_IMPACT_MIN_OPPONENT_REPLY_SHARE = 0.4;
const PREP_CANDIDATE_LINE_MAX_USER_RESPONSES = 3;
const PREP_CANDIDATE_LINE_DEPTH_DECAY = 0.85;
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
const DATABASE_STRENGTH_BENCHMARK_MIN_GAMES = 3;
const DATABASE_STRENGTH_BENCHMARK_MIN_SHARE = 0.08;
const MISSING_ENGINE_SCORE_LOSS_NORM = 0.75;
const PRACTICAL_MISSING_ENGINE_SCORE_LOSS_NORM = 0.35;
const LOW_SAMPLE_STRENGTH_CAP_MAX_GAMES = 2;
const LOW_SAMPLE_STRENGTH_CAP_MAX_SHARE = 0.08;
const LOW_SAMPLE_SMART_STRENGTH_CAP = 72;
const LOW_SAMPLE_PRACTICAL_STRENGTH_CAP = 58;

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
    const playableOpenings = getPlayableOpenings(openings);
    const positionGames = playableOpenings.reduce(
        (sum, opening) => sum + getOpeningTotal(opening),
        0,
    );
    const candidates = playableOpenings.map((opening) => ({
        move: opening.move,
        total: getOpeningTotal(opening),
        usageShare: positionGames > 0 ? getOpeningTotal(opening) / positionGames : null,
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

export function applyPrepSanMove(fen: string, san: string) {
    const [pos] = positionFromFen(fen);
    if (!pos) return null;

    const move = parseSan(pos, san);
    if (!move) return null;

    pos.play(move);
    return makeFen(pos.toSetup());
}

export function getPrepStraightLineForcedMove({
    fen,
    openings,
    minGames,
    minShare,
}: {
    fen: string;
    openings: Opening[];
    minGames: number;
    minShare: number;
}): PrepStraightLineForcedMove | null {
    const playable = getPlayableOpenings(openings).sort(
        (a, b) =>
            getOpeningTotal(b) - getOpeningTotal(a) ||
            getOpeningDateSortValue(b) - getOpeningDateSortValue(a) ||
            a.move.localeCompare(b.move),
    );
    const totalGames = playable.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);
    const top = playable[0];
    if (!top || totalGames <= 0) return null;

    const topTotal = getOpeningTotal(top);
    const share = topTotal / totalGames;
    if (topTotal < minGames || share < minShare) return null;

    const second = playable[1] ?? null;
    const secondTotal = second ? getOpeningTotal(second) : 0;

    return {
        move: top.move,
        uci: getMoveUciFromSan(fen, top.move),
        total: topTotal,
        share,
        secondMove: second?.move ?? null,
        secondShare: totalGames > 0 ? secondTotal / totalGames : null,
    };
}

export function comparePrepStraightLineCandidates(
    a: PrepStraightLineCandidate,
    b: PrepStraightLineCandidate,
) {
    return (
        getPrepStraightLineScore(b) - getPrepStraightLineScore(a) ||
        (b.bestOpportunityCpForUser ?? -9999) - (a.bestOpportunityCpForUser ?? -9999) ||
        b.opponentMoveCount - a.opponentMoveCount ||
        b.minOpponentShare - a.minOpponentShare ||
        b.opponentGamesFloor - a.opponentGamesFloor
    );
}

export function isPrepStraightLineBadForOpponent(
    candidate: PrepStraightLineCandidate | null | undefined,
    minCpForUser: number,
) {
    return (candidate?.bestOpportunityCpForUser ?? -Infinity) >= minCpForUser;
}

export async function findPrepStraightLineCandidates({
    mode = "strict",
    startFen,
    opponentColor,
    minGames,
    minShare,
    maxPly,
    userCandidateLimit,
    maxFrontier,
    maxPositions,
    loadOpenings,
    loadEngineMoves,
    isCancelled = () => false,
    onProgress,
}: {
    mode?: PrepStraightLineSearchMode;
    startFen: string;
    opponentColor: PrepColor;
    minGames: number;
    minShare: number;
    maxPly: number;
    userCandidateLimit: number;
    maxFrontier: number;
    maxPositions: number;
    loadOpenings: (fen: string) => Promise<Opening[]>;
    loadEngineMoves: (fen: string) => Promise<PrepBuilderEngineMove[]>;
    isCancelled?: () => boolean;
    onProgress?: (progress: PrepStraightLineSearchProgress) => void;
}): Promise<PrepStraightLineSearchSummary> {
    type SearchNode = {
        fen: string;
        steps: PrepStraightLineStep[];
        ply: number;
        minOpponentShare: number;
        opponentGamesFloor: number;
        opponentMoveCount: number;
        reachProbability: number;
        targetMove: string | null;
        targetPositionCpForUser: number | null;
        targetBestMoveForOpponent: string | null;
    };

    let checkedPositions = 0;
    let userPositionsWithoutMoves = 0;
    let opponentPositionsWithoutForcedMove = 0;
    let leafPositionsWithoutEngine = 0;
    const candidates: PrepStraightLineCandidate[] = [];
    let frontier: SearchNode[] = [
        {
            fen: startFen,
            steps: [],
            ply: 0,
            minOpponentShare: 1,
            opponentGamesFloor: Number.MAX_SAFE_INTEGER,
            opponentMoveCount: 0,
            reachProbability: 1,
            targetMove: null,
            targetPositionCpForUser: null,
            targetBestMoveForOpponent: null,
        },
    ];

    const getBestEngineMove = async (fen: string) => {
        const moves = await loadEngineMoves(fen);
        return sortPrepStraightLineEngineMoves(moves)[0] ?? null;
    };

    while (frontier.length > 0 && checkedPositions < maxPositions && !isCancelled()) {
        const nextFrontier: SearchNode[] = [];

        for (const node of frontier) {
            if (isCancelled() || checkedPositions >= maxPositions) break;
            if (node.ply >= maxPly) continue;

            checkedPositions += 1;
            const isOpponentTurn = getFenTurn(node.fen) === opponentColor;
            onProgress?.({
                phase: isOpponentTurn
                    ? mode === "venom"
                        ? "Checking habitual replies"
                        : "Checking forced replies"
                    : "Checking candidate replies",
                checkedPositions,
                candidates: candidates.length,
            });

            if (isOpponentTurn) {
                const openings = await loadOpenings(node.fen);
                const forced = getPrepStraightLineForcedMove({
                    fen: node.fen,
                    openings,
                    minGames,
                    minShare,
                });
                if (!forced) {
                    opponentPositionsWithoutForcedMove += 1;
                    continue;
                }

                const nextFen = applyPrepSanMove(node.fen, forced.move);
                if (!nextFen) continue;
                const opponentMoveEval = await getPrepStraightLineOpponentMoveEval({
                    fen: node.fen,
                    playedMove: forced.move,
                    loadEngineMoves,
                });
                const targetPositionCandidate =
                    mode === "venom" ? opponentMoveEval.playedScoreCpForUser : null;
                const improvesTarget =
                    targetPositionCandidate !== null &&
                    (node.targetPositionCpForUser === null ||
                        targetPositionCandidate > node.targetPositionCpForUser);
                const targetPositionCpForUser = improvesTarget
                    ? targetPositionCandidate
                    : node.targetPositionCpForUser;

                const nextSteps: PrepStraightLineStep[] = [
                    ...node.steps,
                    {
                        actor: "opponent",
                        fen: node.fen,
                        move: forced.move,
                        uci: forced.uci,
                        total: forced.total,
                        share: forced.share,
                        secondMove: forced.secondMove,
                        secondShare: forced.secondShare,
                        engineCpForUser: opponentMoveEval.playedScoreCpForUser,
                        bestMoveForOpponent: opponentMoveEval.bestMoveForOpponent,
                    },
                ];
                const nextNode: SearchNode = {
                    fen: nextFen,
                    steps: nextSteps,
                    ply: node.ply + 1,
                    minOpponentShare: Math.min(node.minOpponentShare, forced.share),
                    opponentGamesFloor: Math.min(node.opponentGamesFloor, forced.total),
                    opponentMoveCount: node.opponentMoveCount + 1,
                    reachProbability: node.reachProbability * forced.share,
                    targetMove: improvesTarget ? forced.move : node.targetMove,
                    targetPositionCpForUser,
                    targetBestMoveForOpponent: improvesTarget
                        ? opponentMoveEval.bestMoveForOpponent
                        : node.targetBestMoveForOpponent,
                };
                const leafEngine = await getBestEngineMove(nextFen);
                if (!leafEngine) leafPositionsWithoutEngine += 1;
                const bestOpportunityCpForUser = getPrepStraightLineOpportunityCp({
                    mode,
                    leafScoreCpForUser: leafEngine?.scoreCpForSide ?? null,
                    targetPositionCpForUser,
                });
                candidates.push({
                    ...nextNode,
                    leafFen: nextFen,
                    leafBestMove: leafEngine?.san ?? null,
                    leafScoreCpForUser: leafEngine?.scoreCpForSide ?? null,
                    bestOpportunityCpForUser,
                    opportunityScore: getPrepStraightLineOpportunityScore({
                        bestOpportunityCpForUser,
                        reachProbability: nextNode.reachProbability,
                        opponentGamesFloor: nextNode.opponentGamesFloor,
                        opponentMoveCount: nextNode.opponentMoveCount,
                        mode,
                    }),
                    searchedPositions: checkedPositions,
                });
                nextFrontier.push(nextNode);
                continue;
            }

            const userReplies = await getPrepStraightLineUserReplies({
                fen: node.fen,
                userCandidateLimit,
                loadOpenings,
                loadEngineMoves,
            });
            if (userReplies.length === 0) {
                userPositionsWithoutMoves += 1;
                continue;
            }

            for (const reply of userReplies) {
                const nextFen = applyPrepSanMove(node.fen, reply.move);
                if (!nextFen) continue;

                nextFrontier.push({
                    ...node,
                    fen: nextFen,
                    steps: [
                        ...node.steps,
                        {
                            actor: "user",
                            fen: node.fen,
                            move: reply.move,
                            uci: null,
                            total: reply.total,
                            share: reply.share,
                            secondMove: null,
                            secondShare: null,
                            engineCpForUser: reply.engineCpForUser,
                            bestMoveForOpponent: null,
                        },
                    ],
                    ply: node.ply + 1,
                });
            }
        }

        frontier = nextFrontier
            .sort(
                (a, b) => getPrepStraightLineFrontierScore(b) - getPrepStraightLineFrontierScore(a),
            )
            .slice(0, Math.max(1, maxFrontier));
    }

    const sortedCandidates = candidates.sort(comparePrepStraightLineCandidates);
    return {
        best: sortedCandidates[0] ?? null,
        candidates: sortedCandidates,
        checkedPositions,
        userPositionsWithoutMoves,
        opponentPositionsWithoutForcedMove,
        leafPositionsWithoutEngine,
        stopped: isCancelled(),
    };
}

function getPrepStraightLineScore(candidate: PrepStraightLineCandidate) {
    const evalScore = candidate.bestOpportunityCpForUser ?? -300;
    const forceBonus = Math.round(candidate.minOpponentShare * 60);
    const depthBonus = Math.min(80, candidate.opponentMoveCount * 16);
    const evidenceBonus = Math.min(40, Math.log2(candidate.opponentGamesFloor + 1) * 6);

    return candidate.opportunityScore + evalScore + forceBonus + depthBonus + evidenceBonus;
}

function getPrepStraightLineFrontierScore(node: {
    steps: PrepStraightLineStep[];
    minOpponentShare: number;
    opponentMoveCount: number;
    opponentGamesFloor: number;
}) {
    const lastUserScore =
        [...node.steps].reverse().find((step) => step.actor === "user")?.engineCpForUser ?? 0;
    const gamesFloor =
        node.opponentGamesFloor === Number.MAX_SAFE_INTEGER ? 0 : node.opponentGamesFloor;

    return (
        lastUserScore +
        node.minOpponentShare * 50 +
        node.opponentMoveCount * 18 +
        Math.log2(gamesFloor + 1) * 5
    );
}

async function getPrepStraightLineOpponentMoveEval({
    fen,
    playedMove,
    loadEngineMoves,
}: {
    fen: string;
    playedMove: string;
    loadEngineMoves: (fen: string) => Promise<PrepBuilderEngineMove[]>;
}) {
    const engineMoves = (await loadEngineMoves(fen)).filter((move) => move.scoreCpForSide !== null);
    const bestMoveForOpponent = [...engineMoves].sort(
        (a, b) =>
            (a.scoreCpForSide ?? 9999) - (b.scoreCpForSide ?? 9999) ||
            (a.rank ?? 99) - (b.rank ?? 99) ||
            a.san.localeCompare(b.san),
    )[0];
    const played = engineMoves.find(
        (move) => normalizeSanForPrep(move.san) === normalizeSanForPrep(playedMove),
    );
    const playedScoreCpForUser = played?.scoreCpForSide ?? null;

    return {
        playedScoreCpForUser,
        bestMoveForOpponent: bestMoveForOpponent?.san ?? null,
    };
}

function getPrepStraightLineOpportunityCp({
    mode,
    leafScoreCpForUser,
    targetPositionCpForUser,
}: {
    mode: PrepStraightLineSearchMode;
    leafScoreCpForUser: number | null;
    targetPositionCpForUser: number | null;
}) {
    return mode === "venom" ? targetPositionCpForUser : leafScoreCpForUser;
}

function getPrepStraightLineOpportunityScore({
    bestOpportunityCpForUser,
    reachProbability,
    opponentGamesFloor,
    opponentMoveCount,
    mode,
}: {
    bestOpportunityCpForUser: number | null;
    reachProbability: number;
    opponentGamesFloor: number;
    opponentMoveCount: number;
    mode: PrepStraightLineSearchMode;
}) {
    const cp = bestOpportunityCpForUser ?? -300;
    const reachBonus = Math.sqrt(Math.max(0, reachProbability)) * (mode === "venom" ? 90 : 45);
    const evidenceBonus = Math.min(55, Math.log2(opponentGamesFloor + 1) * 8);
    const depthBonus = Math.min(40, opponentMoveCount * 8);

    return cp + reachBonus + evidenceBonus + depthBonus;
}

async function getPrepStraightLineUserReplies({
    fen,
    userCandidateLimit,
    loadOpenings,
    loadEngineMoves,
}: {
    fen: string;
    userCandidateLimit: number;
    loadOpenings: (fen: string) => Promise<Opening[]>;
    loadEngineMoves: (fen: string) => Promise<PrepBuilderEngineMove[]>;
}) {
    const engineReplies = sortPrepStraightLineEngineMoves(await loadEngineMoves(fen));
    if (engineReplies.length > 0) {
        return engineReplies.slice(0, userCandidateLimit).map((move) => ({
            move: move.san,
            engineCpForUser: move.scoreCpForSide,
            total: null,
            share: null,
        }));
    }

    const openings = getPlayableOpenings(await loadOpenings(fen));
    const totalGames = openings.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);
    return openings
        .sort(
            (a, b) =>
                getOpeningTotal(b) - getOpeningTotal(a) ||
                getOpeningDateSortValue(b) - getOpeningDateSortValue(a) ||
                a.move.localeCompare(b.move),
        )
        .slice(0, userCandidateLimit)
        .map((opening) => ({
            move: opening.move,
            engineCpForUser: null,
            total: getOpeningTotal(opening),
            share: totalGames > 0 ? getOpeningTotal(opening) / totalGames : null,
        }));
}

function sortPrepStraightLineEngineMoves(moves: PrepBuilderEngineMove[]) {
    return moves
        .filter((move) => move.scoreCpForSide !== null)
        .sort(
            (a, b) =>
                (b.scoreCpForSide ?? -9999) - (a.scoreCpForSide ?? -9999) ||
                (a.rank ?? 99) - (b.rank ?? 99) ||
                a.san.localeCompare(b.san),
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
            preparedLineImpact: null,
        });
    }

    const preparedLineImpact = await getPreparedLineImpact({
        branchNode,
        row,
        opponentColor,
        loadOpenings,
        minGames,
        moveLimit,
    });
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
        preparedLineImpact,
    });
}

export async function getOpponentPrepCandidateLineImpact({
    fen,
    row,
    opponentColor,
    loadOpenings,
    loadEngineMoves,
    minGames,
    moveLimit,
    settings,
}: {
    fen: string;
    row: Pick<OpponentPrepMoveRow, "move" | "total" | "share" | "white" | "draw" | "black">;
    opponentColor: PrepColor;
    loadOpenings: (fen: string) => Promise<Opening[]>;
    loadEngineMoves?: PrepBuilderLoadEngineMoves;
    minGames: number;
    moveLimit: number;
    settings: PrepBuilderSettings;
}): Promise<OpponentPrepLineImpact | null> {
    const surfaceScore = getOpeningScoreForSide(row, opponentColor);

    const nextFen = applyPrepSanMove(fen, row.move);
    if (!nextFen) return null;

    const continuation = await getCandidateContinuationImpact({
        startFen: nextFen,
        surfaceScore,
        opponentColor,
        loadOpenings,
        loadEngineMoves,
        minGames,
        moveLimit,
        settings,
    });
    if (!continuation) return null;

    return {
        surfaceScore,
        surfaceGames: row.total,
        userMove: row.move,
        userScore: surfaceScore,
        userGames: row.total,
        userShare: row.share,
        opponentReplyMove: continuation.firstOpponentReply?.move ?? null,
        opponentReplyScore: continuation.firstOpponentReply?.score ?? null,
        opponentReplyGames: continuation.firstOpponentReply?.games ?? null,
        opponentReplyShare: continuation.firstOpponentReply?.share ?? null,
        userResponseMove: continuation.firstUserResponse?.move ?? null,
        userResponseScore: continuation.firstUserResponse?.score ?? null,
        userResponseGames: continuation.firstUserResponse?.games ?? null,
        userResponseShare: continuation.firstUserResponse?.share ?? null,
        userResponseStrengthScore: continuation.firstUserResponse?.strengthScore ?? null,
        userResponseStrength: continuation.firstUserResponse?.strength ?? null,
        continuationMoves: continuation.moves,
        continuationUserScore: continuation.userScore,
        continuationOpponentScore: continuation.opponentScore,
        continuationGames: continuation.games,
        continuationStrengthScore: continuation.strengthScore,
        continuationStrength: continuation.strength,
        continuationLineScore: continuation.lineScore,
        continuationLineStrength: continuation.lineStrength,
        continuationDepthPly: continuation.depthPly,
        continuationWeight: continuation.weight,
        scoreDrop: continuation.scoreDrop,
        weightedScoreDrop: continuation.weightedScoreDrop,
        weightedStrengthScore: continuation.weightedStrengthScore,
    };
}

async function getPreparedLineImpact({
    branchNode,
    row,
    opponentColor,
    loadOpenings,
    minGames,
    moveLimit,
}: {
    branchNode: TreeNode;
    row: OpponentPrepMoveRow;
    opponentColor: PrepColor;
    loadOpenings: (fen: string) => Promise<Opening[]>;
    minGames: number;
    moveLimit: number;
}): Promise<OpponentPrepLineImpact | null> {
    if (branchNode.children.length === 0) return null;

    const surfaceScore = getOpeningScoreForSide(row, opponentColor);
    if (surfaceScore < PREP_LINE_IMPACT_MIN_SURFACE_SCORE) return null;

    const userOpenings = getPlayableOpenings(await loadOpenings(branchNode.fen));
    const userOpeningTotal = userOpenings.reduce(
        (sum, opening) => sum + getOpeningTotal(opening),
        0,
    );
    if (userOpeningTotal <= 0) return null;

    const candidates = await Promise.all(
        branchNode.children.map(async (userNode): Promise<OpponentPrepLineImpact | null> => {
            if (!userNode.san) return null;

            const userOpening = findMatchingOpening(userOpenings, branchNode.fen, userNode.san);
            if (!userOpening) return null;

            const userGames = getOpeningTotal(userOpening);
            const userShare = userGames / userOpeningTotal;
            if (
                userGames < Math.max(3, minGames) ||
                (userShare < PREP_LINE_IMPACT_MIN_USER_SHARE && userGames < 8)
            ) {
                return null;
            }

            const userScore = getOpeningScoreForSide(userOpening, opponentColor);
            const opponentReply = await getTopOpponentReplyImpact({
                fen: userNode.fen,
                opponentColor,
                loadOpenings,
                minGames,
                moveLimit,
            });
            const aggregateDrop = surfaceScore - userScore;
            const replyDrop =
                opponentReply && opponentReply.share >= PREP_LINE_IMPACT_MIN_OPPONENT_REPLY_SHARE
                    ? surfaceScore - opponentReply.score
                    : Number.NEGATIVE_INFINITY;
            const scoreDrop = Math.max(aggregateDrop, replyDrop);

            if (scoreDrop < PREP_LINE_IMPACT_MIN_SCORE_DROP) return null;

            return {
                surfaceScore,
                surfaceGames: row.total,
                userMove: userNode.san,
                userScore,
                userGames,
                userShare,
                opponentReplyMove: opponentReply?.move ?? null,
                opponentReplyScore: opponentReply?.score ?? null,
                opponentReplyGames: opponentReply?.games ?? null,
                opponentReplyShare: opponentReply?.share ?? null,
                userResponseMove: null,
                userResponseScore: null,
                userResponseGames: null,
                userResponseShare: null,
                userResponseStrengthScore: null,
                userResponseStrength: null,
                continuationMoves: [],
                continuationUserScore: null,
                continuationOpponentScore: userScore,
                continuationGames: userGames,
                continuationStrengthScore: null,
                continuationStrength: null,
                continuationLineScore: null,
                continuationLineStrength: null,
                continuationDepthPly: 0,
                continuationWeight: 1,
                scoreDrop,
                weightedScoreDrop: scoreDrop,
                weightedStrengthScore: scoreDrop * 100,
            } satisfies OpponentPrepLineImpact;
        }),
    );

    return (
        candidates
            .filter((candidate): candidate is OpponentPrepLineImpact => candidate !== null)
            .sort(
                (a, b) =>
                    b.scoreDrop - a.scoreDrop ||
                    b.userShare - a.userShare ||
                    b.userGames - a.userGames ||
                    a.userMove.localeCompare(b.userMove),
            )[0] ?? null
    );
}

async function getCandidateContinuationImpact({
    startFen,
    surfaceScore,
    opponentColor,
    loadOpenings,
    loadEngineMoves,
    minGames,
    moveLimit,
    settings,
}: {
    startFen: string;
    surfaceScore: number;
    opponentColor: PrepColor;
    loadOpenings: (fen: string) => Promise<Opening[]>;
    loadEngineMoves?: PrepBuilderLoadEngineMoves;
    minGames: number;
    moveLimit: number;
    settings: PrepBuilderSettings;
}): Promise<CandidateContinuationImpact | null> {
    const userColor = oppositePrepColor(opponentColor);
    const endpoints: CandidateContinuationImpact[] = [];
    const moves: string[] = [];
    let fen = startFen;
    let opponentPathShare = 1;
    let firstOpponentReply: PrepLineMoveImpact | null = null;
    let firstUserResponse: PrepLineMoveImpact | null = null;

    const pushEndpoint = ({
        userScore,
        opponentScore,
        games,
        strength,
        lineStrength,
    }: {
        userScore: number;
        opponentScore: number;
        games: number;
        strength: PrepMoveStrength;
        lineStrength: PrepMoveStrength;
    }) => {
        const depthPly = moves.length;
        const weight = getCandidateContinuationWeight({
            depthPly,
            opponentPathShare,
        });
        const scoreDrop = surfaceScore - opponentScore;
        endpoints.push({
            moves: [...moves],
            userScore,
            opponentScore,
            games,
            strengthScore: strength.score,
            strength,
            lineScore: lineStrength.score,
            lineStrength,
            depthPly,
            weight,
            scoreDrop,
            weightedScoreDrop: scoreDrop * weight,
            weightedStrengthScore: strength.score * weight,
            weightedLineScore: lineStrength.score * weight,
            firstOpponentReply,
            firstUserResponse,
        });
    };

    for (
        let userResponses = 0;
        userResponses < PREP_CANDIDATE_LINE_MAX_USER_RESPONSES;
        userResponses += 1
    ) {
        if (getFenTurn(fen) !== opponentColor) break;

        const opponentReply = await getTopOpponentReplyImpact({
            fen,
            opponentColor,
            loadOpenings,
            minGames,
            moveLimit,
        });
        if (!opponentReply) break;

        firstOpponentReply ??= opponentReply;
        opponentPathShare *= opponentReply.share;
        moves.push(opponentReply.move);

        const userResponseFen = applyPrepSanMove(fen, opponentReply.move);
        if (!userResponseFen || getFenTurn(userResponseFen) !== userColor) break;

        const userResponse = await getBestUserResponseImpact({
            fen: userResponseFen,
            userColor,
            loadOpenings,
            loadEngineMoves,
            minGames,
            moveLimit,
            settings,
        });
        if (!userResponse || !userResponse.strength || !userResponse.lineStrength) break;

        firstUserResponse ??= userResponse;
        moves.push(userResponse.move);
        pushEndpoint({
            userScore: userResponse.score,
            opponentScore: 1 - userResponse.score,
            games: userResponse.games,
            strength: userResponse.strength,
            lineStrength: userResponse.lineStrength,
        });

        const nextFen = applyPrepSanMove(userResponseFen, userResponse.move);
        if (!nextFen) break;
        fen = nextFen;
    }

    return (
        endpoints.sort(
            (a, b) =>
                b.weightedLineScore - a.weightedLineScore ||
                b.weightedStrengthScore - a.weightedStrengthScore ||
                a.depthPly - b.depthPly ||
                b.lineScore - a.lineScore ||
                b.strengthScore - a.strengthScore ||
                b.weightedScoreDrop - a.weightedScoreDrop ||
                b.scoreDrop - a.scoreDrop ||
                b.games - a.games ||
                a.moves.join(" ").localeCompare(b.moves.join(" ")),
        )[0] ?? null
    );
}

function getCandidateContinuationWeight({
    depthPly,
    opponentPathShare,
}: {
    depthPly: number;
    opponentPathShare: number;
}) {
    const depthWeight = Math.pow(PREP_CANDIDATE_LINE_DEPTH_DECAY, Math.max(0, depthPly - 1));
    return depthWeight * clamp(opponentPathShare, 0, 1);
}

async function getTopOpponentReplyImpact({
    fen,
    opponentColor,
    loadOpenings,
    minGames,
    moveLimit,
}: {
    fen: string;
    opponentColor: PrepColor;
    loadOpenings: (fen: string) => Promise<Opening[]>;
    minGames: number;
    moveLimit: number;
}): Promise<PrepLineMoveImpact | null> {
    if (getFenTurn(fen) !== opponentColor) return null;

    const openings = await loadOpenings(fen);
    const eligibleTotal = getOpponentPrepEligibleOpenings(openings, minGames).reduce(
        (sum, opening) => sum + getOpeningTotal(opening),
        0,
    );
    if (eligibleTotal <= 0) return null;

    const topReply = sortOpponentPrepOpenings(openings, minGames, moveLimit)[0];
    if (!topReply) return null;

    const games = getOpeningTotal(topReply);
    return {
        move: topReply.move,
        games,
        share: games / eligibleTotal,
        score: getOpeningScoreForSide(topReply, opponentColor),
        strengthScore: null,
        strength: null,
        lineScore: null,
        lineStrength: null,
    };
}

async function getBestUserResponseImpact({
    fen,
    userColor,
    loadOpenings,
    loadEngineMoves,
    minGames,
    moveLimit,
    settings,
}: {
    fen: string;
    userColor: PrepColor;
    loadOpenings: (fen: string) => Promise<Opening[]>;
    loadEngineMoves?: PrepBuilderLoadEngineMoves;
    minGames: number;
    moveLimit: number;
    settings: PrepBuilderSettings;
}): Promise<PrepLineMoveImpact | null> {
    if (getFenTurn(fen) !== userColor) return null;

    const openings = await loadOpenings(fen);
    const eligibleTotal = getOpponentPrepEligibleOpenings(openings, minGames).reduce(
        (sum, opening) => sum + getOpeningTotal(opening),
        0,
    );
    if (eligibleTotal <= 0) return null;

    const replies = sortOpponentPrepOpenings(openings, minGames, moveLimit);
    const engineMoves =
        settings.useCloudEngine && loadEngineMoves
            ? await loadEngineMoves(fen, userColor, settings).catch(() => [])
            : [];
    if (settings.useCloudEngine && engineMoves.length === 0) return null;

    const strengthByMove = getPrepMoveStrengthMap({
        openings: replies,
        engineMoves,
        side: userColor,
        settings,
    });
    const bestReply = replies
        .map((opening) => {
            const strength = strengthByMove.get(normalizeSanForPrep(opening.move)) ?? null;
            const usableStrength =
                settings.useCloudEngine && strength?.engineCpLoss === null ? null : strength;
            const lineStrength = usableStrength
                ? createProjectedPrepLineStrength({
                      strength: usableStrength,
                      userScore: getOpeningScoreForSide(opening, userColor),
                      settings,
                  })
                : null;
            return {
                move: opening.move,
                games: getOpeningTotal(opening),
                share: getOpeningTotal(opening) / eligibleTotal,
                score: getOpeningScoreForSide(opening, userColor),
                strengthScore: usableStrength?.score ?? null,
                strength: usableStrength,
                lineScore: lineStrength?.score ?? null,
                lineStrength,
            };
        })
        .sort(
            (a, b) =>
                (b.strengthScore ?? -1) - (a.strengthScore ?? -1) ||
                b.score - a.score ||
                b.share - a.share ||
                b.games - a.games ||
                a.move.localeCompare(b.move),
        )[0];

    return bestReply ?? null;
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
                usageShare: candidate.opponentShare,
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

export function findOpponentPrepSourceMovePath({
    root,
    fen,
    san,
    uci,
}: {
    root: TreeNode;
    fen: string;
    san: string;
    uci?: string | null;
}) {
    const targetFen = normalizeFenForPrep(fen);
    const targetSan = normalizeSanForPrep(san);
    const queue: { node: TreeNode; path: number[] }[] = [{ node: root, path: [] }];

    while (queue.length > 0) {
        const { node, path } = queue.shift()!;

        if (normalizeFenForPrep(node.fen) === targetFen) {
            for (let index = 0; index < node.children.length; index++) {
                const child = node.children[index];
                if (uci && getMoveUci(child.move) === uci) {
                    return [...path, index];
                }
                if (normalizeSanForPrep(child.san) === targetSan) {
                    return [...path, index];
                }
            }
        }

        node.children.forEach((child, index) =>
            queue.push({ node: child, path: [...path, index] }),
        );
    }

    return null;
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

function findMatchingOpening(openings: Opening[], fen: string, san: string) {
    const moveUci = getMoveUciFromSan(fen, san);
    if (moveUci) {
        const uciOpening = openings.find(
            (opening) => getMoveUciFromSan(fen, opening.move) === moveUci,
        );
        if (uciOpening) return uciOpening;
    }

    const normalizedSan = normalizeSanForPrep(san);
    return openings.find((opening) => normalizeSanForPrep(opening.move) === normalizedSan) ?? null;
}

function getOpeningScoreForSide(row: Pick<Opening, "white" | "draw" | "black">, side: PrepColor) {
    const total = getOpeningTotal(row);
    if (total <= 0) return 0;
    const wins = side === "white" ? row.white : row.black;
    return (wins + row.draw * 0.5) / total;
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
    const engineScoreSpreadCp = getEngineScoreSpreadCp(
        scoredEngineMoves.map((move) => move.scoreCpForSide),
    );
    const databaseBaseline = getPrepStrengthDatabaseBaseline(playable);
    const bestDatabaseScore = getPrepStrengthBestDatabaseScore(
        playable,
        settings,
        databaseBaseline,
    );
    const engineByMove = new Map(engineMoves.map((move) => [normalizeSanForPrep(move.san), move]));
    const scoredEngineByMove = new Map(
        scoredEngineMoves.map((move) => [normalizeSanForPrep(move.san), move]),
    );
    const visibleEngineMatches = playable.filter((candidate) =>
        scoredEngineByMove.has(normalizeSanForPrep(candidate.move)),
    ).length;
    const hasVisibleEngineCoverage = visibleEngineMatches > 0;
    const maxEngineCpLoss = Math.max(1, settings.maxEngineCpLoss);

    return playable.map((candidate) => {
        const key = normalizeSanForPrep(candidate.move);
        const engine = engineByMove.get(key) ?? null;
        const engineCp = engine?.scoreCpForSide ?? null;
        const engineCpLoss =
            engineCp !== null && bestEngineScore !== null
                ? Math.max(0, bestEngineScore - engineCp)
                : null;
        const databaseScore = getPrepStrengthDatabaseScore(candidate, settings, databaseBaseline);
        const databaseWdlLoss =
            databaseScore !== null && bestDatabaseScore !== null
                ? Math.max(0, bestDatabaseScore - databaseScore)
                : null;
        const hasEngineCloud =
            settings.useCloudEngine && engineMoves.length > 0 && hasVisibleEngineCoverage;
        const engineUnsafe =
            hasEngineCloud &&
            (engineCpLoss === null
                ? settings.mode !== "practical"
                : engineCpLoss > maxEngineCpLoss);
        const engineLossNorm = !settings.useCloudEngine
            ? 0
            : engineCpLoss === null
              ? getPrepMissingEngineLossNorm(settings)
              : clamp(engineCpLoss / maxEngineCpLoss, 0, 1.5);
        const databaseLossNorm =
            databaseWdlLoss === null
                ? 0.75
                : clamp(databaseWdlLoss / DATABASE_STRENGTH_FULL_STEP, 0, 1.5);
        const strengthLoss = getPrepStrengthLoss({
            settings,
            engineLossNorm,
            databaseLossNorm,
            engineScoreSpreadCp,
        });
        const engineScoreFloor = getPrepEngineScoreFloor({
            settings,
            engineCpLoss,
            maxEngineCpLoss,
        });
        const lowSampleCap = getPrepLowSampleStrengthCap(candidate, settings);
        const rawScore = Math.round((1 - clamp(strengthLoss, 0, 1)) * 100);
        const scoreWithEngineFloor =
            engineScoreFloor === null ? rawScore : Math.max(rawScore, engineScoreFloor);
        const score = Math.min(scoreWithEngineFloor, lowSampleCap ?? 100);

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
                engineSource: engine?.source ?? null,
                databaseScore,
                databaseWdlLoss,
                engineMoves,
                engineScoreSpreadCp,
                settings,
                lowSampleCap,
                engineScoreFloor,
            }),
            engineRank: engine?.rank ?? null,
            strengthLoss,
        };
    });
}

function getPrepMissingEngineLossNorm(settings: PrepBuilderSettings) {
    return settings.mode === "practical"
        ? PRACTICAL_MISSING_ENGINE_SCORE_LOSS_NORM
        : MISSING_ENGINE_SCORE_LOSS_NORM;
}

function getPrepLowSampleStrengthCap(
    candidate: PrepStrengthCandidate,
    settings: PrepBuilderSettings,
) {
    if (settings.mode === "engine") return null;
    if (candidate.total > LOW_SAMPLE_STRENGTH_CAP_MAX_GAMES) return null;
    if ((candidate.usageShare ?? 0) >= LOW_SAMPLE_STRENGTH_CAP_MAX_SHARE) return null;

    return settings.mode === "practical"
        ? LOW_SAMPLE_PRACTICAL_STRENGTH_CAP
        : LOW_SAMPLE_SMART_STRENGTH_CAP;
}

function getPrepEngineScoreFloor({
    settings,
    engineCpLoss,
    maxEngineCpLoss,
}: {
    settings: PrepBuilderSettings;
    engineCpLoss: number | null;
    maxEngineCpLoss: number;
}) {
    if (!settings.useCloudEngine || engineCpLoss === null) return null;
    if (settings.mode !== "engine") return null;
    if (engineCpLoss > maxEngineCpLoss) return null;

    const lossShare = clamp(engineCpLoss / maxEngineCpLoss, 0, 1);
    const bestMoveFloor = 92;
    const safeMoveFloor = 68;

    return Math.round(bestMoveFloor - (bestMoveFloor - safeMoveFloor) * lossShare);
}

function getPrepStrengthDatabaseBaseline(candidates: PrepStrengthCandidate[]) {
    const scored = candidates.filter(
        (candidate) => candidate.total > 0 && candidate.databaseScore !== null,
    );
    const total = scored.reduce((sum, candidate) => sum + candidate.total, 0);
    if (total <= 0) return 0.5;

    return (
        scored.reduce((sum, candidate) => sum + candidate.databaseScore! * candidate.total, 0) /
        total
    );
}

function getPrepStrengthDatabaseScore(
    candidate: PrepStrengthCandidate,
    settings: PrepBuilderSettings,
    baseline: number,
) {
    return getUsageAwarePracticalWdlRate({
        score: candidate.databaseScore,
        total: candidate.total,
        usageShare: candidate.usageShare,
        baseline,
        mode: settings.mode,
    });
}

function getPrepStrengthBestDatabaseScore(
    candidates: PrepStrengthCandidate[],
    settings: PrepBuilderSettings,
    baseline: number,
) {
    if (candidates.length === 0) return null;

    const benchmarkCandidates = candidates.filter(
        (candidate) =>
            candidate.total >= DATABASE_STRENGTH_BENCHMARK_MIN_GAMES ||
            (candidate.usageShare ?? 0) >= DATABASE_STRENGTH_BENCHMARK_MIN_SHARE,
    );
    const source = benchmarkCandidates.length > 0 ? benchmarkCandidates : candidates;

    return Math.max(
        ...source.map(
            (candidate) => getPrepStrengthDatabaseScore(candidate, settings, baseline) ?? 0,
        ),
    );
}

function getPrepStrengthLoss({
    settings,
    engineLossNorm,
    databaseLossNorm,
    engineScoreSpreadCp,
}: {
    settings: PrepBuilderSettings;
    engineLossNorm: number;
    databaseLossNorm: number;
    engineScoreSpreadCp: number | null;
}) {
    if (settings.mode === "engine") {
        return engineLossNorm + databaseLossNorm * 0.12;
    }
    if (settings.mode === "practical") {
        return databaseLossNorm + engineLossNorm * 0.18;
    }

    const effectiveEngineWeight = getSmartMoveStrengthEngineWeight(settings, engineScoreSpreadCp);

    return engineLossNorm * effectiveEngineWeight + databaseLossNorm * (1 - effectiveEngineWeight);
}

function createProjectedPrepLineStrength({
    strength,
    userScore,
    settings,
}: {
    strength: PrepMoveStrength;
    userScore: number;
    settings: PrepBuilderSettings;
}): PrepMoveStrength {
    const practicalScore = clamp((strength.databaseScore ?? userScore) * 100, 0, 100);
    const engineScore =
        settings.useCloudEngine && strength.engineCp !== null
            ? getWinChance(strength.engineCp)
            : null;
    const engineWeight = getProjectedLineEngineWeight({
        settings,
        hasEngineScore: engineScore !== null,
    });
    const projectedOutcomeScore =
        engineScore === null
            ? practicalScore
            : practicalScore * (1 - engineWeight) + engineScore * engineWeight;
    const cappedScore = Math.round(Math.min(strength.score, projectedOutcomeScore));
    const projectedText = `${Math.round(projectedOutcomeScore)}`;
    const practicalText = `${Math.round(practicalScore)}`;
    const engineText = engineScore === null ? null : `${Math.round(engineScore)}`;

    return {
        ...strength,
        score: cappedScore,
        label: cappedScore.toString(),
        detail: [
            `Projected line ${cappedScore}: future move strength ${strength.score}, capped by absolute line outcome ${projectedText}.`,
            `Future WDL component ${practicalText}.`,
            engineText ? `Future engine component ${engineText}.` : null,
            strength.detail,
        ]
            .filter((part): part is string => Boolean(part))
            .join("; "),
    };
}

function getProjectedLineEngineWeight({
    settings,
    hasEngineScore,
}: {
    settings: PrepBuilderSettings;
    hasEngineScore: boolean;
}) {
    if (!settings.useCloudEngine || !hasEngineScore) return 0;

    if (settings.mode === "engine") return 0.88;
    if (settings.mode === "practical") return 0.18;

    return getSmartMoveStrengthEngineWeight(settings, null);
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
        const engineSource = getPrepEngineSourceLabel(strength.engineSource);
        reasons.push(
            strength.engineCpLoss <= 0
                ? `${engineSource}: best move`
                : `${engineSource}: -${Math.round(strength.engineCpLoss)} cp from best`,
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
    engineSource,
    databaseScore,
    databaseWdlLoss,
    engineMoves,
    engineScoreSpreadCp,
    settings,
    lowSampleCap,
    engineScoreFloor,
}: {
    engineCp: number | null;
    engineCpLoss: number | null;
    engineSource: PrepBuilderEngineMove["source"] | null;
    databaseScore: number | null;
    databaseWdlLoss: number | null;
    engineMoves: PrepBuilderEngineMove[];
    engineScoreSpreadCp: number | null;
    settings: PrepBuilderSettings;
    lowSampleCap?: number | null;
    engineScoreFloor?: number | null;
}) {
    const parts: string[] = [];

    if (!settings.useCloudEngine) {
        parts.push("Engine off");
    } else if (engineMoves.length === 0) {
        parts.push("Engine unavailable");
    } else if (engineCpLoss === null) {
        parts.push(`Not in ${formatPrepEngineSourceList(engineMoves)} moves`);
    } else {
        const cp =
            engineCp === null ? "" : ` (${engineCp > 0 ? "+" : ""}${Math.round(engineCp)} cp)`;
        const engineSourceLabel = getPrepEngineSourceLabel(engineSource);
        parts.push(
            engineCpLoss <= 0
                ? `${engineSourceLabel} best${cp}`
                : `${engineSourceLabel} -${Math.round(engineCpLoss)} cp${cp}`,
        );
    }

    if (
        settings.mode === "smart" &&
        engineScoreSpreadCp !== null &&
        engineScoreSpreadCp <= ENGINE_CLUSTER_FULL_PRACTICAL_SPREAD_CP
    ) {
        parts.push("Engine cluster tight; leaning practical");
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

    if (lowSampleCap !== null && lowSampleCap !== undefined) {
        parts.push(`Low sample cap ${lowSampleCap}`);
    }

    if (engineScoreFloor !== null && engineScoreFloor !== undefined) {
        parts.push(`Engine floor ${engineScoreFloor}`);
    }

    return parts.join("; ");
}

function getPrepEngineSourceLabel(source: PrepBuilderEngineMove["source"] | null) {
    if (source === "local-lichess") return "Local cloud";
    if (source === "lichess") return "Lichess cloud";
    if (source === "chessdb") return "ChessDB";
    return "Engine";
}

function formatPrepEngineSourceList(moves: PrepBuilderEngineMove[]) {
    const labels = Array.from(new Set(moves.map((move) => getPrepEngineSourceLabel(move.source))));
    if (labels.length === 0) return "engine";
    if (labels.length === 1) return labels[0];
    return labels.slice(0, -1).join(", ") + ` or ${labels[labels.length - 1]}`;
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
    preparedLineImpact,
}: {
    branchResponseScore: number;
    depthPly: number;
    opponentPositions: number;
    commonReplies: number;
    preparedReplies: number;
    startedReplies: number;
    replyCoverage: number;
    missingImportantMoves: string[];
    preparedLineImpact: OpponentPrepLineImpact | null;
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
        preparedLineImpact,
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
