import type {
    ChessDecisionReport,
    DecisionAssessmentInput,
} from "@/utils/tacticalMotifs/decisionAssessment";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";

export type DecisionReportRequest = {
    input: DecisionAssessmentInput;
    engineName: string;
    history?: TacticalGameHistory;
};
export type DecisionReportMessage =
    | { type: "started" }
    | { type: "result"; report: ChessDecisionReport | null }
    | { type: "error"; message: string };

export function classifyDecisionInWorker(request: DecisionReportRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    return new Promise<ChessDecisionReport>((resolve, reject) => {
        const worker = new Worker(new URL("./decisionReport.worker.ts", import.meta.url), {
            type: "module",
        });
        const dispose = () => {
            clearTimeout(timeout);
            worker.terminate();
            signal.removeEventListener("abort", abort);
        };
        const fail = (error: unknown) => {
            dispose();
            reject(error);
        };
        const abort = () =>
            fail(signal.reason ?? new DOMException("Analysis cancelled", "AbortError"));
        const expire = () =>
            fail(new Error("The decision check timed out. Try again from this position."));
        let timeout = setTimeout(expire, 20_000);
        signal.addEventListener("abort", abort, { once: true });
        worker.onmessage = ({ data }: MessageEvent<DecisionReportMessage>) => {
            if (data.type === "started") {
                clearTimeout(timeout);
                timeout = setTimeout(expire, 4_000);
            } else if (data.type === "result" && data.report?.fen === request.input.fen) {
                dispose();
                resolve(data.report);
            } else
                fail(
                    new Error(
                        data.type === "error"
                            ? data.message
                            : "The decision check could not verify the search results.",
                    ),
                );
        };
        worker.onerror = () => fail(new Error("The decision verifier could not start."));
        worker.onmessageerror = () =>
            fail(new Error("The decision verifier returned an unreadable result."));
        try {
            worker.postMessage(request);
        } catch (error) {
            fail(error);
        }
    });
}
