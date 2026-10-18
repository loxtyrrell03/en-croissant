import type { WebColor, WebCompanionState } from "./model";
import { getWebServerUrl } from "./serverUrl";

export type PhonePrepRequest = { id: string; jobId: string; userColor: WebColor };
export function phoneBoardHasUnfiledAnalysis(state: WebCompanionState) {
    return !state.activePrepId && state.board.line.length > 0;
}
export function readPhonePrepRequest(value: unknown): PhonePrepRequest | null {
    if (!value || typeof value !== "object") return null;
    const request = value as Partial<PhonePrepRequest>;
    return typeof request.id === "string" &&
        /^[a-z0-9_-]{1,100}$/i.test(request.id) &&
        typeof request.jobId === "string" &&
        /^otb-[a-z0-9-]{1,90}$/i.test(request.jobId) &&
        (request.userColor === "white" || request.userColor === "black")
        ? (request as PhonePrepRequest)
        : null;
}

async function loadPhonePrepRequest(signal: AbortSignal) {
    const response = await fetch(getWebServerUrl("api/web-state"), { cache: "no-store", signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("The PC prep handoff is unavailable.");
    const body = await response.json();
    return readPhonePrepRequest(body?.state?.requestedOtbPrep);
}

/** Poll only the small server handoff, never replace this device's workspace.
 * The applied ID belongs in the same durable transaction as the imported prep. */
export function watchPhonePrepRequests({
    apply,
    appliedId,
    onError,
    load = loadPhonePrepRequest,
}: {
    apply: (request: PhonePrepRequest, signal: AbortSignal) => Promise<void>;
    appliedId: () => string | undefined;
    onError: (error: unknown) => void;
    load?: (signal: AbortSignal) => Promise<PhonePrepRequest | null>;
}) {
    let disposed = false;
    let inFlight: AbortController | null = null;
    let reportedErrorId: string | undefined;
    const check = async () => {
        if (disposed || inFlight || document.visibilityState === "hidden") return;
        const controller = new AbortController();
        inFlight = controller;
        const deadline = setTimeout(() => controller.abort(), 30_000);
        let request: PhonePrepRequest | null = null;
        try {
            request = await load(controller.signal);
            if (!request || disposed || controller.signal.aborted || appliedId() === request.id)
                return;
            await apply(request, controller.signal);
            reportedErrorId = undefined;
        } catch (error) {
            if (
                !disposed &&
                !controller.signal.aborted &&
                request &&
                reportedErrorId !== request.id
            ) {
                reportedErrorId = request.id;
                onError(error);
            }
        } finally {
            clearTimeout(deadline);
            if (inFlight === controller) inFlight = null;
        }
    };
    const resume = () => {
        void check();
    };
    const timer = setInterval(resume, 30_000);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
        disposed = true;
        clearInterval(timer);
        inFlight?.abort();
        window.removeEventListener("pageshow", resume);
        window.removeEventListener("focus", resume);
        document.removeEventListener("visibilitychange", resume);
    };
}
