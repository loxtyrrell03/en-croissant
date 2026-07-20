import type { WebColor, WebEngineLine, WebMove, WebPrepLineMove } from "./model";
import { getFenColor } from "./pgn";
import { getWebServerUrl } from "./serverUrl";

export type WebCoachBookPassage = {
  chunkId: string;
  bookId: string;
  title: string;
  author: string;
  shelf: string;
  chapterTitle: string;
  citation: string;
  pdfPageStart: number;
  pdfPageEnd: number;
  printedPageStart: number | null;
  printedPageEnd: number | null;
  excerpt: string;
  sourceUrl: string;
};

export type WebCoachCriticalMoment = {
  ply: number;
  san: string;
  color: WebColor;
  beforeCp: number;
  afterCp: number;
  lossCp: number;
  depth: number | null;
  bestLineUci: string[];
  replyLineUci: string[];
};

export type WebChessCoachHealth = {
  ok: boolean;
  corpusAvailable: boolean;
  modelInstalled: boolean;
  modelAvailable: boolean;
  model: string;
  bookCount: number;
  chunkCount: number;
};

export type WebChessCoachResponse = {
  answer: string;
  model: string;
  playerColor: WebColor;
  criticalMoments: WebCoachCriticalMoment[];
  bookPassages: WebCoachBookPassage[];
  storedEvaluationsUsed: number;
};

export async function getWebChessCoachHealth(signal?: AbortSignal) {
  const response = await fetch(getWebServerUrl("api/chess-coach/health"), {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal,
  });
  const payload = (await response.json().catch(() => null)) as WebChessCoachHealth | null;
  if (!response.ok || !payload) throw new Error("The PC chess coach is unreachable.");
  return payload;
}

export async function askWebChessCoach({
  question,
  pgn,
  playerColor,
  scope,
  currentFen,
  moves,
  currentLines,
  signal,
}: {
  question: string;
  pgn: string;
  playerColor: WebColor;
  scope: "position" | "whole-game";
  currentFen: string;
  moves: ReturnType<typeof getWebCoachMoves>;
  currentLines: WebEngineLine[];
  signal?: AbortSignal;
}) {
  const response = await fetch(getWebServerUrl("api/chess-coach"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question,
      pgn,
      playerColor,
      scope,
      currentFen,
      moves,
      currentLines: currentLines.map((line) => ({
        depth: line.depth,
        score: line.score,
        eval: formatCoachEngineScore(line),
        sanMoves: line.sanMoves,
        uciMoves: line.uciMoves,
      })),
    }),
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | WebChessCoachResponse
    | { error?: string }
    | null;
  if (!response.ok || !payload || !("answer" in payload)) {
    throw new Error(payload && "error" in payload && payload.error ? payload.error : "The PC coach failed.");
  }
  return payload;
}

export function getWebCoachMoves(sourceMoves: WebMove[] | null, line: WebPrepLineMove[]) {
  if (sourceMoves?.length) {
    return sourceMoves.map((move) => ({
      ply: move.ply,
      color: move.color,
      san: move.san,
      fenBefore: move.fenBefore,
      fenAfter: move.fenAfter,
      annotations: move.annotations ?? [],
    }));
  }
  return line.map((move, index) => ({
    ply: index + 1,
    color: getFenColor(move.fenBefore),
    san: move.san,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter,
    annotations: move.annotations ?? [],
  }));
}

export function makeWebCoachMovetext(line: Pick<WebPrepLineMove, "san">[]) {
  if (line.length === 0) return "*";
  return line
    .map((move, index) => {
      const moveNumber = Math.floor(index / 2) + 1;
      return index % 2 === 0 ? `${moveNumber}. ${move.san}` : move.san;
    })
    .join(" ");
}

export function getWebCoachBookPdfUrl(passage: WebCoachBookPassage) {
  return `${getWebServerUrl(passage.sourceUrl)}#page=${Math.max(1, passage.pdfPageStart)}`;
}

function formatCoachEngineScore(line: WebEngineLine) {
  if (line.score.type === "mate") {
    return `${line.score.value >= 0 ? "+" : "-"}M${Math.abs(line.score.value)}`;
  }
  const pawns = line.score.value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}
