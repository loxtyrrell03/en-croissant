import type { LiveTacticalScan, LiveTacticalScanInput } from "./liveTactics";

export type TacticalWorkerReply =
    | { ok: true; scan: LiveTacticalScan }
    | { ok: false; error: string };

export const TACTICAL_CLASSIFICATION_TIMEOUT_MS = 3_000;

/** Own one worker per scan: cancellation must stop CPU work, not merely hide
 * its result. Never fall back to the UI thread if workers are unavailable. */
export function classifyLiveTacticsInWorker(
    input: LiveTacticalScanInput,
    signal: AbortSignal,
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
        const timer = setTimeout(
            () =>
                finish({
                    ok: false,
                    error: "Tactical verification exceeded 3 seconds. No result was accepted; try scanning again.",
                }),
            TACTICAL_CLASSIFICATION_TIMEOUT_MS,
        );
        signal.addEventListener("abort", abort, { once: true });
        worker.onmessage = (event: MessageEvent<TacticalWorkerReply>) => finish(event.data);
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
