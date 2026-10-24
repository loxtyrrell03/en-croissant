import workerUrl from "stockfish/bin/stockfish-18-lite-single.js?url";
import wasmUrl from "stockfish/bin/stockfish-18-lite-single.wasm?url";
import { runBoundedUciReport, type ReportSearchLimits } from "../../scripts/uci-report-search.mjs";
import { createReportEngineEvidence } from "./reportEngineEvidence";
import type { WebEngineLine } from "./model";

export type BoundedWebReportRequest = {
    fen: string;
    multipv: number;
    reportLimits: ReportSearchLimits;
    signal: AbortSignal;
    onUpdate?: (lines: WebEngineLine[]) => void;
};

export async function analyzeBoundedWebReport(remoteUrl: string, request: BoundedWebReportRequest) {
    const { fen, multipv, reportLimits, signal, onUpdate } = request;
    const evidence = createReportEngineEvidence(fen, reportLimits, multipv);
    let bestmove: string;
    if (remoteUrl) {
        // Fail before searching against an older service that would ignore the
        // combined limits. A report never retries or falls back to a cached score.
        const health = await fetch(`${remoteUrl}/v1/health`, { signal, cache: "no-store" });
        if (!health.ok || (await health.json()).reportProtocolVersion !== 1)
            throw new Error(
                "The PC engine needs its bounded-report update before this analysis can run.",
            );
        const response = await fetch(`${remoteUrl}/v1/analyze`, {
            method: "POST",
            signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                fen,
                multipv,
                depth: reportLimits.depth,
                reportLimits,
                engineKind: "stockfish",
                performancePreset: "good",
            }),
        });
        if (!response.ok || !response.body)
            throw new Error(`The report engine returned HTTP ${response.status}.`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "",
            acknowledged = false,
            completed: string | undefined;
        let engineName: string | undefined;
        const consume = (raw: string) => {
            if (!raw.trim()) return;
            const message = JSON.parse(raw);
            if (message.type === "error")
                throw new Error(message.message || "The report engine failed.");
            if (message.type === "meta") {
                acknowledged =
                    message.reportLimits?.depth === reportLimits.depth &&
                    message.reportLimits?.timeMs === reportLimits.timeMs;
                if (!acknowledged)
                    throw new Error("The engine did not acknowledge the selected report limits.");
                engineName = typeof message.engine === "string" ? message.engine : undefined;
            }
            if (message.type === "uci" && acknowledged && typeof message.line === "string")
                evidence.add(message.line, "gaming-pc", engineName);
            if (message.type === "done" && typeof message.bestmove === "string")
                completed = message.bestmove;
        };
        try {
            while (true) {
                signal.throwIfAborted();
                const { value, done } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() ?? "";
                for (const line of lines) consume(line);
                if (done) {
                    if (buffer.trim()) consume(buffer);
                    break;
                }
            }
        } finally {
            await reader.cancel().catch(() => {});
        }
        if (!acknowledged || !completed)
            throw new Error("The report search ended without a completed selected move.");
        bestmove = completed;
    } else {
        bestmove = await localReportSearch(request, (line) =>
            evidence.add(line, "phone", "Stockfish 18"),
        );
    }
    signal.throwIfAborted();
    const result = evidence.finish(bestmove);
    onUpdate?.(result);
    return result;
}

async function localReportSearch(request: BoundedWebReportRequest, onInfo: (line: string) => void) {
    const { fen, multipv, reportLimits, signal } = request;
    signal.throwIfAborted();
    // Report ownership includes the worker; late bestmove from an interactive
    // stop or another report cannot settle this request.
    const worker = new Worker(`${workerUrl}#${encodeURIComponent(wasmUrl)}`, {
        name: "stockfish-18-report",
    });
    let rejectPending: ((error: unknown) => void) | undefined;
    const abort = () =>
        rejectPending?.(new DOMException("Report analysis cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    const exchange = (
        command: string,
        finished: (line: string) => boolean,
        collect: (line: string) => void = () => {},
        timeoutMs = 20_000,
    ) =>
        new Promise<string>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout>;
            const cleanup = () => {
                clearTimeout(timer);
                worker.removeEventListener("message", message);
                worker.removeEventListener("error", error);
                rejectPending = undefined;
            };
            const fail = (reason: unknown) => {
                cleanup();
                reject(reason);
            };
            const error = () => fail(new Error("The phone report engine failed."));
            const message = (event: MessageEvent) => {
                if (typeof event.data !== "string") return;
                const line = event.data.trim();
                collect(line);
                if (finished(line)) {
                    cleanup();
                    resolve(line);
                }
            };
            rejectPending = fail;
            worker.addEventListener("message", message);
            worker.addEventListener("error", error);
            timer = setTimeout(
                () => fail(new Error("The phone report engine did not finish in time.")),
                timeoutMs,
            );
            if (signal.aborted) abort();
            else worker.postMessage(command);
        });
    try {
        await exchange("uci", (line) => line === "uciok");
        worker.postMessage(`setoption name MultiPV value ${multipv}`);
        await exchange("isready", (line) => line === "readyok");
        worker.postMessage(`position fen ${fen}`);
        return await runBoundedUciReport({
            limits: reportLimits,
            multipv,
            signal,
            onInfo,
            runSearch: async (command, collect, _signal, timeoutMs) =>
                (
                    await exchange(
                        command,
                        (line) => line.startsWith("bestmove "),
                        collect,
                        timeoutMs,
                    )
                ).split(/\s+/)[1],
            setMultiPv: (value) => worker.postMessage(`setoption name MultiPV value ${value}`),
        });
    } finally {
        signal.removeEventListener("abort", abort);
        worker.terminate();
    }
}
