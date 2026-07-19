import type { WebEngineLine } from "./model";
import { parseStockfishInfoLine, sortEngineLines } from "./stockfishEngine";

export const DEFAULT_REMOTE_STOCKFISH_URL = "https://gaming-pc.tail89d19b.ts.net:8443";

const REMOTE_UPDATE_INTERVAL_MS = 120;
const REMOTE_CONNECT_TIMEOUT_MS = 3_500;

type RemoteStockfishRequest = {
  fen: string;
  multipv: number;
  depth: number;
  signal?: AbortSignal;
  onUpdate?: (lines: WebEngineLine[]) => void;
  baseUrl?: string;
};

type RemoteEvent =
  | { type: "meta" }
  | { type: "uci"; line?: string }
  | { type: "done"; bestmove?: string }
  | { type: "error"; message?: string };

export async function analyzeWithRemoteStockfish18({
  fen,
  multipv,
  depth,
  signal,
  onUpdate,
  baseUrl = DEFAULT_REMOTE_STOCKFISH_URL,
}: RemoteStockfishRequest): Promise<WebEngineLine[]> {
  const requestController = new AbortController();
  let connectTimedOut = false;
  const handleAbort = () => requestController.abort();
  signal?.addEventListener("abort", handleAbort, { once: true });
  const connectTimeout = window.setTimeout(() => {
    connectTimedOut = true;
    requestController.abort();
  }, REMOTE_CONNECT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fen, multipv, depth }),
      cache: "no-store",
      signal: requestController.signal,
    });
    window.clearTimeout(connectTimeout);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Gaming PC Stockfish returned ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    if (!response.body) throw new Error("Gaming PC Stockfish returned no analysis stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const linesByPv = new Map<number, WebEngineLine>();
    let buffered = "";
    let lastUpdateAt = 0;

    const publish = (force = false) => {
      if (!onUpdate) return;
      const now = Date.now();
      if (!force && now - lastUpdateAt < REMOTE_UPDATE_INTERVAL_MS) return;
      lastUpdateAt = now;
      onUpdate(sortEngineLines(linesByPv));
    };

    const consumeLine = (line: string) => {
      if (!line.trim()) return false;
      const event = JSON.parse(line) as RemoteEvent;
      if (event.type === "error") {
        throw new Error(event.message || "Gaming PC Stockfish analysis failed.");
      }
      if (event.type === "uci" && event.line) {
        const parsed = parseStockfishInfoLine(event.line, fen);
        if (parsed && parsed.multipv <= multipv) {
          linesByPv.set(parsed.multipv, { ...parsed, source: "stockfish-remote" });
          publish();
        }
      }
      if (event.type === "done") {
        publish(true);
        return true;
      }
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (consumeLine(line)) return sortEngineLines(linesByPv);
        newline = buffered.indexOf("\n");
      }
      if (done) break;
    }

    if (buffered.trim()) consumeLine(buffered);
    publish(true);
    return sortEngineLines(linesByPv);
  } catch (error) {
    if (connectTimedOut) throw new Error("Gaming PC Stockfish is unreachable.");
    throw error;
  } finally {
    window.clearTimeout(connectTimeout);
    signal?.removeEventListener("abort", handleAbort);
  }
}
