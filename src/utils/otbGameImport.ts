import type { OtbImportProgress, OtbImportReport, OtbImportRequest } from "@/bindings";

export type OtbImportSourceSelection = {
    lichessBroadcasts: boolean;
    chessResults: boolean;
    chessbaseNews: boolean;
    officialPgnIndexes: boolean;
    twic: boolean;
};

export const DEFAULT_OTB_IMPORT_SOURCES: OtbImportSourceSelection = {
    lichessBroadcasts: true,
    chessResults: true,
    chessbaseNews: true,
    officialPgnIndexes: true,
    twic: true,
};

export const OTB_IMPORT_SOURCE_DETAILS = [
    {
        key: "lichessBroadcasts" as const,
        label: "Lichess broadcasts",
        detail: "Official monthly OTB broadcast archive",
    },
    {
        key: "chessResults" as const,
        label: "Chess-Results",
        detail: "Direct FIDE-ID player PGN search",
    },
    {
        key: "chessbaseNews" as const,
        label: "ChessBase website",
        detail: "Public PGNs embedded in ChessBase news reports",
    },
    {
        key: "officialPgnIndexes" as const,
        label: "Official event sites",
        detail: "Tournament-organiser PGN indexes, starting with the 4NCL archive",
    },
    {
        key: "twic" as const,
        label: "TWIC",
        detail: "The Week in Chess weekly public PGNs",
    },
];

export function normalizeOtbFideId(value: string) {
    return value.replace(/\D/g, "");
}

export function sanitizeOtbImportFilename(value: string) {
    return (
        value
            .replace(/[<>:"/\\|?*]/g, " ")
            .split("")
            .filter((character) => character.charCodeAt(0) >= 32)
            .join("")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/[. ]+$/g, "") || "OTB opponent games"
    );
}

export function getOtbImportTitle(playerName: string, fromYear: number) {
    return `${playerName.trim()} - OTB games since ${fromYear}`;
}

export function createOtbImportRequest(options: {
    jobId: string;
    playerName: string;
    fideId: string;
    fromYear: number;
    sources: OtbImportSourceSelection;
    localPgnPaths: string[];
    cacheDir: string;
    outputPath: string;
}): OtbImportRequest {
    const fideId = normalizeOtbFideId(options.fideId);
    return {
        jobId: options.jobId,
        playerName: options.playerName.trim(),
        fideId: fideId || null,
        fromYear: options.fromYear,
        includeLichessBroadcasts: options.sources.lichessBroadcasts,
        includeChessResults: options.sources.chessResults,
        includeChessbaseNews: options.sources.chessbaseNews,
        includeOfficialPgnIndexes: options.sources.officialPgnIndexes,
        includeTwic: options.sources.twic,
        localPgnPaths: Array.from(new Set(options.localPgnPaths)),
        cacheDir: options.cacheDir,
        outputPath: options.outputPath,
    };
}

export function validateOtbImportRequest(request: OtbImportRequest, currentYear: number) {
    if (request.playerName.length < 3) return "Enter the opponent's full name.";
    if (request.fideId && request.fideId.length < 5) return "Enter a valid FIDE ID.";
    if (request.fromYear < 1900 || request.fromYear > currentYear) {
        return `Choose a start year between 1900 and ${currentYear}.`;
    }
    if (
        !request.includeLichessBroadcasts &&
        !request.includeChessResults &&
        !request.includeChessbaseNews &&
        !request.includeOfficialPgnIndexes &&
        !request.includeTwic &&
        request.localPgnPaths.length === 0
    ) {
        return "Select at least one OTB source.";
    }
    return null;
}

export function getOtbImportProgressPercent(progress: OtbImportProgress | null) {
    if (!progress || progress.total <= 0) return null;
    return Math.max(0, Math.min(100, (progress.current / progress.total) * 100));
}

export function getOtbImportDescription(report: OtbImportReport) {
    const sourceSummary = report.sources
        .filter((source) => source.archivesChecked > 0 || source.matchedGames > 0)
        .map((source) => `${source.source}: ${source.uniqueGamesAdded} unique`)
        .join("; ");
    return [
        `OTB-only opponent import for ${report.playerName}${report.fideId ? ` (FIDE ${report.fideId})` : ""}.`,
        `${report.gamesFound} unique games; ${report.duplicatesRemoved} duplicates removed; ${report.suspectedOnlineGamesExcluded} suspected online games excluded.`,
        sourceSummary,
    ]
        .filter(Boolean)
        .join(" ");
}

export function getOtbImportWarningCount(report: OtbImportReport) {
    return report.sources.reduce((sum, source) => sum + source.errors.length, 0);
}
