export type FidePlayer = {
    id: number;
    name: string;
    title?: string;
    federation?: string;
    year?: number;
    standard?: number;
    rapid?: number;
    blitz?: number;
    inactive?: boolean;
    photo?: {
        small?: string;
        large?: string;
    };
};

type RawFidePlayer = Partial<FidePlayer>;

export const MAX_FIDE_SEARCH_RESULTS = 8;

export function parseFidePlayer(raw: unknown): FidePlayer | null {
    if (!raw || typeof raw !== "object") return null;
    const player = raw as RawFidePlayer;
    if (typeof player.id !== "number" || typeof player.name !== "string") return null;
    return {
        id: player.id,
        name: player.name,
        title: typeof player.title === "string" ? player.title : undefined,
        federation: typeof player.federation === "string" ? player.federation : undefined,
        year: typeof player.year === "number" ? player.year : undefined,
        standard: typeof player.standard === "number" ? player.standard : undefined,
        rapid: typeof player.rapid === "number" ? player.rapid : undefined,
        blitz: typeof player.blitz === "number" ? player.blitz : undefined,
        inactive: player.inactive === true ? true : undefined,
        photo:
            player.photo && typeof player.photo === "object"
                ? {
                      small:
                          typeof player.photo.small === "string" ? player.photo.small : undefined,
                      large:
                          typeof player.photo.large === "string" ? player.photo.large : undefined,
                  }
                : undefined,
    };
}

export function parseFidePlayers(raw: unknown): FidePlayer[] {
    const entries = Array.isArray(raw) ? raw : [raw];
    const seen = new Set<number>();
    const players: FidePlayer[] = [];
    for (const entry of entries) {
        const player = parseFidePlayer(entry);
        if (!player || seen.has(player.id)) continue;
        seen.add(player.id);
        players.push(player);
    }
    return players;
}

export function isFidePlayerSearchReady(query: string) {
    const trimmed = query.trim();
    return /^\d+$/.test(trimmed) ? trimmed.length >= 4 : trimmed.length >= 3;
}

export function getFidePlayerRating(player: FidePlayer) {
    return player.standard ?? player.rapid ?? player.blitz;
}

export function describeFidePlayer(player: FidePlayer) {
    const parts: string[] = [];
    if (player.federation) parts.push(player.federation);
    if (player.year) parts.push(`b. ${player.year}`);
    const rating = getFidePlayerRating(player);
    if (rating) parts.push(String(rating));
    if (player.inactive) parts.push("inactive");
    return parts.join(" · ");
}

function nameTokens(name: string) {
    return name
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function oneEditApart(left: string, right: string) {
    if (left === right) return true;
    if (left.length < 4 || right.length < 4 || Math.abs(left.length - right.length) > 1) {
        return false;
    }
    let leftIndex = 0;
    let rightIndex = 0;
    let edits = 0;
    while (leftIndex < left.length && rightIndex < right.length) {
        if (left[leftIndex] === right[rightIndex]) {
            leftIndex += 1;
            rightIndex += 1;
            continue;
        }
        edits += 1;
        if (edits > 1) return false;
        if (left.length > right.length) leftIndex += 1;
        else if (right.length > left.length) rightIndex += 1;
        else {
            leftIndex += 1;
            rightIndex += 1;
        }
    }
    return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

/**
 * Lichess returns a broad, loosely ordered list. Rank exact surname/name hits
 * first while retaining a conservative one-character typo match for the same
 * misspellings the OTB collector accepts once a FIDE ID pins the identity.
 */
export function rankFidePlayers(query: string, players: FidePlayer[]) {
    const terms = nameTokens(query);
    if (!terms.length) return players;
    return players
        .map((player, index) => {
            const tokens = nameTokens(player.name);
            let score = 0;
            for (const term of terms) {
                if (tokens.some((token) => token === term)) score += 12;
                else if (tokens.some((token) => token.startsWith(term))) score += 7;
                else if (tokens.some((token) => oneEditApart(token, term))) score += 4;
                else if (tokens.some((token) => token.includes(term))) score += 2;
            }
            const surname = tokens[0];
            if (surname === terms[0]) score += 10;
            else if (surname?.startsWith(terms[0])) score += 5;
            else if (surname && oneEditApart(surname, terms[0])) score += 3;
            if (player.inactive) score -= 6;
            return {
                player,
                score,
                rating: getFidePlayerRating(player) ?? 0,
                index,
            };
        })
        .sort(
            (left, right) =>
                right.score - left.score || right.rating - left.rating || left.index - right.index,
        )
        .map(({ player }) => player);
}
