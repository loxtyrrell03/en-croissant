import { isTauri, invoke } from "@tauri-apps/api/core";
import { getWebServerUrl } from "@/web/serverUrl";
import type {
    CollectionRow,
    DataPackJob,
    DataPackReview,
    DataPackStatus,
    DownloadRemovalReview,
    OtbImportReport,
    OtbImportRequest,
    OtbLibraryStatus,
    TournamentDiscoveryRequest,
    TournamentDiscoveryResponse,
    TournamentEventMetadata,
    TournamentSearchResult,
    TournamentSnapshot,
} from "./types";
export * from "./types";

export const isNativeDesktop = () => isTauri();
/** Compatibility with the ported views: both hosts expose this service. */
export const isDesktop = () => typeof window !== "undefined";

export interface ImportCheckpoint {
    jobId: string;
    playerName: string;
    fideId: string;
    fromYear: number;
    sources: import("./otbImportModel").OtbImportSourceSelection;
    phase: "collect" | "save" | "ready" | "stopped";
    outputPath?: string;
    dbPath?: string;
    append?: boolean;
    report?: OtbImportReport;
    phoneDatabaseId?: string;
    phonePrepId?: string;
    savedJobIds?: string[];
    warning?: string;
}
export interface OpponentCollection extends CollectionRow {
    metadata: ImportCheckpoint | Record<string, never>;
}
export async function tournamentRequest<T>(method: string, params: unknown = {}): Promise<T> {
    if (isNativeDesktop()) {
        const raw = await invoke<string>("tournament_request", {
            request: JSON.stringify({ method, params }),
        });
        return JSON.parse(raw) as T;
    }
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        method === "maintainOtbLibrary" || method === "setOtbLibraryPreferences"
            ? 10 * 60_000
            : 90_000,
    );
    try {
        const response = await fetch(getWebServerUrl("api/tournaments"), {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ method, params }),
            signal: controller.signal,
            cache: "no-store",
        });
        const payload = (await response.json()) as { result?: T; error?: string };
        if (!response.ok || payload.error)
            throw new Error(payload.error || `Tournament service returned ${response.status}.`);
        return payload.result as T;
    } catch (error) {
        if (controller.signal.aborted)
            throw new Error(
                "The PC did not confirm this operation. Retry to check its saved state.",
            );
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

export const desktopApi = {
    fetchTournamentSnapshot: (url: string) =>
        tournamentRequest<TournamentSnapshot>("fetchTournamentSnapshot", { url }),
    searchTournaments: (query: string) =>
        tournamentRequest<TournamentSearchResult[]>("searchTournaments", { query }),
    discoverTournaments: (request: TournamentDiscoveryRequest) =>
        tournamentRequest<TournamentDiscoveryResponse>("discoverTournaments", request),
    tournamentEventMetadata: (url: string) =>
        tournamentRequest<TournamentEventMetadata>("tournamentEventMetadata", { url }),
    openTournamentWebsite: async (url: string) => {
        if (!/^https?:\/\//i.test(url)) throw new Error("Invalid website link.");
        if (isNativeDesktop()) {
            const { openUrl } = await import("@tauri-apps/plugin-opener");
            await openUrl(url);
        } else window.open(url, "_blank", "noopener,noreferrer");
    },
    settingsGet: (key: string) => tournamentRequest<string | null>("settingsGet", { key }),
    settingsSet: (key: string, value: string) =>
        tournamentRequest<void>("settingsSet", { key, value }),
    collectionList: () => tournamentRequest<OpponentCollection[]>("collectionList"),
    collectionGet: (id: number) => tournamentRequest<OpponentCollection>("collectionGet", { id }),
    collectionCreate: (name: string, requestKey: string = crypto.randomUUID()) =>
        tournamentRequest<number>("collectionCreate", { name, requestKey }),
    collectionSetFolder: (id: number, folder: string) =>
        tournamentRequest<void>("collectionSetFolder", { id, folder }),
    collectionSetDescription: (id: number, description: string) =>
        tournamentRequest<void>("collectionSetDescription", { id, description }),
    collectionUpdate: (id: number, gameCount: number, metadata: ImportCheckpoint) =>
        tournamentRequest<void>("collectionUpdate", { id, gameCount, metadata }),
    collectionDelete: async (id: number) => {
        const collection = await desktopApi.collectionGet(id);
        if (isNativeDesktop() && collection.metadata.dbPath) {
            const { getDatabasesDir } = await import("@/utils/directories");
            const { resolve, basename } = await import("@tauri-apps/api/path");
            const path = collection.metadata.dbPath,
                name = await basename(path);
            const expected = await resolve(await getDatabasesDir(), name);
            if (
                !new RegExp(`^tournament-${id}-otb-[a-f0-9-]+\\.db3$`).test(name) ||
                path.replaceAll("\\", "/").toLowerCase() !==
                    expected.replaceAll("\\", "/").toLowerCase()
            )
                throw new Error(
                    "This database is outside the tournament import folder. Remove it from Databases instead.",
                );
            const { commands } = await import("@/bindings");
            const { unwrap } = await import("@/utils/unwrap");
            const { exists } = await import("@tauri-apps/plugin-fs");
            if (await exists(path)) unwrap(await commands.deleteDatabase(path));
        } else if (!isNativeDesktop())
            await (await import("./phoneTournament")).deletePhoneTournamentImport(collection);
        await tournamentRequest<void>("collectionForget", { id });
    },
    collectOtbGames: async (request: OtbImportRequest): Promise<OtbImportReport> => {
        const { commands } = await import("@/bindings");
        const { unwrap } = await import("@/utils/unwrap");
        return unwrap(await commands.collectOtbGames(request));
    },
    cancelOtbGames: async (jobId: string) => {
        if (isNativeDesktop()) {
            const { commands } = await import("@/bindings");
            return commands.cancelOtbGames(jobId);
        }
        const { cancelWebOtbImport } = await import("@/web/otbImport");
        await cancelWebOtbImport(jobId);
        return true;
    },
    dataPackStatus: () => tournamentRequest<DataPackStatus>("dataPackStatus"),
    otbLibraryStatus: () => tournamentRequest<OtbLibraryStatus>("otbLibraryStatus"),
    checkOtbPackUpdates: () => tournamentRequest<number>("checkOtbPackUpdates"),
    reviewDataPack: (id: string, parent: string) =>
        tournamentRequest<DataPackReview>("reviewDataPack", { id, parent }),
    startDataPack: (token: string) => tournamentRequest<DataPackJob>("startDataPack", { token }),
    cancelDataPack: (id: string) => tournamentRequest<boolean>("cancelDataPack", { id }),
    maintainOtbLibrary: () => tournamentRequest<void>("maintainOtbLibrary"),
    activateDataPack: (_id: string) => tournamentRequest<void>("maintainOtbLibrary"),
    setOtbLibraryPreferences: (keepYears: number | null, enabled: boolean, parent: string) =>
        tournamentRequest<void>("setOtbLibraryPreferences", { keepYears, enabled, parent }),
    reviewDownloadRemoval: (id: string) =>
        tournamentRequest<DownloadRemovalReview>("reviewDownloadRemoval", { id }),
    removeDownloadedData: (token: string) =>
        tournamentRequest<void>("removeDownloadedData", { token }),
};
