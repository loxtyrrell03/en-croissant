const BUILD_META_NAME = "en-croissant-build";
const BUILD_PLACEHOLDER = "__EN_CROISSANT_BUILD_ID__";
const RELOAD_ATTEMPT_KEY = "en-croissant:web-build-reload";
const RESUME_CHECK_INTERVAL_MS = 15_000;

type AppVersion = {
    sourceCommit?: unknown;
};

export type WebAppUpdateStatus = {
    current: string | null;
    latest: string | null;
    available: boolean;
};

export function getEmbeddedWebBuildId(documentRoot: Document = document) {
    const value = documentRoot
        .querySelector<HTMLMetaElement>(`meta[name="${BUILD_META_NAME}"]`)
        ?.content.trim();
    if (!value || value === BUILD_PLACEHOLDER) return null;
    return value;
}

export function webBuildIsStale(embeddedBuildId: string | null, deployedBuildId: string | null) {
    return Boolean(embeddedBuildId && deployedBuildId && embeddedBuildId !== deployedBuildId);
}

async function fetchDeployedWebBuildId(baseUrl: string) {
    const versionUrl = `${baseUrl}app-version.json?resume=${Date.now()}`;
    const response = await fetch(versionUrl, {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const version = (await response.json()) as AppVersion;
    return typeof version.sourceCommit === "string" ? version.sourceCommit : null;
}

/**
 * Keep an installed phone app on one immutable release without disrupting a
 * healthy active session. A suspended iOS window is reloaded only when its
 * stamped document is older than the release currently served by the PC.
 */
export function installWebAppLifecycle(
    baseUrl: string,
    canReload: () => boolean = () => true,
    options: { autoReload?: boolean; onUpdate?: (status: WebAppUpdateStatus) => void } = {},
) {
    const embeddedBuildId = getEmbeddedWebBuildId();
    let disposed = false;
    let checkInFlight: Promise<void> | null = null;
    let lastResumeCheckAt = 0;
    let latestBuildId: string | null = null;
    const apply = (explicit = false) => {
        if (disposed || !canReload() || !webBuildIsStale(embeddedBuildId, latestBuildId))
            return false;
        const attempt = `${embeddedBuildId}->${latestBuildId}`;
        if (!explicit && window.sessionStorage.getItem(RELOAD_ATTEMPT_KEY) === attempt)
            return false;
        window.sessionStorage.setItem(RELOAD_ATTEMPT_KEY, attempt);
        window.location.reload();
        return true;
    };

    const checkForStaleBuild = (force = false) => {
        if (disposed || document.visibilityState === "hidden" || !embeddedBuildId) {
            return Promise.resolve();
        }
        const now = Date.now();
        if (!force && now - lastResumeCheckAt < RESUME_CHECK_INTERVAL_MS) {
            return checkInFlight ?? Promise.resolve();
        }
        if (checkInFlight) return checkInFlight;
        lastResumeCheckAt = now;
        checkInFlight = (async () => {
            try {
                const deployedBuildId = await fetchDeployedWebBuildId(baseUrl);
                if (disposed) return;
                latestBuildId = deployedBuildId;
                options.onUpdate?.({
                    current: embeddedBuildId,
                    latest: deployedBuildId,
                    available: webBuildIsStale(embeddedBuildId, deployedBuildId),
                });
                if (!webBuildIsStale(embeddedBuildId, deployedBuildId)) {
                    if (deployedBuildId === embeddedBuildId) {
                        window.sessionStorage.removeItem(RELOAD_ATTEMPT_KEY);
                    }
                    return;
                }

                // The actual app offers an update action; old callers retain their
                // guarded resume behavior. Never reload a pending/failed save.
                if (options.autoReload !== false) apply();
            } catch (error) {
                console.warn("Could not check the active phone app version", error);
            }
        })().finally(() => {
            checkInFlight = null;
        });
        return checkInFlight;
    };

    const refreshRegistration = async (forceVersionCheck = false) => {
        // A stuck iOS worker update must not prevent the version check.
        void checkForStaleBuild(forceVersionCheck);
        if (!("serviceWorker" in navigator)) return;
        try {
            const registration = await navigator.serviceWorker.register(`${baseUrl}web-sw.js`);
            await registration.update();
        } catch (error) {
            console.warn("Web companion service worker registration failed", error);
        }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
        void refreshRegistration(event.persisted);
    };
    const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") void refreshRegistration();
    };
    const handleWorkerChange = () => {
        void checkForStaleBuild(true);
    };
    const handleWorkerMessage = (event: MessageEvent) => {
        if (event.data?.type === "EN_CROISSANT_SW_ACTIVATED") handleWorkerChange();
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.serviceWorker?.addEventListener("controllerchange", handleWorkerChange);
    navigator.serviceWorker?.addEventListener("message", handleWorkerMessage);
    const check = () => void checkForStaleBuild(true);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    const timer = setInterval(() => void checkForStaleBuild(), 30_000);
    void refreshRegistration(true);

    const cleanup = () => {
        disposed = true;
        clearInterval(timer);
        window.removeEventListener("pageshow", handlePageShow);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        navigator.serviceWorker?.removeEventListener("controllerchange", handleWorkerChange);
        navigator.serviceWorker?.removeEventListener("message", handleWorkerMessage);
        window.removeEventListener("online", check);
        window.removeEventListener("focus", check);
    };
    return Object.assign(cleanup, { apply, check: () => checkForStaleBuild(true) });
}
