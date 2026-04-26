import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { commands } from "@/bindings";
import type { Position } from "@/components/files/opening";
import { positionFromFen } from "@/utils/chessops";
import { rankOpeningReviewPositions } from "@/utils/openingReviewAutoUpdate";

export type OpeningReviewColourFilter = "any" | "white" | "black";

export type OpeningReviewOpeningInfo = {
    rawName: string;
    family: string;
    variation: string | null;
    line: string;
    isVariation: boolean;
};

export type OpeningReviewPositionRow = ReturnType<typeof rankOpeningReviewPositions>[number] & {
    opening: OpeningReviewOpeningInfo;
};

const openingNameCache = new Map<string, string>();

export function getOpeningReviewPositionColour(position: Position): "white" | "black" {
    const health = position.openingHealth;
    const white = health?.white ?? 0;
    const draw = health?.draw ?? 0;
    const black = health?.black ?? 0;
    const total = white + draw + black;
    const savedScore = typeof health?.score === "number" ? health.score : null;

    if (total > 0 && savedScore !== null) {
        const whiteScore = openingReviewScoreForSide(white, draw, black, "white");
        const blackScore = openingReviewScoreForSide(white, draw, black, "black");
        const whiteDistance = Math.abs(savedScore - whiteScore);
        const blackDistance = Math.abs(savedScore - blackScore);

        if (blackDistance + 0.0001 < whiteDistance) return "black";
        if (whiteDistance + 0.0001 < blackDistance) return "white";
    }

    const saved = position.openingHealth?.sideToMove ?? position.sideToMove;
    if (saved === "black") return "black";
    if (saved === "white") return "white";
    return position.fen.split(" ")[1] === "b" ? "black" : "white";
}

function openingReviewScoreForSide(
    white: number,
    draw: number,
    black: number,
    side: "white" | "black",
) {
    const total = white + draw + black;
    if (total <= 0) return 0;
    return ((side === "white" ? white : black) + draw * 0.5) / total;
}

export function buildOpeningReviewRows(
    positions: Position[],
    openingNamesByKey: Record<string, string>,
): OpeningReviewPositionRow[] {
    const openingInfoByIndex = positions.map((position) => {
        const key = getOpeningReviewOpeningCacheKey(position);
        return getOpeningReviewOpeningInfo(position, openingNamesByKey[key] ?? openingNameCache.get(key));
    });

    return rankOpeningReviewPositions(positions).map((row) => ({
        ...row,
        opening: openingInfoByIndex[row.index] ?? getOpeningReviewOpeningInfo(row.position),
    }));
}

export function filterOpeningReviewRows(
    rows: OpeningReviewPositionRow[],
    colourFilter: OpeningReviewColourFilter,
    openingFilters: string[],
) {
    return rows.filter((row) => {
        const colourMatches =
            colourFilter === "any" || getOpeningReviewPositionColour(row.position) === colourFilter;
        const openingMatches =
            openingFilters.length === 0 ||
            openingFilters.some((filter) => openingReviewFilterMatchesOpening(filter, row.opening));
        return colourMatches && openingMatches;
    });
}

export function getOpeningReviewOpeningOptions(
    rows: OpeningReviewPositionRow[],
    colourFilter: OpeningReviewColourFilter,
) {
    const familyCounts = new Map<string, number>();
    const lineCounts = new Map<string, number>();
    const colourRows = rows.filter(
        ({ position }) =>
            colourFilter === "any" || getOpeningReviewPositionColour(position) === colourFilter,
    );

    for (const row of colourRows) {
        familyCounts.set(row.opening.family, (familyCounts.get(row.opening.family) ?? 0) + 1);
        if (row.opening.isVariation) {
            lineCounts.set(row.opening.line, (lineCounts.get(row.opening.line) ?? 0) + 1);
        }
    }

    return [
        ...Array.from(familyCounts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([family, count]) => ({
                value: openingReviewFamilyFilterValue(family),
                label: `${family} (${count})`,
            })),
        ...Array.from(lineCounts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([line, count]) => ({
                value: openingReviewLineFilterValue(line),
                label: `${line} (${count})`,
            })),
    ];
}

export function getOpeningReviewOpeningCacheKey(position: Position) {
    return `${position.fen.split(" ").slice(0, 4).join(" ")}|${position.moveSequence ?? ""}`;
}

export async function resolveOpeningReviewOpeningName(position: Position) {
    const key = getOpeningReviewOpeningCacheKey(position);
    const cached = openingNameCache.get(key);
    if (cached) return cached;

    const fallback = inferOpeningReviewOpeningName(position);
    try {
        const result = await commands.getOpeningFromFens(getOpeningReviewPositionFenLine(position));
        const name = result.status === "ok" ? result.data : fallback;
        openingNameCache.set(key, name);
        return name;
    } catch {
        openingNameCache.set(key, fallback);
        return fallback;
    }
}

export function openingReviewFilterDisplayName(filter: string) {
    if (filter === "all") return "all openings";
    if (filter.startsWith("family:")) return filter.slice("family:".length);
    if (filter.startsWith("line:")) return filter.slice("line:".length);
    return filter;
}

export function openingReviewFiltersDisplayName(filters: string[]) {
    if (filters.length === 0) return "all openings";
    if (filters.length === 1) return openingReviewFilterDisplayName(filters[0]!);
    return `${filters.length} openings`;
}

