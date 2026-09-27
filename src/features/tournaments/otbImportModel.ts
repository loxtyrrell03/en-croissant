import type {
  OtbImportProgress,
  OtbImportReport,
  OtbImportRequest,
} from "@/features/tournaments/platform";

export interface OtbImportSourceSelection {
  lichessBroadcasts: boolean;
  broadcastArchives: boolean;
  communityBroadcasts: boolean;
  chessResults: boolean;
  chessbaseNews: boolean;
  officialPgnIndexes: boolean;
  twic: boolean;
}

/** Every En Croissant OTB workflow shares one persistent archive corpus/index. */
export const OTB_IMPORT_CACHE_DIRECTORY = "otb-game-import";

export const DEFAULT_OTB_IMPORT_SOURCES: OtbImportSourceSelection = {
  lichessBroadcasts: true,
  broadcastArchives: true,
  communityBroadcasts: true,
  chessResults: true,
  chessbaseNews: true,
  officialPgnIndexes: true,
  twic: true,
};

export const OTB_IMPORT_SOURCE_DETAILS = [
  {
    key: "lichessBroadcasts" as const,
    label: "Targeted broadcasts",
    detail: "FIDE-linked Lichess broadcasts plus Chessscope player search",
  },
  {
    key: "broadcastArchives" as const,
    label: "Full Lichess archive",
    detail: "Searches the indexed official monthly broadcast archive for the full date range",
    note: "Imports take longer if broadcasts aren't downloaded",
  },
  {
    key: "communityBroadcasts" as const,
    label: "Community broadcasts",
    detail: "Checks user-created Lichess events not already covered by Chess-Results",
    note: "Imports take longer if broadcasts aren't downloaded",
  },
  {
    key: "chessResults" as const,
    label: "Chess-Results",
    detail: "FIDE-ID and player-name PGN search",
  },
  {
    key: "chessbaseNews" as const,
    label: "ChessBase website",
    detail: "Public PGNs attached to ChessBase reports",
  },
  {
    key: "officialPgnIndexes" as const,
    label: "Public OTB archives",
    detail: "4NCL, BritBase, PGN Mentor, and organiser collections",
  },
  {
    key: "twic" as const,
    label: "TWIC",
    detail: "The Week in Chess public weekly PGNs",
  },
] as const;

export function normalizeOtbFideId(value: string): string {
  return value.replace(/\D/g, "");
}

export function sanitizeOtbImportFilename(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*]/g, " ")
      .split("")
      .filter((character) => character.charCodeAt(0) >= 32)
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "") || "OTB player games"
  );
}

export function getOtbImportTitle(playerName: string, fromYear: number): string {
  return `${playerName.trim()} - OTB games since ${fromYear}`;
}

export function createOtbImportRequest(options: {
  jobId: string;
  playerName: string;
  fideId: string;
  fromYear: number;
  sources: OtbImportSourceSelection;
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
    includeLichessBroadcastArchives: options.sources.broadcastArchives,
    includeLichessCommunityBroadcasts: options.sources.communityBroadcasts,
    includeChessResults: options.sources.chessResults,
    includeChessbaseNews: options.sources.chessbaseNews,
    includeOfficialPgnIndexes: options.sources.officialPgnIndexes,
    includeTwic: options.sources.twic,
    localPgnPaths: [],
    cacheDir: options.cacheDir,
    outputPath: options.outputPath,
  };
}

export function validateOtbImportRequest(
  request: OtbImportRequest,
  currentYear: number,
): string | null {
  if (request.playerName.length < 3) return "Enter the player's full name.";
  if (request.fideId && request.fideId.length < 5) return "Enter a valid FIDE ID.";
  if (request.fromYear < 1900 || request.fromYear > currentYear) {
    return `Choose a start year between 1900 and ${currentYear}.`;
  }
  if (
    !request.includeLichessBroadcasts &&
    !request.includeLichessBroadcastArchives &&
    !request.includeLichessCommunityBroadcasts &&
    !request.includeChessResults &&
    !request.includeChessbaseNews &&
    !request.includeOfficialPgnIndexes &&
    !request.includeTwic
  ) {
    return "Select at least one OTB source.";
  }
  return null;
}

export function getOtbImportProgressPercent(
  progress: OtbImportProgress | null,
): number | null {
  if (!progress || progress.total <= 0) return null;
  return Math.max(0, Math.min(100, (progress.current / progress.total) * 100));
}

/** Estimates wall-clock time remaining for parallel lanes from their observed
 * average throughput. The slowest active lane determines the overall ETA. */
export function getOtbImportEtaSeconds(
  lanes: OtbImportProgress[],
  startedAtBySource: Record<string, number>,
  now: number,
): number | null {
  const active = lanes.filter((lane) => lane.phase !== "done");
  if (active.length === 0) return 0;

  const estimates: number[] = [];
  for (const lane of active) {
    const startedAt = startedAtBySource[lane.source];
    if (!startedAt || lane.total <= 0 || lane.current <= 0) return null;
    const elapsedSeconds = Math.max(1, (now - startedAt) / 1_000);
    const remaining = Math.max(0, lane.total - lane.current);
    estimates.push((elapsedSeconds * remaining) / lane.current);
  }
  return Math.ceil(Math.max(...estimates));
}

export function formatOtbImportEta(seconds: number): string {
  if (seconds < 60) return "less than a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `about ${hours} hr` : `about ${hours} hr ${remainder} min`;
}

/** Parallel source lanes can report an older snapshot of the shared result
 * count after another lane has found games. Keep the visible count monotonic
 * within one job while still allowing a new job to start from zero. */
export function mergeOtbImportProgress(
  current: OtbImportProgress | null,
  incoming: OtbImportProgress,
): OtbImportProgress {
  if (!current || current.jobId !== incoming.jobId) return incoming;
  return {
    ...incoming,
    gamesFound: Math.max(current.gamesFound, incoming.gamesFound),
  };
}

export function getOtbImportWarningCount(report: OtbImportReport): number {
  return report.sources.reduce((sum, source) => sum + source.errors.length, 0);
}
