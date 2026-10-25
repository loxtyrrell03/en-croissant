import { afterEach, expect, it, vi } from "vitest";
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
class LocalWorker extends EventTarget {
    static workers: LocalWorker[] = [];
    static failAt: "uci" | "go" | "error" | null = null;
    terminated = false;
    constructor(public url: string) {
        super();
        LocalWorker.workers.push(this);
    }
    postMessage(command: string) {
        queueMicrotask(() => {
            if (this.terminated) return;
            if (command === "uci" && LocalWorker.failAt === "error") {
                this.dispatchEvent(new Event("error"));
                return;
            }
            const lines = command === "uci"
                ? LocalWorker.failAt === "uci" ? ["info string CRITICAL ERROR: Fixture handshake"] : ["id name Stockfish 19 Lite fixture", "uciok"]
                : command === "isready" ? ["readyok"]
                : command.startsWith("go ") ? LocalWorker.failAt === "go" ? ["info string CRITICAL ERROR: Fixture position"] : ["info depth 8 score cp 12 pv e2e4 e7e5", "bestmove e2e4"] : [];
            for (const data of lines) this.dispatchEvent(new MessageEvent("message", { data }));
        });
    }
    terminate() { this.terminated = true; }
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); LocalWorker.failAt = null; });
it.each(["uci", "go", "error"] as const)("rejects a local %s failure and starts a fresh worker on retry", async (failure) => {
    vi.resetModules();
    vi.stubEnv("VITE_EN_CROISSANT_STOCKFISH_URL", "");
    vi.stubGlobal("Worker", LocalWorker);
    const { analyzeWithWebStockfish18 } = await import("../stockfishEngine");
    LocalWorker.failAt = failure;
    const update = vi.fn();
    const request = { fen, multipv: 1, depth: 8, onUpdate: update };
    await expect(analyzeWithWebStockfish18(request)).rejects.toThrow(/phone engine stopped/);
    const failed = LocalWorker.workers.at(-1)!;
    expect(failed.terminated).toBe(true);
    expect(update).not.toHaveBeenCalled();
    LocalWorker.failAt = null;
    const result = await analyzeWithWebStockfish18(request);
    expect(result[0]).toMatchObject({ engineName: "Stockfish 19 Lite fixture", depth: 8 });
    expect(LocalWorker.workers.at(-1)).not.toBe(failed);
    expect(LocalWorker.workers.at(-1)!.url).toContain("stockfish-19-lite-single.js");
});
