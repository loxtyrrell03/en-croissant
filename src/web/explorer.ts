import type { WebPrepMoveStat } from "./prepIndex";
import { getFenColor } from "./pgn";

export type WebDatabaseExplorerSource = "lichess-all" | "lichess-masters";

type ExplorerMove = {
  uci: string;
  san: string;
  averageRating?: number;
  white: number;
  black: number;
  draws: number;
};

type ExplorerResponse = {
  white: number;
  black: number;
  draws: number;
  moves: ExplorerMove[];
};

const EXPLORER_BASE_URL = "https://explorer.lichess.org";
const EXPLORER_TIMEOUT_MS = 20_000;

export async function fetchWebExplorerMoveStats({
  source,
  fen,
  token,
  signal,
}: {
  source: WebDatabaseExplorerSource;
  fen: string;
  token: string;
  signal?: AbortSignal;
}): Promise<WebPrepMoveStat[]> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new Error("Lichess token required.");
  }

  const endpoint = source === "lichess-all" ? "lichess" : "masters";
  const params = new URLSearchParams({
    fen,
    moves: "12",
  });

  if (source === "lichess-all") {
    params.set("variant", "standard");
    params.set("speeds", "bullet,blitz,rapid,classical,correspondence");
    params.set("ratings", "1000,1200,1400,1600,1800,2000,2200,2500");
  }

  const response = await fetchWithTimeout(
    `${EXPLORER_BASE_URL}/${endpoint}?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${trimmedToken}`,
      },
      signal,
    },
    EXPLORER_TIMEOUT_MS,
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error("Lichess token missing or expired.");
  }
  if (!response.ok) {
    throw new Error(`Lichess explorer failed: ${response.status}`);
  }

  return explorerMovesToStats(await response.json(), source, fen);
}

function explorerMovesToStats(
  data: ExplorerResponse,
  source: WebDatabaseExplorerSource,
  fen: string,
): WebPrepMoveStat[] {
  const sourceLabel = source === "lichess-all" ? "Lichess All" : "Lichess Masters";
  const userColor = getFenColor(fen);
  const grandTotal = data.moves.reduce((sum, move) => sum + move.white + move.draws + move.black, 0);

  return data.moves
    .map<WebPrepMoveStat>((move) => {
      const total = move.white + move.draws + move.black;
      const scoreForUser =
        total > 0
          ? ((userColor === "white" ? move.white : move.black) + move.draws * 0.5) / total
          : 0.5;

      return {
        move: move.san,
        white: move.white,
        draw: move.draws,
        black: move.black,
        lastPlayed: null,
        key: `${source}:${fen}:${move.uci || move.san}`,
        uci: move.uci || null,
        total,
        share: grandTotal > 0 ? total / grandTotal : 0,
        scoreForUser,
        sourceLabel,
        examples: [],
        strength: null,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.scoreForUser - a.scoreForUser ||
        a.move.localeCompare(b.move, undefined, { sensitivity: "base" }),
    );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  const externalSignal = init.signal;
  const onAbort = () => timeoutController.abort();

  try {
    if (externalSignal) {
      if (externalSignal.aborted) timeoutController.abort();
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }

    return await fetch(url, {
      ...init,
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Lichess explorer timed out.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
