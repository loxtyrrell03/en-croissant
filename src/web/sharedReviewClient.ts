import type { PhoneReviewCard } from "./mistakeReview";
import { getWebServerUrl } from "./serverUrl";
export type SharedReviewSnapshot = {
    accounts: Record<string, string>;
    cards: PhoneReviewCard[];
    enabled: boolean;
    running: boolean;
    reviewedGames: number;
    archivedGames: number;
    savedAnalysisSummaries: number;
    updatedAt: number;
    usefulPositionsCount: number;
    pendingGames?: number;
    currentGame?: string;
    lastCheckedAt?: number;
    error?: string | null;
    discoveryError?: string | null;
};
export async function sharedReviewRequest<T = SharedReviewSnapshot>(
    path = "",
    body?: unknown,
    signal?: AbortSignal,
): Promise<T> {
    const response = await fetch(getWebServerUrl(`api/mistake-review${path}`), {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
        ...(body === undefined
            ? {}
            : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok)
        throw new Error(
            "Could not reach your PC review collection. Your answer has not been saved; please retry.",
        );
    return response.json();
}
