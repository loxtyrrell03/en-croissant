export type ChessComGameType = "live" | "daily";

export type ChessComGameUrl = {
    gameId: string;
    gameTypes: ChessComGameType[];
};

const GAME_URL_REGEX = /chess\.com\/(?:analysis\/)?game\/(?:(live|daily)\/)?(\d+)/i;
const PGN_LINK_REGEX = /^\[Link\s+"([^"]*chess\.com\/(?:analysis\/)?game\/[^"]+)"\]\s*$/im;

export function parseChessComGameUrl(url: string): ChessComGameUrl | null {
    const match = url.match(GAME_URL_REGEX);
    if (!match) return null;

    const explicitType = match[1]?.toLowerCase() as ChessComGameType | undefined;
    return {
        gameId: match[2],
        gameTypes: explicitType ? [explicitType] : ["live", "daily"],
    };
}

export function getChessComGameLinkFromPgn(pgn: string): string | null {
    return pgn.match(PGN_LINK_REGEX)?.[1] ?? null;
}
