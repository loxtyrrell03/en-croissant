import { withFideRequestDeadline } from "@/utils/fideRequestLifetime";
import { getWebServerUrl } from "./serverUrl";
import { parseFidePlayers, type FidePlayer } from "@/utils/fidePlayer";
import type { WebImportResult } from "./model";
import { withWebRequestDeadline } from "./requestDeadline";

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
    overallCurrent?: number;
    overallTotal?: number;
};

export type WebOtbImportJobStatus = {
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
        /** Optional so completed jobs saved by older phone runtimes remain readable. */
        coverageComplete?: boolean;
        coverageGaps?: string[];
    } | null;
    gameCount?: number;
    artifactAvailable?: boolean;
    artifactBytes?: number | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    error: string | null;
};

export type WebOtbImportArtifact = {
    jobId: string;
    games: Omit<WebOtbImportedGame, "source" | "playerName">[];
    prepDatabase: WebImportResult | null;
};

export type WebOtbImportJob = WebOtbImportJobStatus &
    Omit<WebOtbImportArtifact, "jobId"> & {
        artifactLoaded?: boolean;
    };

export const DEFAULT_WEB_OTB_IMPORT_SOURCES: WebOtbImportSources = {
    lichessBroadcasts: true,
    broadcastArchives: true,
    communityBroadcasts: true,
    chessResults: true,
    chessbaseNews: true,
    officialPgnIndexes: true,
    twic: true,
};

export type WebOtbImportRequest = {
    playerName: string;
    fideId: string | null;
    fromYear: number;
    sources: WebOtbImportSources;
};

export async function startWebOtbImport(request: WebOtbImportRequest, jobId: string) {
    const job = await requestWebOtbJobStatus(
        `api/otb-import/jobs/${encodeURIComponent(jobId)}`,
        {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
        },
        jobId,
    );
    if (
        !job.request ||
        job.request.playerName !== request.playerName.trim().replace(/\s+/g, " ") ||
        (job.request.fideId || null) !== (request.fideId || null) ||
        job.request.fromYear !== request.fromYear ||
        Object.keys(DEFAULT_WEB_OTB_IMPORT_SOURCES).some(
            (key) =>
                job.request.sources?.[key as keyof WebOtbImportSources] !==
                request.sources[key as keyof WebOtbImportSources],
        )
    ) {
        throw new Error(
            "The PC returned a different search. Retry the connection to the saved request.",
        );
    }
    return job;
}

export async function loadWebOtbImportJob(jobId: string, signal?: AbortSignal) {
    const job = await requestWebOtbJobStatus(
        `api/otb-import/jobs/${encodeURIComponent(jobId)}`,
        {
            signal,
        },
        jobId,
    );
    if (
        job.status !== "completed" ||
        !job.artifactAvailable ||
        job.prepDatabase ||
        job.games.length > 0
    ) {
        return job;
    }
    const artifact = await requestWebOtbArtifact(jobId, signal);
    return {
        ...job,
        gameCount: artifact.games.length,
        games: artifact.games,
        prepDatabase: artifact.prepDatabase,
        artifactLoaded: true,
    };
}

export async function cancelWebOtbImport(jobId: string) {
    const job = await requestWebOtbJobStatus(
        `api/otb-import/jobs/${encodeURIComponent(jobId)}`,
        {
            method: "DELETE",
        },
        jobId,
    );
    // A status GET started before Stop may still be in flight. Replace that
    // observation before it can publish an older running state or empty result.
    const watcher = webOtbJobWatchers.get(jobId);
    if (watcher) {
        watcher.controller?.abort();
        watcher.controller = null;
        if (watcher.timer) clearTimeout(watcher.timer);
        watcher.timer = null;
        watcher.inFlight = false;
        watcher.terminal = false;
        if (watcher.subscribers.size > 0) void pollWebOtbImportJob(jobId, watcher);
    }
    return job;
}

type WebOtbJobSubscriber = {
    onJob: (job: WebOtbImportJob) => void;
    onError: (error: unknown) => void;
};

type WebOtbJobWatcher = {
    subscribers: Set<WebOtbJobSubscriber>;
    job: WebOtbImportJob | null;
    controller: AbortController | null;
    timer: ReturnType<typeof setTimeout> | null;
    inFlight: boolean;
    terminal: boolean;
};

