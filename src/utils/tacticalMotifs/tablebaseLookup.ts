import {
    tablebaseZugzwangRequests,
    validateTablebaseRecord,
    type TablebaseEvidence,
} from "./tablebaseEvidence";

const LOOKUP_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 128_000;

/** Called only by the explicit online-verification action, never by a normal
 * scan or the CPU worker. One bounded pair, no retry storm or private-game batch. */
export async function lookupZugzwangEvidence(
    fen: string,
    move: string,
    signal: AbortSignal,
): Promise<TablebaseEvidence> {
    const request = tablebaseZugzwangRequests(fen, move);
    if (!request) throw new Error("This move is not eligible for an exact zugzwang check.");
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(
        () => controller.abort(new Error("The online endgame check timed out.")),
        LOOKUP_TIMEOUT_MS,
    );
    try {
        const records = [];
        // Sequential probing respects the public service. Both records are
        // necessary; a failed or uncertain response never becomes a negative.
        for (const target of [request.actualFen, request.passedFen]) {
            controller.signal.throwIfAborted();
            const response = await fetch(
                `https://tablebase.lichess.org/standard?fen=${encodeURIComponent(target)}`,
                {
                    signal: controller.signal,
                    credentials: "omit",
                    referrerPolicy: "no-referrer",
                },
            );
            if (!response.ok)
                throw new Error(`Lichess endgame lookup failed (HTTP ${response.status}).`);
            if (!response.body) throw new Error("Lichess returned an empty endgame response.");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let bytes = 0,
                text = "";
            try {
                for (;;) {
                    controller.signal.throwIfAborted();
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    bytes += chunk.value.byteLength;
                    if (bytes > MAX_RESPONSE_BYTES)
                        throw new Error("The endgame response exceeded the safety limit.");
                    text += decoder.decode(chunk.value, { stream: true });
                }
                text += decoder.decode();
            } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
            controller.signal.throwIfAborted();
            const record = { fen: target, result: JSON.parse(text) as unknown };
            if (!validateTablebaseRecord(record, target))
                throw new Error("Lichess did not return a complete, certain endgame result.");
            records.push(record);
        }
        return { provider: "lichess-syzygy", records };
    } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        controller.abort();
    }
}
