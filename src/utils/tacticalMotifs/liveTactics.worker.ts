import { buildLiveTacticalScan, type LiveTacticalScanInput } from "./liveTactics";
import type { TacticalWorkerMessage, TacticalWorkerReply } from "./liveTacticsWorker";

self.onmessage = (event: MessageEvent<LiveTacticalScanInput>) => {
    // Dependency loading/transformation is startup, not proof computation.
    // Posting across the worker boundary lets the owner start the CPU deadline.
    self.postMessage({ type: "started" } satisfies TacticalWorkerMessage);
    let reply: TacticalWorkerReply;
    try {
        reply = { ok: true, scan: buildLiveTacticalScan(event.data) };
    } catch (error) {
        reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    self.postMessage(reply);
};
