/** A transport interruption can be retried with the same immutable request.
 * Protocol/capability and engine errors deliberately do not use this type. */
export class PcEngineConnectionError extends Error {}

export function pcEngineHttpError(status: number, operation: string): Error {
    const message = `${operation} returned HTTP ${status}.`;
    return [408, 429, 500, 502, 503, 504].includes(status)
        ? new PcEngineConnectionError(message)
        : new Error(message);
}

/** Fetch and response-body network failures are TypeErrors in browsers. Call
 * only around transport operations, never around parsing or receipt checks. */
export function pcEngineTransportError(error: unknown): unknown {
    return error instanceof TypeError
        ? new PcEngineConnectionError("The connection to the PC engine was interrupted.")
        : error;
}

export async function fetchPcEngine(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Response> {
    try {
        return await fetch(input, init);
    } catch (error) {
        throw pcEngineTransportError(error);
    }
}
