import type { Color } from "chessops";
import type { PrepBuilderSettings } from "@/utils/opponentPrep";

export type WebColor = Extract<Color, "white" | "black">;

export type WebResult = "1-0" | "0-1" | "1/2-1/2" | "*";
export type WebLocalResultFilter = "any" | "whitewon" | "draw" | "blackwon";

export type WebLocalGameFilters = {
    startDate?: string;
    endDate?: string;
    result?: WebLocalResultFilter;
};

export type WebMove = {
    ply: number;
    color: WebColor;
    san: string;
    uci: string | null;
    fenBefore: string;
    fenAfter: string;
    clockSeconds?: number;
    timestampSeconds?: number;
    annotations?: string[];
    startingComments?: string[];
    comments?: string[];
    variations?: WebMove[][];
};

export type WebCoachReviewRecord = {
    version: 1;
    contextKey: string;
    lineContextKey: string;
    scope: "position" | "whole-game";
    playerColor: WebColor;
    question: string;
    response: unknown;
    savedAt: number;
};

export type WebGame = {
    id: string;
    databaseId: string;
    databaseName: string;
    index: number;
    event: string;
    site: string;
    date: string;
    white: string;
    black: string;
    whiteElo: number | null;
    blackElo: number | null;
    result: WebResult;
    timeControl?: string | null;
    whiteTimeControl?: string | null;
    blackTimeControl?: string | null;
    startedAtSeconds?: number | null;
    pgn: string;
    moves: WebMove[];
    rootVariations?: WebMove[][];
    comments?: string[];
    coachReview?: WebCoachReviewRecord | null;
    importedAt: number;
};

export type WebDatabase = {
    id: string;
    name: string;
    sourceKind?: "source" | "opened-file";
    hostedPath?: string;
    hostedFilePath?: string;
    hostedLazy?: boolean;
    hostedUpdatedAt?: number;
    importedAt: number;
    updatedAt: number;
    gameCount: number;
    sizeBytes: number;
    latestDate: string | null;
    playerNames: string[];
};

export type WebPrepLineMove = {
    fenBefore: string;
    fenAfter: string;
    san: string;
    uci: string | null;
    actor: "user" | "opponent";
    clockSeconds?: number;
    timestampSeconds?: number;
    annotations?: string[];
    startingComments?: string[];
    comments?: string[];
    variations?: WebPrepLineMove[][];
};

export type WebPrepMode = "player" | "general";
export type WebPrepSource = "local" | "temporary" | "lichess-all" | "lichess-masters";
export type WebPrepPanelStage = "setup" | "train";
export type WebPrepOpponentSortColumn =
    | "move"
    | "strength"
    | "games"
    | "results"
    | "prep"
    | "state";
export type WebPrepCandidateSortColumn = "move" | "strength" | "games" | "results";
export type WebPrepMoveSortDefaults = {
    opponent: WebPrepOpponentSortColumn;
    candidate: WebPrepCandidateSortColumn;
};

export type WebPrepTemporarySource = {
    id: string;
    name: string;
    gameCount: number;
    importedAt: number;
    updatedAt: number;
    games: WebGame[];
};

export type WebPrepWorkspace = {
    id: string;
    name: string;
    mode?: WebPrepMode;
    source?: WebPrepSource;
    opponent: string;
    userColor: WebColor;
    sourceIds: string[];
    temporarySource?: WebPrepTemporarySource | null;
    startDate?: string;
    endDate?: string;
    result?: WebLocalResultFilter;
    minGames?: number;
    moveLimit?: number;
    builder?: Partial<PrepBuilderSettings>;
    sortDefaults?: WebPrepMoveSortDefaults;
    startFen: string;
    rootPly?: number;
    line: WebPrepLineMove[];
    notesByFen: Record<string, string>;
    preparedMoves: Record<string, number>;
    skippedMoves?: Record<string, number>;
    panelStage?: WebPrepPanelStage;
    createdAt: number;
    updatedAt: number;
};

export type WebBoardState = {
    orientation: WebColor;
    startFen: string;
    line: WebPrepLineMove[];
    cursor: number;
    sourceTitle: string | null;
    sourceDatabaseId: string | null;
    sourceGameId: string | null;
    sourceComments: string[];
    coachReview?: WebCoachReviewRecord | null;
};

export type WebEngineScore =
    | {
          type: "cp";
          value: number;
      }
    | {
          type: "mate";
          value: number;
      };

export type WebEngineLineSource = "stockfish" | "lc0" | "lichess-cloud";
export type WebEngineExecutionLocation = "gaming-pc" | "phone";

export type WebEngineLine = {
    source: WebEngineLineSource;
    executionLocation?: WebEngineExecutionLocation;
    engineName?: string | null;
    networkMode?: string | null;
    networkName?: string | null;
    multipv: number;
    depth: number;
    seldepth?: number | null;
    nodes?: number | null;
    nps?: number | null;
    score: WebEngineScore;
    uciMoves: string[];
    sanMoves: string[];
};

export type WebCompanionState = {
    mistakeReview?: import("./mistakeReview").PhoneReviewState;
    version: 1;
    databases: WebDatabase[];
    gamesByDatabase: Record<string, WebGame[]>;
    prepWorkspaces: WebPrepWorkspace[];
    activePrepId: string | null;
    board: WebBoardState;
};

export type WebImportResult = {
    database: WebDatabase;
    games: WebGame[];
    warnings: string[];
};