export function getOpeningReviewPracticeLabel(
    openingFilters: string[],
    colourFilter: OpeningReviewColourFilter,
) {
    if (openingFilters.length === 0 && colourFilter === "any") return "all openings";
    if (openingFilters.length === 0) return `${colourFilter} openings`;
    return `${openingReviewFiltersDisplayName(openingFilters)}${
        colourFilter === "any" ? "" : `, ${colourFilter}`
    }`;
}

function getOpeningReviewOpeningInfo(
    position: Position,
    resolvedName?: string,
): OpeningReviewOpeningInfo {
    const rawName = cleanOpeningReviewOpeningName(resolvedName) ?? inferOpeningReviewOpeningName(position);
    const family = getOpeningReviewOpeningFamily(rawName);
    const variation = getOpeningReviewOpeningVariation(rawName, family);
    const line = variation ? `${family}: ${variation}` : family;

    return {
        rawName,
        family,
        variation,
        line,
        isVariation: variation !== null,
    };
}

function cleanOpeningReviewOpeningName(value: string | null | undefined) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    return normalized || null;
}

function inferOpeningReviewOpeningName(position: Position) {
    const moves = tokenizeReviewMoveSequence(position.moveSequence ?? "");
    if (moves.length === 0) return "Starting position";

    const [first, second, third, fourth, fifth, sixth, seventh, eighth] = moves;
    if (first === "e4" && second === "c6") return "Caro-Kann Defense";
    if (first === "e4" && second === "c5") return "Sicilian Defense";
    if (first === "e4" && second === "e5") return "Open Game";
    if (first === "e4" && second === "e6") return "French Defense";
    if (first === "e4" && second === "d6") return "Pirc Defense";
    if (first === "d4" && second === "Nf6" && third === "c4" && fourth === "g6") {
        return "King's Indian Defense";
    }
    if (first === "d4" && second === "Nf6" && third === "c4" && fourth === "e6") {
        return "Indian Game";
    }
    if (first === "d4" && second === "d5" && third === "c4") {
        if (fourth === "c6") return "Slav Defense";
        if (
            fourth === "e6" &&
            sixth === "Nf6" &&
            [fifth, seventh].includes("Nc3") &&
            [fifth, seventh].includes("Nf3")
        ) {
            return eighth?.startsWith("Bb4")
                ? "Queen's Gambit Declined: Ragozin Defense"
                : "Queen's Gambit";
        }
        if (fourth === "e6") return "Queen's Gambit";
        if (fourth === "dxc4") return "Queen's Gambit Accepted";
        return "Queen's Gambit";
    }

    return formatOpeningReviewMovePrefix(moves.slice(0, Math.min(4, moves.length)));
}

function getOpeningReviewOpeningFamily(openingName: string) {
    const base = openingName.split(":")[0]?.trim() || openingName;
    const lowerBase = base.toLowerCase();

    if (lowerBase.startsWith("semi-slav defense")) return "Semi-Slav Defense";
    if (lowerBase.startsWith("slav defense")) return "Slav Defense";
    if (lowerBase.startsWith("queen's gambit") || lowerBase.startsWith("queens gambit")) {
        return "Queen's Gambit";
    }
    if (lowerBase.startsWith("caro-kann defense") || lowerBase.startsWith("caro kann defense")) {
        return "Caro-Kann Defense";
    }

    return base;
}

function getOpeningReviewOpeningVariation(openingName: string, family: string) {
    const parts = openingName
        .split(":")
        .map((part) => part.trim())
        .filter(Boolean);
    const base = parts[0] ?? openingName;
    const namedVariation = parts.slice(1).join(": ");

    if (family === "Queen's Gambit") {
        if (namedVariation) return namedVariation;
        const suffix = base.replace(/^Queen'?s Gambit/i, "").trim();
        return suffix || null;
    }

    return namedVariation || null;
}

function openingReviewFamilyFilterValue(family: string) {
    return `family:${family}`;
}

function openingReviewLineFilterValue(line: string) {
    return `line:${line}`;
}

function openingReviewFilterMatchesOpening(filter: string, opening: OpeningReviewOpeningInfo) {
    if (filter === "all") return true;
    if (filter.startsWith("family:")) return opening.family === filter.slice("family:".length);
    if (filter.startsWith("line:")) return opening.line === filter.slice("line:".length);
    return opening.line === filter || opening.family === filter;
}

function getOpeningReviewPositionFenLine(position: Position) {
    const fens = [INITIAL_FEN];
    const moves = tokenizeReviewMoveSequence(position.moveSequence ?? "");
    const [chess] = positionFromFen(INITIAL_FEN);
    if (!chess) return [position.fen];

    for (const token of moves) {
        const move = parseSan(chess, token);
        if (!move) break;
        chess.play(move);
        fens.push(makeFen(chess.toSetup()));
    }

    if (!fens.some((fen) => sameReviewPosition(fen, position.fen))) {
        fens.push(position.fen);
    }

    return fens;
}

function tokenizeReviewMoveSequence(moveSequence: string) {
    return moveSequence
        .split(/\s+/)
        .map((token) => token.replace(/^\d+\.(\.\.)?/, "").trim())
        .filter(
            (token) =>
                token &&
                !/^\d+\.(\.\.)?$/.test(token) &&
                !["1-0", "0-1", "1/2-1/2", "*"].includes(token),
        );
}

function sameReviewPosition(a: string, b: string) {
    return a.split(" ").slice(0, 4).join(" ") === b.split(" ").slice(0, 4).join(" ");
}

function formatOpeningReviewMovePrefix(moves: string[]) {
    return moves
        .map((move, index) => (index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ${move}` : move))
        .join(" ");
}
