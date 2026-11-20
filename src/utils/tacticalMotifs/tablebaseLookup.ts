import {
    decisionEndgameFen,
    decisionEndgameReplyFens,
    type DecisionEndgameTarget,
} from "./decisionEndgame";
import {
    tablebaseTacticalRequests,
    validateTablebaseRecord,
    type TablebaseEvidence,
    type TablebaseRecord,
} from "./tablebaseEvidence";

const LOOKUP_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 128_000;

async function withTablebaseLookup(
    signal: AbortSignal,
    run: (fetchRecord: (fen: string) => Promise<TablebaseRecord>) => Promise<TablebaseRecord[]>,
): Promise<TablebaseEvidence> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(
        () => controller.abort(new Error("The online endgame check timed out.")),
        LOOKUP_TIMEOUT_MS,
    );
    try {
        const records = await run(async (target) => {
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
            return record;
        });
        signal.throwIfAborted();
        return { provider: "lichess-syzygy", records };
    } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        controller.abort();
    }
}

/** Called by explicit verification. The original capture and zugzwang
 * checks still need all requested boards. */
export async function lookupTacticalEndgameEvidence(
    fen: string,
    move: string,
    signal: AbortSignal,
): Promise<TablebaseEvidence> {
    const request = tablebaseTacticalRequests(fen, move);
    if (!request) throw new Error("This move is not eligible for an exact endgame check.");
    return withTablebaseLookup(signal, async (fetchRecord) => {
        const records = [];
        for (const fen of request.targets) records.push(await fetchRecord(fen));
        return records;
    });
}

/** One exact position and up to two specific replies share one deadline.
 * A valid root remains useful when a follow-up is unavailable. */
export async function lookupDecisionEndgameEvidence(
    target: DecisionEndgameTarget,
    signal: AbortSignal,
): Promise<TablebaseEvidence> {
    const rootFen = decisionEndgameFen(target);
    if (!rootFen) throw new Error("This position is not eligible for an exact endgame check.");
    return withTablebaseLookup(signal, async (fetchRecord) => {
        const records = [await fetchRecord(rootFen)];
        const replies = decisionEndgameReplyFens(target, { provider: "lichess-syzygy", records });
        for (const fen of replies) {
            try {
                records.push(await fetchRecord(fen));
            } catch {
                signal.throwIfAborted();
                break;
            }
        }
        return records;
    });
}
