import type { CoachOpeningContext, CoachOpeningMove } from "@/bindings";
import type { LichessGamesOptions } from "@/utils/lichess/explorer";
import { getLichessGames, queryLichessCloudMoves } from "@/utils/lichess/api";
import {
    getOpeningMoveStrengthMap,
    getOpeningTotal,
    resolveOpeningMoveHealthSide,
    type OpeningMoveCloudData,
    type OpeningMoveHealthInput,
} from "@/utils/openingMoveHealth";
import type { MoveStrengthSettings } from "@/utils/moveStrength";

const COACH_OPENING_MOVE_LIMIT = 12;
const COACH_OPENING_ENGINE_MULTIPV = 10;

type BuildAiCoachOpeningContextOptions = {
    fen: string;
    sideToMove: "white" | "black";
    lichessOptions: LichessGamesOptions;
    token?: string;
    strengthSettings: MoveStrengthSettings;
};

export async function buildAiCoachOpeningContext({
    fen,
    sideToMove,
    lichessOptions,
    token,
    strengthSettings,
}: BuildAiCoachOpeningContextOptions): Promise<CoachOpeningContext | null> {
    if (!token) return null;

    const explorerOptions: LichessGamesOptions = {
        ...lichessOptions,
        topGames: 0,
        recentGames: 0,
    };
    const data = await getLichessGames(fen, explorerOptions, token);
    const openings = data.moves
        .map<OpeningMoveHealthInput & { uci: string }>((move) => ({
            move: move.san,
            uci: move.uci,
            white: move.white,
            draw: move.draws,
            black: move.black,
        }))
        .filter((move) => move.move !== "*" && getOpeningTotal(move) > 0);
    if (openings.length === 0) {
        return {
            source: "Lichess All",
            fen,
            side: sideToMove,
            totalGames: data.white + data.draws + data.black,
            filters: formatLichessAllFilters(explorerOptions),
            moves: [],
        };
    }

    const cloudData = await queryCoachOpeningCloudData(fen, openings.length).catch(() => null);
    const healthSide = resolveOpeningMoveHealthSide("sideToMove", sideToMove);
    const strengthByMove = getOpeningMoveStrengthMap({
        openings,
        side: healthSide,
        fen,
        cloudData,
        strengthSettings,
    });
    const totalGames = openings.reduce((sum, move) => sum + getOpeningTotal(move), 0);
    const selectedMoves = selectCoachOpeningMoves(openings, strengthByMove);

    return {
        source: "Lichess All",
        fen,
        side: healthSide,
        totalGames,
        filters: formatLichessAllFilters(explorerOptions),
        moves: selectedMoves.map<CoachOpeningMove>((move) => {
            const strength = strengthByMove.get(move.move);
            const games = getOpeningTotal(move);
            const sideScore = getSideScore(move, healthSide);

            return {
                san: move.move,
                uci: move.uci,
                games,
                white: move.white,
                draw: move.draw,
                black: move.black,
                usagePct: percent(totalGames > 0 ? games / totalGames : 0),
                sideScorePct: percent(sideScore),
                blendedStrength: strength?.blendedStrengthScore ?? 0,
                blendedLabel: strength?.blendedStrengthLabel ?? "-",
                databaseStrengthPct:
                    strength?.databaseStrengthScore === null ||
                    strength?.databaseStrengthScore === undefined
                        ? null
                        : percent(strength.databaseStrengthScore),
                engineCpLoss:
                    strength?.cpLoss === null || strength?.cpLoss === undefined
                        ? null
                        : Math.round(strength.cpLoss),
                engineRank:
                    strength?.engineRank === null || strength?.engineRank === undefined
                        ? null
                        : strength.engineRank,
                engineScore:
                    strength?.engineScoreCp === null || strength?.engineScoreCp === undefined
                        ? null
                        : formatCpScore(strength.engineScoreCp),
                notes: strength?.reasons.slice(0, 2) ?? [],
            };
        }),
    };
}

async function queryCoachOpeningCloudData(
    fen: string,
    moveCount: number,
): Promise<OpeningMoveCloudData | null> {
    const multipv = Math.max(1, Math.min(COACH_OPENING_ENGINE_MULTIPV, moveCount));
    const moves = await queryLichessCloudMoves(fen, multipv);
    if (!moves?.length) return null;

    return {
        source: "lichess",
        moves: moves.map((move, index) => ({
            san: move.san,
            scoreCpForWhite: move.scoreCpForWhite,
            rank: index + 1,
            winrate: null,
        })),
    };
}

function selectCoachOpeningMoves(
    openings: (OpeningMoveHealthInput & { uci: string })[],
    strengthByMove: ReturnType<typeof getOpeningMoveStrengthMap>,
) {
    const byGames = [...openings].sort(
        (a, b) => getOpeningTotal(b) - getOpeningTotal(a) || a.move.localeCompare(b.move),
    );
    const byBlend = [...openings].sort(
        (a, b) =>
            (strengthByMove.get(b.move)?.blendedStrengthScore ?? -1) -
                (strengthByMove.get(a.move)?.blendedStrengthScore ?? -1) ||
            getOpeningTotal(b) - getOpeningTotal(a),
    );
    const byWeak = [...openings]
        .filter((move) => getOpeningTotal(move) >= 10)
        .sort(
            (a, b) =>
                (strengthByMove.get(a.move)?.blendedStrengthScore ?? 101) -
                    (strengthByMove.get(b.move)?.blendedStrengthScore ?? 101) ||
                getOpeningTotal(b) - getOpeningTotal(a),
        );

    const selected = new Map<string, OpeningMoveHealthInput & { uci: string }>();
    for (const move of [...byGames.slice(0, 8), ...byBlend.slice(0, 4), ...byWeak.slice(0, 2)]) {
        selected.set(move.move, move);
    }

    return Array.from(selected.values())
        .sort((a, b) => getOpeningTotal(b) - getOpeningTotal(a) || a.move.localeCompare(b.move))
        .slice(0, COACH_OPENING_MOVE_LIMIT);
}

function getSideScore(opening: OpeningMoveHealthInput, side: "white" | "black") {
    const total = getOpeningTotal(opening);
    if (total <= 0) return 0.5;

    const wins = side === "white" ? opening.white : opening.black;
    return (wins + opening.draw * 0.5) / total;
}

function percent(value: number) {
    return Math.round(value * 1000) / 10;
}

function formatCpScore(score: number) {
    if (Math.abs(score) > 250_00) {
        return score > 0 ? "Win" : "Loss";
    }
    return `${score >= 0 ? "+" : ""}${(score / 100).toFixed(2)}`;
}

function formatLichessAllFilters(options: LichessGamesOptions) {
    const parts = ["source=Lichess All"];
    if (options.speeds?.length) parts.push(`speeds=${options.speeds.join("/")}`);
    if (options.ratings?.length) parts.push(`ratings=${options.ratings.join("/")}`);
    if (options.since) parts.push(`since=${formatExplorerDate(options.since)}`);
    if (options.until) parts.push(`until=${formatExplorerDate(options.until)}`);
    if (options.player) parts.push(`player=${options.player} as ${options.color}`);
    return parts.join(", ");
}

function formatExplorerDate(value: Date | string) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
