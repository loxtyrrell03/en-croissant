import {
    DEFAULT_WEB_OTB_IMPORT_SOURCES,
    startWebOtbImport,
    loadWebOtbImportJobStatus,
    refreshWebOtbImportJob,
    WebOtbJobNotFoundError,
    WEB_OTB_JOB_STORAGE_KEY,
    type WebOtbImportJob,
    type WebOtbImportRequest,
    type WebOtbImportSources,
} from "./otbImport";
import { getWebServerUrl } from "./serverUrl";

export const WEB_OTB_START_STORAGE_KEY = "encroissant-web-otb-start";
export type SavedOtbSearchDetails = {
    id: string;
    savedAt: number;
    startRaw: string | null;
    legacyRaw: string | null;
};
export type WebOtbSelectionReview = {
    startRaw: string | null;
    legacyRaw: string | null;
    missingJobId: string | null;
};
type SavedStart = {
    version: 1;
    id: string;
    server: string;
    request: WebOtbImportRequest;
    accepted: boolean;
    previousSearches?: SavedOtbSearchDetails[];
};
type Snapshot = {
    ready: boolean;
    record: SavedStart | null;
    jobId: string | null;
    confirmed: WebOtbImportJob | null;
    busy: boolean;
    error: string | null;
    errorAction: "connect" | "set-aside" | "undo" | null;
    canSetAside: boolean;
    previousSearches: SavedOtbSearchDetails[];
};
let snapshot: Snapshot = {
    ready: false,
    record: null,
    jobId: null,
    confirmed: null,
    busy: false,
    error: null,
    errorAction: null,
    canSetAside: false,
    previousSearches: [],
};
const listeners = new Set<() => void>();
let operation: Promise<void> | null = null;
const idPattern = /^otb-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const currentServer = () =>
    new URL(getWebServerUrl("api/otb-import/jobs"), window.location.href).href;

export function getWebOtbStartSnapshot() {
    return snapshot;
}

function publish(change: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
}

function validRequest(request: WebOtbImportRequest | null | undefined) {
    return Boolean(
        request &&
        typeof request.playerName === "string" &&
        request.playerName.trim().length >= 3 &&
        request.playerName.length <= 120 &&
        (request.fideId === null ||
            request.fideId === "" ||
            (typeof request.fideId === "string" && /^\d{5,12}$/.test(request.fideId))) &&
        Number.isInteger(request.fromYear) &&
        request.fromYear >= 1900 &&
        request.fromYear <= new Date().getFullYear() &&
        request.sources &&
        Object.keys(DEFAULT_WEB_OTB_IMPORT_SOURCES).every(
            (key) => typeof request.sources[key as keyof WebOtbImportSources] === "boolean",
        ) &&
        Object.values(request.sources).some((value) => value === true),
    );
}

class SelectionReadError extends Error {}

function validHistory(value: unknown): value is SavedOtbSearchDetails[] {
    return (
        Array.isArray(value) &&
        value.every(
            (entry) =>
                entry &&
                typeof entry.id === "string" &&
                Number.isSafeInteger(entry.savedAt) &&
                entry.savedAt >= 0 &&
                entry.savedAt <= 8_640_000_000_000_000 &&
                (entry.startRaw === null || typeof entry.startRaw === "string") &&
                (entry.legacyRaw === null || typeof entry.legacyRaw === "string"),
        )
    );
}

function readSelection() {
    try {
        return readStoredSelection();
    } catch (error) {
        if (error instanceof SelectionReadError) throw error;
        throw new Error(storageMessage(error));
    }
}

function readStoredSelection() {
    const stored = window.localStorage.getItem(WEB_OTB_START_STORAGE_KEY);
    let record: (SavedStart & { state?: string }) | null;
    try {
        record = stored === null ? null : JSON.parse(stored);
    } catch {
        throw new SelectionReadError("The saved PC search could not be read.");
    }
    const previousSearches = record?.previousSearches ?? [];
    if (!validHistory(previousSearches))
        throw new SelectionReadError("The saved PC search details could not be read.");
    // One canonical write both keeps the old raw details and clears selection.
    // Its presence takes priority over a leftover legacy mirror.
    if (record?.version === 1 && record.state === "idle") {
        if (
            !record.previousSearches?.length ||
            "id" in record ||
            "request" in record ||
            "accepted" in record ||
            "server" in record
        ) {
            throw new SelectionReadError("The saved PC search details could not be read.");
        }
        return { record: null, jobId: null, previousSearches };
    }
    if (
        stored !== null &&
        (!record ||
            record.version !== 1 ||
            !idPattern.test(record.id) ||
            typeof record.accepted !== "boolean" ||
            !validRequest(record.request))
    ) {
        throw new SelectionReadError("The saved PC search could not be read.");
    }
    if (record && record.server !== currentServer()) {
        throw new SelectionReadError(
            "This search belongs to another PC connection. Reopen the phone app address used to start it.",
        );
    }
    const legacyId = record ? null : window.localStorage.getItem(WEB_OTB_JOB_STORAGE_KEY);
    if (legacyId && !/^[A-Za-z0-9_-]+$/.test(legacyId))
        throw new SelectionReadError("The saved PC search ID could not be read.");
    return {
        record,
        jobId: record ? (record.accepted ? record.id : null) : legacyId,
        previousSearches,
    };
}

