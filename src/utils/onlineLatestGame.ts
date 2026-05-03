import { getRecentChessComGames } from "@/utils/chess.com/api";
import { getRecentLichessGames } from "@/utils/lichess/api";
import type { Session } from "@/utils/session";

export type LatestOnlineGame = {
    source: "lichess" | "chesscom";
    sourceLabel: string;
    username: string;
    pgn: string;
    playedAt: number;
    url: string;
};

export type RecentOnlineGame = LatestOnlineGame & {
    id: string;
    providerKey: string;
};

export type RecentOnlineGamesResult = {
    games: RecentOnlineGame[];
    failures: string[];
};

export type LatestOnlineGameAccountSelection = Record<string, boolean>;

export type OnlineGameProvider =
    | {
          source: "lichess";
          sourceLabel: "Lichess";
          username: string;
          token?: string;
      }
    | {
          source: "chesscom";
          sourceLabel: "Chess.com";
          username: string;
      };

export function getOnlineGameProviderKey(
    provider: Pick<OnlineGameProvider, "source" | "username">,
) {
    return `${provider.source}:${provider.username.trim().toLowerCase()}`;
}

export function getLinkedOnlineGameProviders(sessions: Session[]): OnlineGameProvider[] {
    const providers: OnlineGameProvider[] = [];
    const seen = new Set<string>();

    for (const session of sessions) {
        if (session.lichess?.username) {
            const username = session.lichess.username.trim();
            const key = getOnlineGameProviderKey({ source: "lichess", username });
            if (username && !seen.has(key)) {
                seen.add(key);
                providers.push({
                    source: "lichess",
                    sourceLabel: "Lichess",
                    username,
                    token: session.lichess.accessToken,
                });
            }
        }

        if (session.chessCom?.username) {
            const username = session.chessCom.username.trim();
            const key = getOnlineGameProviderKey({ source: "chesscom", username });
            if (username && !seen.has(key)) {
                seen.add(key);
                providers.push({
                    source: "chesscom",
                    sourceLabel: "Chess.com",
                    username,
                });
            }
        }
    }

    return providers;
}

export function getSelectedOnlineGameProviders(
    sessions: Session[],
    selection: LatestOnlineGameAccountSelection,
) {
    const providers = getLinkedOnlineGameProviders(sessions);
    return providers.filter((provider) => selection[getOnlineGameProviderKey(provider)] !== false);
}

export async function getLatestOnlineGame(
    sessions: Session[],
    selection: LatestOnlineGameAccountSelection = {},
): Promise<LatestOnlineGame | null> {
    const result = await getRecentOnlineGames(sessions, selection, 1);
    if (result.games.length === 0 && result.failures.length > 0) {
        throw new Error(result.failures.join("; "));
    }
    return result.games[0] ?? null;
}

export async function getRecentOnlineGames(
    sessions: Session[],
    selection: LatestOnlineGameAccountSelection = {},
    limitPerProvider = 10,
): Promise<RecentOnlineGamesResult> {
    const providers = getSelectedOnlineGameProviders(sessions, selection);
    if (providers.length === 0) {
        return { games: [], failures: [] };
    }

    const results = await Promise.allSettled(
        providers.map(async (provider): Promise<RecentOnlineGame[]> => {
            const providerKey = getOnlineGameProviderKey(provider);
            if (provider.source === "lichess") {
                const games = await getRecentLichessGames(
                    provider.username,
                    limitPerProvider,
                    provider.token,
                );
                return games.map((game, index) => ({
                    ...game,
                    id: `${providerKey}:${game.url || game.playedAt || index}`,
                    providerKey,
                    sourceLabel: provider.sourceLabel,
                }));
            }

            const games = await getRecentChessComGames(provider.username, limitPerProvider);
            return games.map((game, index) => ({
                ...game,
                id: `${providerKey}:${game.url || game.playedAt || index}`,
                providerKey,
                sourceLabel: provider.sourceLabel,
            }));
        }),
    );

    const games: RecentOnlineGame[] = [];
    const failures: string[] = [];

    results.forEach((result, index) => {
        const provider = providers[index];
        if (result.status === "fulfilled") {
            games.push(...result.value);
            return;
        }

        failures.push(
            `${provider.sourceLabel} ${provider.username}: ${errorMessage(result.reason)}`,
        );
    });

    return {
        games: games.sort((a, b) => {
            if (b.playedAt !== a.playedAt) return b.playedAt - a.playedAt;
            return a.sourceLabel.localeCompare(b.sourceLabel);
        }),
        failures,
    };
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
