import type { Color } from "chessops";

export type WebColor = Extract<Color, "white" | "black">;

export type WebResult = "1-0" | "0-1" | "1/2-1/2" | "*";

export type WebMove = {
  ply: number;
  color: WebColor;
  san: string;
  uci: string | null;
  fenBefore: string;
  fenAfter: string;
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
  pgn: string;
  moves: WebMove[];
  importedAt: number;
};

export type WebDatabase = {
  id: string;
  name: string;
  hostedPath?: string;
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
};

export type WebPrepMode = "player" | "general";
export type WebPrepSource = "local" | "lichess-all" | "lichess-masters";

export type WebPrepWorkspace = {
  id: string;
  name: string;
  mode?: WebPrepMode;
  source?: WebPrepSource;
  opponent: string;
  userColor: WebColor;
  sourceIds: string[];
  minGames?: number;
  moveLimit?: number;
  startFen: string;
  line: WebPrepLineMove[];
  notesByFen: Record<string, string>;
  preparedMoves: Record<string, number>;
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
};

export type WebCompanionState = {
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
