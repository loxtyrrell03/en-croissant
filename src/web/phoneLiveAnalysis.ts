import { PcEngineConnectionError } from "./pcEngineConnection";

export type PhoneLiveAnalysisStatus = "running" | "complete" | "reconnecting" | "error";

/** One position/settings snapshot owns its attempts, timers and browser events.
 * Disposing it cannot release a newer Live/report/Plans search. */
export function startPhoneLiveAnalysis<T>({
    analyze,
    onUpdate,
    onStatus,
    release,
}: {
    analyze: (signal: AbortSignal, publish: (result: T) => void) => Promise<T>;
    onUpdate: (result: T) => void;
    onStatus: (status: PhoneLiveAnalysisStatus, message: string | null) => void;
    release: () => void;
}): () => void {
    let disposed = false;
    let pageHidden = false;
    let settled = false;
    let permanentFailure = false;
    let recovering = false;
    let failures = 0;
    let active: AbortController | null = null;
    let lastAttempt: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const available = () => !pageHidden && !document.hidden && navigator.onLine !== false;
    const clearTimer = () => {
        clearTimeout(timer);
        timer = undefined;
    };
    const pause = () => {
        clearTimer();
        const previous = active;
        active = null;
        previous?.abort();
        if (settled || permanentFailure || disposed) return;
        recovering = true;
        onStatus(
            "reconnecting",
            navigator.onLine === false
                ? "Offline. Analysis will reconnect when your connection returns."
                : "Analysis paused. It will resume when this page is visible.",
        );
    };
    const start = () => {
        if (disposed || settled || permanentFailure || active || timer !== undefined) return;
        if (!available()) {
            pause();
            return;
        }
        const controller = new AbortController();
        active = controller;
        lastAttempt = controller;
        const owns = () => !disposed && active === controller && !controller.signal.aborted;
        onStatus(
            recovering ? "reconnecting" : "running",
            recovering ? "Reconnecting to the PC engine…" : null,
        );
        void Promise.resolve()
            .then(() => {
                controller.signal.throwIfAborted();
                return analyze(controller.signal, (result) => {
                    if (!owns()) return;
                    recovering = false;
                    onUpdate(result);
                    onStatus("running", null);
                });
            })
            .then((result) => {
                if (!owns()) return;
                active = null;
                settled = true;
                onUpdate(result);
                onStatus("complete", null);
            })
            .catch((error: unknown) => {
                if (!owns()) return;
                active = null;
                if (!(error instanceof PcEngineConnectionError)) {
                    permanentFailure = true;
                    onStatus("error", error instanceof Error ? error.message : "PC engine failed.");
                    return;
                }
                recovering = true;
                if (!available()) {
                    pause();
                    return;
                }
                // A noisy stream must not reset the backoff after each single PV.
                const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
                onStatus(
                    "reconnecting",
                    `Connection interrupted. Retrying in ${delay / 1000} ${delay === 1000 ? "second" : "seconds"}.`,
                );
                timer = setTimeout(() => {
                    timer = undefined;
                    start();
                }, delay);
            });
    };
    const resume = () => {
        if (!available()) return pause();
        // Resume immediately after a real lifecycle interruption, while repeated
        // focus/pageshow events cannot bypass a connection failure's backoff.
        start();
    };
    const pagehide = () => {
        pageHidden = true;
        const owned = active !== null;
        pause();
        if (owned) release();
    };
    const pageshow = () => {
        pageHidden = false;
        resume();
    };
    const visibility = () => (available() ? resume() : pause());
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("online", resume);
    window.addEventListener("offline", pause);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", visibility);
    start();
    return () => {
        disposed = true;
        clearTimer();
        const previous = active;
        active = null;
        previous?.abort();
        lastAttempt?.abort();
        window.removeEventListener("pagehide", pagehide);
        window.removeEventListener("pageshow", pageshow);
        window.removeEventListener("online", resume);
        window.removeEventListener("offline", pause);
        window.removeEventListener("focus", resume);
        document.removeEventListener("visibilitychange", visibility);
    };
}
