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
    nextBeforeByProviderKey: Record<string, number>;
    hasOlderByProviderKey: Record<string, boolean>;
};

export type LatestOnlineGameAccountSelection = Record<string, boolean>;

export type RecentOnlineGamesOptions = {
    limitPerProvider?: number;
    beforeByProviderKey?: Record<string, number | null | undefined>;
};

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
    options: RecentOnlineGamesOptions | number = {},
): Promise<RecentOnlineGamesResult> {
    const providers = getSelectedOnlineGameProviders(sessions, selection);
    if (providers.length === 0) {
        return {
            games: [],
            failures: [],
            nextBeforeByProviderKey: {},
            hasOlderByProviderKey: {},
        };
    }

    const { limitPerProvider, beforeByProviderKey } = normalizeRecentOnlineGamesOptions(options);
    const fetchLimit = limitPerProvider + 1;

    const results = await Promise.allSettled(
        providers.map(
            async (
                provider,
            ): Promise<{
                games: RecentOnlineGame[];
                hasOlder: boolean;
                nextBefore: number | null;
                providerKey: string;
            }> => {
                const providerKey = getOnlineGameProviderKey(provider);
                const before = beforeByProviderKey[providerKey] ?? null;
                if (provider.source === "lichess") {
                    const games = await getRecentLichessGames(
                        provider.username,
                        fetchLimit,
                        provider.token,
                        before,
                    );
                    const pageGames = games.slice(0, limitPerProvider);
                    return {
                        games: pageGames.map((game, index) => ({
                            ...game,
                            id: `${providerKey}:${game.url || game.playedAt || index}`,
                            providerKey,
                            sourceLabel: provider.sourceLabel,
                        })),
                        hasOlder: games.length > limitPerProvider,
                        nextBefore: getOldestPlayedAt(pageGames),
                        providerKey,
                    };
                }

                const games = await getRecentChessComGames(provider.username, fetchLimit, before);
                const pageGames = games.slice(0, limitPerProvider);
                return {
                    games: pageGames.map((game, index) => ({
                        ...game,
                        id: `${providerKey}:${game.url || game.playedAt || index}`,
                        providerKey,
                        sourceLabel: provider.sourceLabel,
                    })),
                    hasOlder: games.length > limitPerProvider,
                    nextBefore: getOldestPlayedAt(pageGames),
                    providerKey,
                };
            },
        ),
    );

    const games: RecentOnlineGame[] = [];
    const failures: string[] = [];
    const nextBeforeByProviderKey: Record<string, number> = {};
    const hasOlderByProviderKey: Record<string, boolean> = {};

    results.forEach((result, index) => {
        const provider = providers[index];
        if (result.status === "fulfilled") {
            games.push(...result.value.games);
            hasOlderByProviderKey[result.value.providerKey] = result.value.hasOlder;
            if (result.value.nextBefore !== null) {
                nextBeforeByProviderKey[result.value.providerKey] = result.value.nextBefore;
            }
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
        nextBeforeByProviderKey,
        hasOlderByProviderKey,
    };
}

function normalizeRecentOnlineGamesOptions(
    options: RecentOnlineGamesOptions | number,
): Required<RecentOnlineGamesOptions> {
    if (typeof options === "number") {
        return {
            limitPerProvider: Math.max(1, Math.round(options)),
            beforeByProviderKey: {},
        };
    }

    return {
        limitPerProvider: Math.max(1, Math.round(options.limitPerProvider ?? 10)),
        beforeByProviderKey: options.beforeByProviderKey ?? {},
    };
}

function getOldestPlayedAt(games: Pick<RecentOnlineGame, "playedAt">[]) {
    if (games.length === 0) return null;
    return Math.min(...games.map((game) => game.playedAt));
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
