import { getWebServerUrl } from "./serverUrl";
import { parseFidePlayers, type FidePlayer } from "@/utils/fidePlayer";
import type { WebImportResult } from "./model";

export const WEB_OTB_JOB_STORAGE_KEY = "encroissant-web-otb-job";
export const WEB_OTB_PREP_HANDLED_JOB_STORAGE_KEY = "encroissant-web-otb-prep-handled-job";

export type WebOtbImportSources = {
    lichessBroadcasts: boolean;
    broadcastArchives: boolean;
    communityBroadcasts: boolean;
    chessResults: boolean;
    chessbaseNews: boolean;
    officialPgnIndexes: boolean;
    twic: boolean;
};

export type WebOtbImportedGame = {
    source: "otb";
    playerName: string;
    id: string;
    pgn: string;
    event: string;
    site: string;
    date: string;
    white: string;
    black: string;
    result: string;
    whiteElo: number | null;
    blackElo: number | null;
};

export type WebOtbImportProgress = {
    jobId: string;
    source: string;
    phase: string;
    current: number;
    total: number;
    gamesFound: number;
    message: string;
};

export type WebOtbImportJob = {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    request: {
        playerName: string;
        fideId: string | null;
        fromYear: number;
        sources: WebOtbImportSources;
    };
    progress: WebOtbImportProgress | null;
    report: {
        playerName: string;
        fideId: string | null;
        cancelled: boolean;
        gamesFound: number;
        duplicatesRemoved: number;
    } | null;
    games: Omit<WebOtbImportedGame, "source" | "playerName">[];
    prepDatabase: WebImportResult | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    error: string | null;
};

export const DEFAULT_WEB_OTB_IMPORT_SOURCES: WebOtbImportSources = {
    lichessBroadcasts: true,
    broadcastArchives: false,
    communityBroadcasts: false,
    chessResults: true,
    chessbaseNews: true,
    officialPgnIndexes: true,
    twic: true,
};

export async function startWebOtbImport(request: {
    playerName: string;
    fideId: string;
    fromYear: number;
    sources: WebOtbImportSources;
}) {
    return requestWebOtbJob("api/otb-import/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
    });
}

export async function loadWebOtbImportJob(jobId: string, signal?: AbortSignal) {
    return requestWebOtbJob(`api/otb-import/jobs/${encodeURIComponent(jobId)}`, { signal });
}

export async function searchWebFidePlayers(
    query: string,
    signal?: AbortSignal,
): Promise<FidePlayer[]> {
    const response = await fetch(
        getWebServerUrl(`api/otb-import/players?q=${encodeURIComponent(query.trim())}`),
        {
            headers: { accept: "application/json" },
            cache: "no-store",
            signal,
        },
    );
    const body = (await response.json().catch(() => null)) as {
        players?: unknown;
        error?: string;
    } | null;
    if (!response.ok) {
        throw new Error(body?.error || "The PC FIDE player search did not respond.");
    }
    return parseFidePlayers(body?.players);
}

export function getWebOtbImportedGames(job: WebOtbImportJob): WebOtbImportedGame[] {
    return job.games.map((game) => ({
        ...game,
        source: "otb",
        playerName: getWebOtbJobPlayerName(job),
    }));
}

export function getWebOtbJobPlayerName(job: WebOtbImportJob) {
    return job.report?.playerName?.trim() || job.request.playerName.trim();
}

async function requestWebOtbJob(path: string, init?: RequestInit): Promise<WebOtbImportJob> {
    const response = await fetch(getWebServerUrl(path), {
        ...init,
        headers: { accept: "application/json", ...init?.headers },
        cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as
        | WebOtbImportJob
        | { error?: string }
        | null;
    if (!response.ok) {
        throw new Error(
            body && "error" in body && body.error
                ? body.error
                : "The PC OTB importer did not respond.",
        );
    }
    return body as WebOtbImportJob;
}
