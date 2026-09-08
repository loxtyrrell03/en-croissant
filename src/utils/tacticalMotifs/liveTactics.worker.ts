import { buildLiveTacticalScan, type LiveTacticalScanInput } from "./liveTactics";
import type { TacticalWorkerReply } from "./liveTacticsWorker";

self.onmessage = (event: MessageEvent<LiveTacticalScanInput>) => {
    let reply: TacticalWorkerReply;
    try {
        reply = { ok: true, scan: buildLiveTacticalScan(event.data) };
    } catch (error) {
        reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    self.postMessage(reply);
};
