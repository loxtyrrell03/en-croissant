import type {
    BestMoves as BestMovesT,
    DatabaseInfo as DatabaseInfoT,
    GameQuery,
    Score as ScoreT,
    ScoreValue as ScoreValueT,
} from "./generated";

export * from "./generated";
export type ScoreValue = ScoreValueT | { type: "dtz"; value: number };
export type Score = Omit<ScoreT, "value"> & { value: ScoreValue };
export type BestMoveSource = "lichess" | "chessdb";
export type BestMoves = Omit<BestMovesT, "score"> & {
    score: Score;
    source?: BestMoveSource | null;
};

export type DatabaseInfo =
    | (DatabaseInfoT & {
          type: "success";
          file: string;
          relativePath?: string;
          folder?: string;
          folderSegments?: string[];
          downloadLink?: string;
          filter?: GameQuery;
      })
    | {
          type: "error";
          file: string;
          relativePath?: string;
          folder?: string;
          folderSegments?: string[];
          filename: string;
          error: string;
          indexed: boolean;
      };