function readRawSelection() {
    return {
        startRaw: window.localStorage.getItem(WEB_OTB_START_STORAGE_KEY),
        legacyRaw: window.localStorage.getItem(WEB_OTB_JOB_STORAGE_KEY),
    };
}
function sameRawSelection(
    left: ReturnType<typeof readRawSelection>,
    right: ReturnType<typeof readRawSelection>,
) {
    return left.startRaw === right.startRaw && left.legacyRaw === right.legacyRaw;
}

export function reviewWebOtbSelection(missingJobId: string | null): WebOtbSelectionReview {
    if (operation)
        throw new Error("Wait for the current PC connection before changing the search.");
    const raw = readRawSelection();
    try {
        const current = readSelection();
        if (!missingJobId || (current.jobId ?? current.record?.id) !== missingJobId)
            throw new Error("Check the selected search before setting it aside.");
    } catch (error) {
        if (!(error instanceof SelectionReadError)) throw error;
        missingJobId = null;
    }
    return { ...raw, missingJobId };
}

export function setAsideWebOtbSelection(review: WebOtbSelectionReview) {
    return runStart(async () => {
        if (review.missingJobId) {
            try {
                await loadWebOtbImportJobStatus(review.missingJobId);
                refreshWebOtbImportJob(review.missingJobId);
                return null;
            } catch (error) {
                if (
                    !(error instanceof WebOtbJobNotFoundError) ||
                    error.jobId !== review.missingJobId
                )
                    throw error;
            }
        }
        return withSelectionLock(() => {
            if (!sameRawSelection(readRawSelection(), review)) {
                refresh();
                throw new Error(
                    "The saved search changed in another tab. Review it again before continuing.",
                );
            }
            let previousSearches: SavedOtbSearchDetails[] = [];
            try {
                previousSearches = readSelection().previousSearches;
            } catch {
                /* The exact unreadable record is retained below. */
            }
            const details: SavedOtbSearchDetails = {
                id: crypto.randomUUID(),
                savedAt: Date.now(),
                startRaw: review.startRaw,
                legacyRaw: review.legacyRaw,
            };
            window.localStorage.setItem(
                WEB_OTB_START_STORAGE_KEY,
                JSON.stringify({
                    version: 1,
                    state: "idle",
                    previousSearches: [...previousSearches, details],
                }),
            );
            publish({
                record: null,
                jobId: null,
                confirmed: null,
                ready: true,
                error: null,
                canSetAside: false,
                previousSearches: [...previousSearches, details],
            });
            return null;
        });
    }, "set-aside");
}

export function undoWebOtbSetAside(detailsId: string) {
    return runStart(
        async () =>
            withSelectionLock(() => {
                const selection = readSelection();
                const details = selection.previousSearches.at(-1);
                if (selection.record || selection.jobId || details?.id !== detailsId)
                    throw new Error(
                        "The selected search changed. Keep its current details before restoring another.",
                    );
                if (window.localStorage.getItem(WEB_OTB_JOB_STORAGE_KEY) !== details.legacyRaw)
                    throw new Error(
                        "Another tab changed the saved search. Its current details have been kept.",
                    );
                if (details.startRaw === null)
                    window.localStorage.removeItem(WEB_OTB_START_STORAGE_KEY);
                else window.localStorage.setItem(WEB_OTB_START_STORAGE_KEY, details.startRaw);
                publish({ previousSearches: [] });
                refresh();
                if (snapshot.ready && snapshot.jobId) refreshWebOtbImportJob(snapshot.jobId);
                return null;
            }),
        "undo",
    );
}

function refresh() {
    try {
        const next = readSelection();
        const same = next.record
            ? next.record.id === snapshot.record?.id
            : !snapshot.record && next.jobId === snapshot.jobId;
        const confirmed = snapshot.confirmed?.id === next.record?.id ? snapshot.confirmed : null;
        publish({
            ...next,
            jobId: confirmed?.id ?? next.jobId,
            confirmed,
            ready: true,
            canSetAside: false,
            error: same ? snapshot.error : null,
        });
    } catch (error) {
        publish({
            ready: false,
            canSetAside: error instanceof SelectionReadError,
            error: storageMessage(error),
        });
    }
}

function onStorage(event: StorageEvent) {
    if (
        event.key === null ||
        event.key === WEB_OTB_START_STORAGE_KEY ||
        event.key === WEB_OTB_JOB_STORAGE_KEY
    )
        refresh();
}

