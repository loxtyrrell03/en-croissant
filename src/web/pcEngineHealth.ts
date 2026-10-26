import { resolvePrivateServiceUrl } from "./serverUrl";

export const PHONE_PC_ENGINE_URL = resolvePrivateServiceUrl(
    import.meta.env.VITE_EN_CROISSANT_STOCKFISH_URL ?? "https://lox-pc.tail89d19b.ts.net",
)
    .trim()
    .replace(/\/+$/, "");
export class PcEngineCapabilityError extends Error {}

/** Read-only and bounded even when a transport ignores abort. Capability
 * consumers validate their own protocol; a read never starts a service. */
export async function loadPcEngineHealth(
    signal?: AbortSignal,
    base = PHONE_PC_ENGINE_URL,
): Promise<unknown> {
    signal?.throwIfAborted();
    if (!base) throw new PcEngineCapabilityError("PC controls require the PC engine service.");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
        rejectAbort: ((error: unknown) => void) | undefined;
    const abort = () => {
        controller.abort();
        rejectAbort?.(new DOMException("PC check cancelled", "AbortError"));
    };
    const interrupted = new Promise<never>((_, reject) => {
        rejectAbort = reject;
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => {
            controller.abort();
            reject(new PcEngineCapabilityError("The PC check timed out. Retry the check."));
        }, 5000);
    });
    try {
        return await Promise.race([
            interrupted,
            (async () => {
                const response = await fetch(`${base}/v1/health`, {
                    signal: controller.signal,
                    cache: "no-store",
                });
                if (!response.ok)
                    throw new PcEngineCapabilityError(
                        "PC details are unavailable. Check the PC connection and retry.",
                    );
                const result: unknown = await response.json();
                controller.signal.throwIfAborted();
                return result;
            })(),
        ]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        controller.abort();
    }
}