// The collector finishes many complete imports between one-second boundaries.
// Poll the local PC often enough that downloading the finished artifact does not
// add up to 1.5 seconds of avoidable button-to-ready latency.
const WEB_OTB_POLL_INTERVAL_MS = 500;
const webOtbJobWatchers = new Map<string, WebOtbJobWatcher>();

export function watchWebOtbImportJob(
    jobId: string,
    onJob: (job: WebOtbImportJob) => void,
    onError: (error: unknown) => void = () => undefined,
) {
    let watcher = webOtbJobWatchers.get(jobId);
    if (!watcher) {
        for (const [cachedJobId, cached] of webOtbJobWatchers) {
            if (cachedJobId !== jobId && cached.terminal && cached.subscribers.size === 0) {
                webOtbJobWatchers.delete(cachedJobId);
            }
        }
        watcher = {
            subscribers: new Set(),
            job: null,
            controller: null,
            timer: null,
            inFlight: false,
            terminal: false,
        };
        webOtbJobWatchers.set(jobId, watcher);
    }

    const subscriber = { onJob, onError };
    watcher.subscribers.add(subscriber);
    if (watcher.job) onJob(watcher.job);
    if (!watcher.terminal && !watcher.inFlight && !watcher.timer) {
        void pollWebOtbImportJob(jobId, watcher);
    }

    return () => {
        watcher?.subscribers.delete(subscriber);
        if (!watcher || watcher.subscribers.size > 0 || watcher.terminal) return;
        watcher.controller?.abort();
        if (watcher.timer) clearTimeout(watcher.timer);
        webOtbJobWatchers.delete(jobId);
    };
}

async function pollWebOtbImportJob(jobId: string, watcher: WebOtbJobWatcher) {
    watcher.inFlight = true;
    watcher.timer = null;
    const controller = new AbortController();
    watcher.controller = controller;
    try {
        const job = await loadWebOtbImportJob(jobId, controller.signal);
        if (controller.signal.aborted || watcher.controller !== controller) return;
        watcher.job = job;
        watcher.terminal = job.status === "completed" || job.status === "failed";
        for (const subscriber of watcher.subscribers) subscriber.onJob(job);
    } catch (error) {
        if (!controller.signal.aborted && watcher.controller === controller) {
            for (const subscriber of watcher.subscribers) subscriber.onError(error);
        }
    } finally {
        if (watcher.controller === controller) {
            watcher.controller = null;
            watcher.inFlight = false;
            if (!watcher.terminal && watcher.subscribers.size > 0 && !controller.signal.aborted) {
                watcher.timer = setTimeout(
                    () => void pollWebOtbImportJob(jobId, watcher),
                    WEB_OTB_POLL_INTERVAL_MS,
                );
            }
        }
    }
}

export function getWebOtbProgressValue(
    progress: WebOtbImportProgress | null | undefined,
    running: boolean,
) {
    if (!progress) return 0;
    const total = progress.overallTotal || 0;
    const current = progress.overallCurrent || 0;
    const raw =
        total > 0
            ? Math.round((current / total) * 100)
            : progress.total > 0
              ? Math.round((progress.current / progress.total) * 100)
              : 10;
    return Math.max(0, Math.min(running ? 95 : 100, raw));
}

export async function searchWebFidePlayers(
    query: string,
    signal?: AbortSignal,
): Promise<FidePlayer[]> {
    return withFideRequestDeadline(async (requestSignal) => {
        const response = await fetch(
            getWebServerUrl(`api/otb-import/players?q=${encodeURIComponent(query.trim())}`),
            {
                headers: { accept: "application/json" },
                cache: "no-store",
                signal: requestSignal,
            },
        );
        const body = (await response.json().catch(() => null)) as {
            players?: unknown;
            error?: string;
        } | null;
        if (!response.ok) {
            throw new Error(body?.error || "The PC FIDE player search did not respond.");
        }
        if (
            !body ||
            !Array.isArray(body.players) ||
            body.players.some((player) => parseFidePlayers(player).length !== 1)
        ) {
            throw new Error(
                "The PC FIDE search returned an unreadable response. Retry the search.",
            );
        }
        const players = parseFidePlayers(body.players);
        if (
            /^\d+$/.test(query.trim()) &&
            players.some((player) => player.id !== Number(query.trim()))
        ) {
            throw new Error("The PC FIDE search returned a different player. Retry the search.");
        }
        return players;
    }, signal);
}

