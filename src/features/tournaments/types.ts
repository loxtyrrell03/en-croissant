// Wire contracts ported from Novelty; see docs/TOURNAMENT_PARITY.md.
export interface OtbImportRequest {
  jobId: string;
  playerName: string;
  fideId: string | null;
  fromYear: number;
  includeLichessBroadcasts: boolean;
  includeLichessBroadcastArchives: boolean;
  includeLichessCommunityBroadcasts: boolean;
  includeChessResults: boolean;
  includeChessbaseNews: boolean;
  includeOfficialPgnIndexes: boolean;
  includeTwic: boolean;
  localPgnPaths: string[];
  cacheDir: string;
  outputPath: string;
}

export interface OtbImportSourceReport {
  source: string;
  archivesChecked: number;
  cachedArchives: number;
  matchedGames: number;
  uniqueGamesAdded: number;
  errors: string[];
}

export interface OtbImportNewestGame {
  date: string;
  event: string;
  white: string;
  black: string;
  result: string;
  source: string;
}

export interface OtbImportReport {
  coverageComplete?: boolean;
  coverageGaps?: string[];
  playerName: string;
  fideId: string | null;
  outputPath: string;
  cancelled: boolean;
  gamesFound: number;
  duplicatesRemoved: number;
  suspectedOnlineGamesExcluded: number;
  identityMismatchesExcluded: number;
  newestGame: OtbImportNewestGame | null;
  sources: OtbImportSourceReport[];
}

/** Emitted on `otb://import-progress` while public sources are scanned. */
export interface OtbImportProgress {
  jobId: string;
  source: string;
  phase: string;
  current: number;
  total: number;
  gamesFound: number;
  message: string;
  overallCurrent?: number | null;
  overallTotal?: number | null;
}

export interface TournamentPlayer {
  startNumber: number;
  name: string;
  fideId: string | null;
  federation: string | null;
  title: string | null;
  rating: number | null;
  rank: number | null;
  points: number;
  active: boolean;
  /** Chess-Results rounds where this player is withdrawn or has a requested bye. */
  notPairedRounds?: number[];
  /** Requested byes that Chess-Results explicitly labels as half-point byes. */
  halfPointByeRounds?: number[];
}

export interface TournamentPairing {
  round: number;
  board: number | null;
  whiteStartNumber: number | null;
  blackStartNumber: number | null;
  whitePoints: number | null;
  blackPoints: number | null;
  result: string | null;
  decided: boolean;
}

export interface TournamentRoundStandings {
  round: number;
  players: TournamentPlayer[];
}

export type TournamentFormat = "swiss" | "round-robin" | "team" | "other";
export type TournamentPhase =
  | "registration"
  | "pairings-published"
  | "round-in-progress"
  | "between-rounds"
  | "complete";

export interface TournamentSearchResult {
  tournamentId: string;
  sourceUrl: string;
  title: string;
  section: string | null;
  federation: string | null;
  startDate: string | null;
  endDate: string | null;
  lastUpdate: string | null;
  location?: string | null;
  timeControl?: string | null;
  playerCount?: number | null;
  organizer?: string | null;
}

export interface TournamentDiscoveryRequest {
  query: string; country: string; federations: string[]; location: string; timeControl: string;
  from: string; to: string; today: string; period: "upcoming" | "ongoing" | "past" | "all"; includeUndated: boolean;
}
export interface TournamentDiscoveryResponse {
  events: TournamentSearchResult[]; sourceCount: number; sourceLimitReached: boolean; fetchedAt: string;
}
export interface TournamentEventMetadata {
  location: string | null; organizer: string | null; organizerUrl: string | null; imageUrl: string | null;
}

export interface TournamentSection {
  tournamentId: string;
  sourceUrl: string;
  name: string;
  isCurrent: boolean;
}

export interface TournamentSnapshot {
  tournamentId: string;
  sourceUrl: string;
  title: string;
  section: string | null;
  sections?: TournamentSection[];
  format: TournamentFormat;
  formatLabel: string;
  totalRounds: number;
  completedRound: number;
  publishedRound: number;
  liveRound: number | null;
  nextRound: number | null;
  phase: TournamentPhase;
  dateRange: string | null;
  /** Published first-round schedule. Absent in older native snapshots. */
  roundOneStart?: { date: string | null; time: string | null; startsAt: string | null } | null;
  timeControl: string | null;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  players: TournamentPlayer[];
  pairings: TournamentPairing[];
  /** Organizer-published standings after each completed round. */
  roundStandings?: TournamentRoundStandings[];
  /** Known incomplete published pairing rounds; absent on older native snapshots. */
  incompletePairingRounds?: number[];
  warnings: string[];
  metadata?: TournamentEventMetadata;
}

export interface CollectionRow {
  id: number;
  name: string;
  folder: string | null;
  game_count: number;
}

/** Keyset cursor for progressive game listing (last delivered row). */
export type DataPackKind = "rated" | "broadcasts" | "evaluations" | "otb";
export interface OtbLibraryStatus { managed: boolean; downloaded: boolean; enabled: boolean; partiallyEnabled?: boolean; keepYears: number | null; months: string[]; bytes: number; parent: string; importedIds: string[]; pendingIds: string[]; maintenanceNeeded: boolean; }
export interface DataPackEntry { id: string; kind: DataPackKind; title: string; summary: string; detail: string; sizeLabel?: string | null; periodStart?: string | null; periodEnd?: string | null; downloadBytes: number; installedBytes: number; manifestSha256: string; }
export interface DataPackJob { id: string; state: "running" | "cancelling" | "interrupted" | "cancelled" | "failed" | "ready"; parent: string; path: string; phase: string; completedBytes: number; totalBytes: number; error: string | null; manifestSha256: string; retainedPaths?: string[]; }
export interface DataPackStatus { catalog: DataPackEntry[]; jobs: DataPackJob[]; defaultParent: string; openingPackSelected: boolean; sharedOpeningsAvailable: boolean; selectedIds: string[]; /** Verified owner-built stores that predate the managed download ledger. */ existingIds?: string[]; }
export interface DataPackReview { token: string; id: string; parent: string; path: string; downloadBytes: number; installedBytes: number; requiredBytes: number; availableBytes: number; previousPath?: string | null; }
export interface DownloadRemovalReview { token: string; id: string; bytes: number; paths: string[]; shared: boolean; }