export function subscribeWebOtbStart(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) window.addEventListener("storage", onStorage);
    refresh();
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
}

function storageMessage(error: unknown) {
    if (error instanceof Error && /saved PC|another PC connection/.test(error.message))
        return error.message;
    return "This browser could not read or save the PC search. Allow browser storage, then retry the connection.";
}

async function withSelectionLock<T>(action: () => T): Promise<T> {
    if (!navigator.locks || !crypto.randomUUID) {
        throw new Error(
            "Open the secure phone app in an up-to-date browser to start or reconnect a search.",
        );
    }
    // Only synchronous storage work holds this lock, never a network request.
    return navigator.locks.request(WEB_OTB_START_STORAGE_KEY, { ifAvailable: true }, (lock) => {
        if (!lock) throw new Error("Another phone tab is saving a search. Retry the connection.");
        return action();
    });
}

export function getWebOtbSelectionVersion() {
    const stored = window.localStorage.getItem(WEB_OTB_START_STORAGE_KEY);
    return stored === null
        ? `legacy:${JSON.stringify(window.localStorage.getItem(WEB_OTB_JOB_STORAGE_KEY))}`
        : `record:${stored}`;
}

export function beginWebOtbStart(
    request: WebOtbImportRequest,
    expectedJobId: string | null,
    expectedSelectionVersion?: string,
) {
    return runStart(async () =>
        withSelectionLock(() => {
            if (!validRequest(request))
                throw new Error(
                    "Check the player, FIDE ID, year and selected sources before starting the search.",
                );
            const current = readSelection();
            if (
                expectedSelectionVersion !== undefined &&
                getWebOtbSelectionVersion() !== expectedSelectionVersion
            ) {
                refresh();
                throw new Error(
                    "The selected PC search changed while finding the player. Review the current search before starting another.",
                );
            }
            if (current.record && !current.record.accepted) {
                refresh();
                throw new Error(
                    "A saved PC search is waiting to reconnect. Retry that search before starting another.",
                );
            }
            if (current.jobId !== expectedJobId) {
                refresh();
                throw new Error(
                    "The selected PC search changed in another tab. Check it before starting another.",
                );
            }
            const record: SavedStart = {
                version: 1,
                id: `otb-${crypto.randomUUID()}`,
                server: currentServer(),
                request: structuredClone(request),
                accepted: false,
                ...(current.previousSearches.length
                    ? { previousSearches: current.previousSearches }
                    : {}),
            };
            try {
                window.localStorage.setItem(WEB_OTB_START_STORAGE_KEY, JSON.stringify(record));
            } catch (error) {
                throw new Error(storageMessage(error));
            }
            publish({
                record,
                jobId: null,
                confirmed: null,
                ready: true,
                canSetAside: false,
                previousSearches: current.previousSearches,
            });
            return record;
        }),
    );
}

export function retryWebOtbStart() {
    return runStart(async () =>
        withSelectionLock(() => {
            const current = readSelection();
            publish({ ...current, ready: true });
            return current.record;
        }),
    );
}

function runStart(
    prepare: () => Promise<SavedStart | null>,
    action: "connect" | "set-aside" | "undo" = "connect",
) {
    if (operation) return operation;
    publish({ busy: true, error: null, errorAction: null });
    let ownedId: string | null = null;
    operation = Promise.resolve()
        .then(async () => {
            const record = await prepare();
            if (!record || record.accepted) return;
            ownedId = record.id;
            const confirmed =
                snapshot.confirmed?.id === record.id
                    ? snapshot.confirmed
                    : await startWebOtbImport(record.request, record.id);
            await withSelectionLock(() => {
                const current = readSelection();
                if (
                    current.record?.id !== record.id ||
                    JSON.stringify(current.record.request) !== JSON.stringify(record.request)
                ) {
                    refresh();
                    return;
                }
                publish({ confirmed, jobId: record.id });
                const accepted = { ...record, accepted: true };
                try {
                    window.localStorage.setItem(
                        WEB_OTB_START_STORAGE_KEY,
                        JSON.stringify(accepted),
                    );
                } catch (error) {
                    throw new Error(storageMessage(error));
                }
                // The complete record is authoritative. This mirror keeps older readers
                // compatible, but its failure cannot undo a durably acknowledged start.
                try {
                    window.localStorage.setItem(WEB_OTB_JOB_STORAGE_KEY, record.id);
                } catch {
                    /* optional mirror */
                }
                publish({ record: accepted, ready: true, error: null });
            });
        })
        .catch((error: unknown) => {
            if (!ownedId || snapshot.record?.id === ownedId) {
                publish({
                    errorAction: action,
                    error:
                        error instanceof Error
                            ? error.message
                            : "The PC connection failed. Retry the same search.",
                });
            }
        })
        .finally(() => {
            operation = null;
            publish({ busy: false });
        });
    return operation;
}
