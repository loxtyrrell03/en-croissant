import { getLatestChessComGame } from "@/utils/chess.com/api";
import { getLatestLichessGame } from "@/utils/lichess/api";
import type { Session } from "@/utils/session";

export type LatestOnlineGame = {
    source: "lichess" | "chesscom";
    sourceLabel: string;
    username: string;
    pgn: string;
    playedAt: number;
    url: string;
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
    const providers = getSelectedOnlineGameProviders(sessions, selection);
    if (providers.length === 0) {
        return null;
    }

    const results = await Promise.allSettled(
        providers.map(async (provider): Promise<LatestOnlineGame | null> => {
            if (provider.source === "lichess") {
                const game = await getLatestLichessGame(provider.username, provider.token);
                return game
                    ? {
                          ...game,
                          sourceLabel: provider.sourceLabel,
                      }
                    : null;
            }

            const game = await getLatestChessComGame(provider.username);
            return game
                ? {
                      ...game,
                      sourceLabel: provider.sourceLabel,
                  }
                : null;
        }),
    );

    const games: LatestOnlineGame[] = [];
    const failures: string[] = [];

    results.forEach((result, index) => {
        const provider = providers[index];
        if (result.status === "fulfilled") {
            if (result.value) {
                games.push(result.value);
            }
            return;
        }

        failures.push(
            `${provider.sourceLabel} ${provider.username}: ${errorMessage(result.reason)}`,
        );
    });

    if (games.length === 0 && failures.length > 0) {
        throw new Error(failures.join("; "));
    }

    return (
        games.sort((a, b) => {
            if (b.playedAt !== a.playedAt) return b.playedAt - a.playedAt;
            return a.sourceLabel.localeCompare(b.sourceLabel);
        })[0] ?? null
    );
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