export function findExactWebFidePlayer(players: FidePlayer[], playerName: string) {
    const target = normalizeWebFidePlayerName(playerName);
    if (!target) return null;
    const matches = players.filter((player) => normalizeWebFidePlayerName(player.name) === target);
    return matches.length === 1 ? matches[0] : null;
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

function normalizeWebFidePlayerName(value: string) {
    return value
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

async function requestWebOtbJobStatus(
    path: string,
    init?: RequestInit,
    expectedId?: string,
): Promise<WebOtbImportJob> {
    return withWebRequestDeadline(
        async (signal) => {
            const response = await fetch(getWebServerUrl(path), {
                ...init,
                signal,
                headers: { accept: "application/json", ...init?.headers },
                cache: "no-store",
            });
            const body = (await response.json().catch(() => null)) as
                | (Partial<WebOtbImportJobStatus> & Partial<WebOtbImportArtifact>)
                | { error?: string }
                | null;
            if (!response.ok) {
                if (response.status === 405 && init?.method === "PUT") {
                    throw new Error(
                        "The PC phone service needs updating before this search can start. Update it, then retry this search.",
                    );
                }
                throw new Error(
                    body && "error" in body && body.error
                        ? body.error
                        : "The PC OTB importer did not respond.",
                );
            }
            const raw = body as Partial<WebOtbImportJobStatus> & Partial<WebOtbImportArtifact>;
            if (
                !raw ||
                typeof raw.id !== "string" ||
                !/^[A-Za-z0-9_-]+$/.test(raw.id) ||
                (expectedId !== undefined && raw.id !== expectedId) ||
                !["queued", "running", "completed", "failed"].includes(raw.status as string) ||
                (raw.status === "completed" && !raw.request) ||
                (raw.request !== undefined &&
                    (!raw.request ||
                        typeof raw.request.playerName !== "string" ||
                        !raw.request.playerName.trim() ||
                        !Number.isInteger(raw.request.fromYear) ||
                        raw.request.fromYear < 1900))
            ) {
                throw new Error(
                    "The PC returned an invalid OTB search status. Retry the connection.",
                );
            }
            return {
                ...raw,
                gameCount: Number.isInteger(raw.gameCount)
                    ? (raw.gameCount as number)
                    : Array.isArray(raw.games)
                      ? raw.games.length
                      : Number(raw.report?.gamesFound || 0),
                artifactAvailable: raw.artifactAvailable === true,
                artifactBytes: Number.isFinite(raw.artifactBytes)
                    ? (raw.artifactBytes as number)
                    : null,
                games: Array.isArray(raw.games) ? raw.games : [],
                prepDatabase: raw.prepDatabase ?? null,
                artifactLoaded: Array.isArray(raw.games),
            } as WebOtbImportJob;
        },
        15_000,
        "The PC connection took too long. Retry the same search.",
        init?.signal ?? undefined,
    );
}

async function requestWebOtbArtifact(
    jobId: string,
    signal?: AbortSignal,
): Promise<WebOtbImportArtifact> {
    return withWebRequestDeadline(
        async (requestSignal) => {
            const response = await fetch(
                getWebServerUrl(`api/otb-import/jobs/${encodeURIComponent(jobId)}/artifact`),
                {
                    headers: { accept: "application/json" },
                    cache: "no-store",
                    signal: requestSignal,
                },
            );
            const body = (await response.json().catch(() => null)) as
                | WebOtbImportArtifact
                | { error?: string }
                | null;
            if (!response.ok) {
                throw new Error(
                    body && "error" in body && body.error
                        ? body.error
                        : "The PC OTB result artifact did not respond.",
                );
            }
            if (!body || !("jobId" in body) || body.jobId !== jobId || !Array.isArray(body.games)) {
                throw new Error("The PC returned an invalid OTB result artifact.");
            }
            return body;
        },
        600_000,
        "The saved games could not finish downloading. Reconnect to your PC and retry.",
        signal,
    );
}
