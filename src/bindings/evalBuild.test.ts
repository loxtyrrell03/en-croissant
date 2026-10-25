import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
import { commands, type LocalEvalBuildRequest } from "./generated";

const request: LocalEvalBuildRequest = {
    id: "owned-build",
    source: "fixture.zst",
    sourceUrl: null,
    outputDir: "new-output",
    maxPvs: 5,
    shardCount: 16,
};
describe("native evaluation build transport", () => {
    beforeEach(() => {
        invoke.mockReset();
    });
    it("forwards legacy requests and an optional numeric GiB quota unchanged", async () => {
        const report = { positions: 1, duplicates: 2 };
        invoke.mockResolvedValue(report);
        expect(await commands.buildLocalLichessEvalDb(request)).toEqual({
            status: "ok",
            data: report,
        });
        expect(invoke).toHaveBeenLastCalledWith("build_local_lichess_eval_db", { request });
        const limited = { ...request, diskLimitGib: 32 };
        await commands.buildLocalLichessEvalDb(limited);
        expect(invoke).toHaveBeenLastCalledWith("build_local_lichess_eval_db", {
            request: limited,
        });
    });
    it("cancels the exact ID and retains a false already-finishing result", async () => {
        invoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        expect(await commands.cancelLocalLichessEvalDb("owned-build")).toBe(true);
        expect(invoke).toHaveBeenLastCalledWith("cancel_local_lichess_eval_db", {
            id: "owned-build",
        });
        expect(await commands.cancelLocalLichessEvalDb("finished-build")).toBe(false);
        expect(invoke).toHaveBeenLastCalledWith("cancel_local_lichess_eval_db", {
            id: "finished-build",
        });
    });
    it("returns a native failure without replaying the build", async () => {
        invoke.mockRejectedValue("Evaluation build reached its disk-space limit.");
        expect(await commands.buildLocalLichessEvalDb(request)).toEqual({
            status: "error",
            error: "Evaluation build reached its disk-space limit.",
        });
        expect(invoke).toHaveBeenCalledTimes(1);
    });
});
