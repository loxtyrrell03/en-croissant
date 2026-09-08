import type { LiveTacticalScan, LiveTacticalScanInput } from "./liveTactics";

export type TacticalWorkerReply =
    | { ok: true; scan: LiveTacticalScan }
    | { ok: false; error: string };

export type TacticalWorkerMessage = TacticalWorkerReply | { type: "started" };

export const TACTICAL_CLASSIFICATION_TIMEOUT_MS = 3_000;
export const TACTICAL_WORKER_STARTUP_TIMEOUT_MS = 20_000;

/** Own one worker per scan: cancellation must stop CPU work, not merely hide
 * its result. Never fall back to the UI thread if workers are unavailable. */
export function classifyLiveTacticsInWorker(
    input: LiveTacticalScanInput,
    signal: AbortSignal,
    onStarted?: () => void,
): Promise<LiveTacticalScan> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException("Tactical scan cancelled", "AbortError"));
            return;
        }
        let worker: Worker;
        try {
            worker = new Worker(new URL("./liveTactics.worker.ts", import.meta.url), {
                type: "module",
            });
        } catch (error) {
            reject(error);
            return;
        }
        let settled = false;
        let started = false;
        const finish = (reply: TacticalWorkerReply) => {
            if (settled) return;
            cleanup();
            if (reply.ok) resolve(reply.scan);
            else reject(new Error(reply.error));
        };
        const cleanup = () => {
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        };
        const abort = () => {
            if (settled) return;
            cleanup();
            reject(new DOMException("Tactical scan cancelled", "AbortError"));
        };
        let timer = setTimeout(
            () =>
                finish({
                    ok: false,
                    error: "The tactical verifier did not start within 20 seconds. No result was accepted; try scanning again.",
                }),
            TACTICAL_WORKER_STARTUP_TIMEOUT_MS,
        );
        signal.addEventListener("abort", abort, { once: true });
        worker.onmessage = (event: MessageEvent<TacticalWorkerMessage>) => {
            if (settled) return;
            if (!event.data || typeof event.data !== "object") {
                finish({ ok: false, error: "The tactical verification result could not be read." });
                return;
            }
            if ("type" in event.data && event.data.type === "started") {
                if (started) return;
                started = true;
                clearTimeout(timer);
                timer = setTimeout(
                    () =>
                        finish({
                            ok: false,
                            error: "Tactical verification exceeded 3 seconds. No result was accepted; try scanning again.",
                        }),
                    TACTICAL_CLASSIFICATION_TIMEOUT_MS,
                );
                onStarted?.();
                return;
            }
            if ("ok" in event.data) {
                if (event.data.ok && !started) {
                    finish({
                        ok: false,
                        error: "The tactical verifier returned a result before starting verification.",
                    });
                } else finish(event.data);
            } else
                finish({ ok: false, error: "The tactical verification result could not be read." });
        };
        worker.onerror = (event) =>
            finish({
                ok: false,
                error: event.message
                    ? `The tactical verification worker failed: ${event.message}`
                    : "The tactical verification worker failed. Try scanning again.",
            });
        worker.onmessageerror = () =>
            finish({ ok: false, error: "The tactical verification result could not be read." });
        try {
            worker.postMessage(input);
        } catch (error) {
            finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
}
