export type WebOnlineSource = "lichess" | "chesscom";
export type WebOnlineImportMode = "count" | "range";
export type WebOnlineRangePreset = "3m" | "6m" | "1y" | "all";

export type WebOnlineImportedGame = {
  source: WebOnlineSource;
  username: string;
  pgn: string;
  playedAt: number;
  url: string;
};

export type WebOnlineImportRequest = {
  source: WebOnlineSource;
  username: string;
  mode: WebOnlineImportMode;
  count: number;
  range: WebOnlineRangePreset;
  onProgress?: (loaded: number, expected: number | null) => void;
};

const CHESSCOM_ARCHIVES_URL = "https://api.chess.com/pub/player";
const LICHESS_GAMES_URL = "https://lichess.org/api/games/user";
const MAX_ONLINE_GAMES = 300;

export async function fetchWebOnlineGames({
  source,
  username,
  mode,
  count,
  range,
  onProgress,
}: WebOnlineImportRequest): Promise<WebOnlineImportedGame[]> {
  const trimmedUsername = username.trim();
  if (!trimmedUsername) return [];

  const since = mode === "range" ? getWebOnlineRangeSince(range) : null;
  const limit = mode === "count" ? clampOnlineGameCount(count) : MAX_ONLINE_GAMES;

  return source === "chesscom"
    ? fetchChessComGames(trimmedUsername, limit, since, onProgress)
    : fetchLichessGames(trimmedUsername, limit, since, onProgress);
}

export function getWebOnlineSourceLabel(source: WebOnlineSource) {
  return source === "chesscom" ? "Chess.com" : "Lichess";
}

export function getWebOnlineRangeLabel(range: WebOnlineRangePreset) {
  switch (range) {
    case "3m":
      return "Last 3 months";
    case "6m":
      return "Last 6 months";
    case "1y":
      return "Last year";
    case "all":
      return "All public games";
  }
}

export function getWebOnlineImportTitle({
  source,
  username,
  mode,
  count,
  range,
}: Omit<WebOnlineImportRequest, "onProgress">) {
  const sourceLabel = getWebOnlineSourceLabel(source);
  if (mode === "count") {
    return `${username} ${sourceLabel} recent ${clampOnlineGameCount(count)}`;
  }
  return `${username} ${sourceLabel} ${getWebOnlineRangeLabel(range).toLowerCase()}`;
}

export function getWebOnlineRangeSince(range: WebOnlineRangePreset) {
  if (range === "all") return null;

  const date = new Date();
  if (range === "3m") date.setMonth(date.getMonth() - 3);
  if (range === "6m") date.setMonth(date.getMonth() - 6);
  if (range === "1y") date.setFullYear(date.getFullYear() - 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function clampOnlineGameCount(count: number) {
  return Math.max(1, Math.min(MAX_ONLINE_GAMES, Math.round(count || 1)));
}

async function fetchChessComGames(
  username: string,
  limit: number,
  since: number | null,
  onProgress?: (loaded: number, expected: number | null) => void,
) {
  const archivesResponse = await fetch(
    `${CHESSCOM_ARCHIVES_URL}/${encodeURIComponent(username.toLowerCase())}/games/archives`,
  );
  if (!archivesResponse.ok) {
    throw new Error(`Chess.com did not return archives for ${username}.`);
  }

  const archiveData = (await archivesResponse.json()) as { archives?: string[] };
  const archives = (archiveData.archives ?? [])
    .filter((archive) => !since || chessComArchiveIsInRange(archive, since))
    .slice()
    .reverse();
  const games: WebOnlineImportedGame[] = [];

  for (const [index, archive] of archives.entries()) {
    const response = await fetch(`${archive}/pgn`);
    if (!response.ok) continue;

    const pgnChunk = await response.text();
    for (const pgn of splitPgnGames(pgnChunk)) {
      games.push({
        source: "chesscom",
        username,
        pgn,
        playedAt: getPgnTimestamp(pgn),
        url: getPgnHeader(pgn, "Link") ?? `https://www.chess.com/member/${username}`,
      });
    }

    games.sort((a, b) => b.playedAt - a.playedAt);
    onProgress?.(
      since ? index + 1 : Math.min(games.length, limit),
      since ? archives.length : limit,
    );
    if (games.length >= limit) break;
    if (since && index === archives.length - 1) break;
  }

  return games
    .filter((game) => !since || game.playedAt >= since)
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, limit);
}

async function fetchLichessGames(
  username: string,
  limit: number,
  since: number | null,
  onProgress?: (loaded: number, expected: number | null) => void,
) {
  const url = new URL(`${LICHESS_GAMES_URL}/${encodeURIComponent(username)}`);
  url.searchParams.set("max", String(limit));
  url.searchParams.set("sort", "dateDesc");
  url.searchParams.set("pgnInJson", "true");
  url.searchParams.set("clocks", "true");
  url.searchParams.set("evals", "true");
  url.searchParams.set("accuracy", "true");
  url.searchParams.set("perfType", "ultraBullet,bullet,blitz,rapid,classical,correspondence");
  if (since) url.searchParams.set("since", String(since));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/x-ndjson",
    },
  });
  if (!response.ok) {
    throw new Error(`Lichess did not return public games for ${username}.`);
  }

  const games = (await response.text())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { id?: string; pgn?: string; lastMoveAt?: number; createdAt?: number };
      } catch {
        return null;
      }
    })
    .filter((game): game is { id?: string; pgn: string; lastMoveAt?: number; createdAt?: number } =>
      Boolean(game?.pgn?.trim()),
    )
    .map((game) => ({
      source: "lichess" as const,
      username,
      pgn: game.pgn.trim(),
      playedAt: game.lastMoveAt ?? game.createdAt ?? getPgnTimestamp(game.pgn),
      url: game.id ? `https://lichess.org/${game.id.slice(0, 8)}` : `https://lichess.org/@/${username}`,
    }))
    .filter((game) => !since || game.playedAt >= since)
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, limit);

  onProgress?.(games.length, limit);
  return games;
}

function chessComArchiveIsInRange(archive: string, since: number) {
  const [year, month] = archive.split("/").slice(-2).map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return true;
  const archiveDate = new Date(year, month - 1, 1).getTime();
  const sinceDate = new Date(since);
  const sinceMonth = new Date(sinceDate.getFullYear(), sinceDate.getMonth(), 1).getTime();
  return archiveDate >= sinceMonth;
}

function splitPgnGames(pgn: string) {
  return pgn
    .split(/\n(?=\[Event\s)/g)
    .map((game) => game.trim())
    .filter(Boolean);
}

function getPgnTimestamp(pgn: string) {
  const utcDate = getPgnHeader(pgn, "UTCDate") ?? getPgnHeader(pgn, "Date");
  const utcTime = getPgnHeader(pgn, "UTCTime") ?? "00:00:00";
  if (!utcDate) return 0;

  const normalizedDate = utcDate.replace(/\./g, "-").replace(/\?/g, "0");
  const timestamp = Date.parse(`${normalizedDate}T${utcTime.replace(/\?/g, "0")}Z`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getPgnHeader(pgn: string, name: string) {
  const match = pgn.match(new RegExp(`^\\[${name}\\s+"([^"]*)"\\]`, "m"));
  return match?.[1] ?? null;
}
