export type PlayerNameCandidate = {
    name?: string | null;
};

const PLAYER_LABEL_STOP_WORDS = new Set([
    "account",
    "accounts",
    "chess",
    "chesscom",
    "com",
    "db3",
    "games",
    "lichess",
    "online",
]);

export function normalizePlayerText(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

export function getPlayerSearchQueries(searchText: string) {
    const normalized = normalizePlayerText(searchText);
    if (normalized.length < 3) return [];

    const queries = new Set([searchText.trim()]);
    const allTokens = normalized.split(" ").filter(Boolean);
    const meaningfulTokens = getMeaningfulPlayerTokens(allTokens);
    const tokens = meaningfulTokens.length > 0 ? meaningfulTokens : allTokens;

    const stripped = tokens.join(" ");
    if (stripped && stripped !== normalized) {
        queries.add(stripped);
    }

    if (tokens.length === 2 && !searchText.includes(",")) {
        queries.add(`${tokens[1]}, ${tokens[0]}`);
    }
    for (const token of tokens) {
        if (token.length >= 3) queries.add(token);
    }

    return [...queries];
}

export function selectResolvedPlayerCandidate<T extends PlayerNameCandidate>(
    players: T[],
    searchText: string,
) {
    const normalizedSearch = normalizePlayerText(searchText);
    const normalizedCandidates = getNormalizedPlayerSearchCandidates(searchText);

    const exact = players.find(
        (player) => normalizePlayerText(player.name ?? "") === normalizedSearch,
    );
    if (exact) return exact;

    const candidateExact = players.find((player) =>
        normalizedCandidates.has(normalizePlayerText(player.name ?? "")),
    );
    if (candidateExact) return candidateExact;

    const allTokens = normalizedSearch.split(" ").filter(Boolean);
    const meaningfulTokens = getMeaningfulPlayerTokens(allTokens);
    const tokens = meaningfulTokens.length > 0 ? meaningfulTokens : allTokens;

    const exactToken = players.find((player) => {
        const normalizedName = normalizePlayerText(player.name ?? "");
        return normalizedName.length >= 3 && tokens.includes(normalizedName);
    });
    if (exactToken) return exactToken;

    return (
        players.find((player) => {
            const normalizedName = normalizePlayerText(player.name ?? "");
            return tokens.length > 0 && tokens.every((token) => normalizedName.includes(token));
        }) ?? null
    );
}

function getNormalizedPlayerSearchCandidates(searchText: string) {
    const candidates = new Set<string>();
    for (const query of getPlayerSearchQueries(searchText)) {
        const normalized = normalizePlayerText(query);
        if (normalized) candidates.add(normalized);
    }
    return candidates;
}

function getMeaningfulPlayerTokens(tokens: string[]) {
    return tokens.filter((token) => token.length >= 3 && !PLAYER_LABEL_STOP_WORDS.has(token));
}
