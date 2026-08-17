import { getWebServerUrl } from "./serverUrl";

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
    games: Omit<WebOtbImportedGame, "source" | "playerName">[];
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

export function getWebOtbImportedGames(job: WebOtbImportJob): WebOtbImportedGame[] {
    return job.games.map((game) => ({
        ...game,
        source: "otb",
        playerName: job.request.playerName,
    }));
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
