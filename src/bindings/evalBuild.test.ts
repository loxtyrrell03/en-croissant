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
    it("separates source checking from activation and carries its exact revision/token", async () => {
        invoke
            .mockResolvedValueOnce({ path: "current", revision: "before" })
            .mockResolvedValueOnce({ token: "checked", store: { path: "new" } })
            .mockResolvedValueOnce({ path: "new", revision: "after" });
        await commands.getLocalEvalSourceSelection();
        await commands.validateLocalEvalSource("new", "before");
        await commands.activateLocalEvalSource("checked");
        expect(invoke.mock.calls).toEqual([
            ["get_local_eval_source_selection"],
            ["validate_local_eval_source", { path: "new", expectedRevision: "before" }],
            ["activate_local_eval_source", { token: "checked" }],
        ]);
    });
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
    it("restores a recorded job without starting or replaying work", async () => {
        const recovered = {
            id: "interrupted-build",
            state: "interrupted",
            active: false,
            canCancel: false,
        };
        invoke.mockResolvedValueOnce(recovered).mockResolvedValueOnce(null);
        expect(await commands.getLocalEvalBuildJob()).toEqual({ status: "ok", data: recovered });
        expect(await commands.getLocalEvalBuildJob()).toEqual({ status: "ok", data: null });
        expect(invoke.mock.calls).toEqual([
            ["get_local_eval_build_job"],
            ["get_local_eval_build_job"],
        ]);
    });
    it("removes the exact recorded ID and preserves cleanup refusal", async () => {
        invoke
            .mockResolvedValueOnce(null)
            .mockRejectedValueOnce("The output ownership marker changed. Files were kept.");
        expect(await commands.discardLocalEvalBuildJob("interrupted-build")).toEqual({
            status: "ok",
            data: null,
        });
        expect(await commands.discardLocalEvalBuildJob("changed-build")).toEqual({
            status: "error",
            error: "The output ownership marker changed. Files were kept.",
        });
        expect(invoke.mock.calls).toEqual([
            ["discard_local_eval_build_job", { id: "interrupted-build" }],
            ["discard_local_eval_build_job", { id: "changed-build" }],
        ]);
    });
    it("keeps status failures visible instead of treating them as no recorded job", async () => {
        invoke.mockRejectedValueOnce(
            "Recovery state uses an unsupported version. Its contents were kept.",
        );
        expect(await commands.getLocalEvalBuildJob()).toEqual({
            status: "error",
            error: "Recovery state uses an unsupported version. Its contents were kept.",
        });
        expect(invoke).toHaveBeenCalledTimes(1);
    });
    it("reviews the exact proposed folder and quota without starting a download", async () => {
        const review = { token: "review-token", outputDir: "new-folder", downloadBytes: 123 };
        invoke.mockResolvedValueOnce(review);
        expect(await commands.reviewLocalEvalDownload("new-folder", 64)).toEqual({
            status: "ok",
            data: review,
        });
        expect(invoke.mock.calls).toEqual([
            ["review_local_eval_download", { outputDir: "new-folder", diskLimitGib: 64 }],
        ]);
    });
    it("starts only the reviewed token and keeps the returned durable job ID", async () => {
        invoke.mockResolvedValueOnce("owned-job-id");
        expect(await commands.startLocalEvalDownload("review-token")).toEqual({
            status: "ok",
            data: "owned-job-id",
        });
        expect(invoke.mock.calls).toEqual([
            ["start_local_eval_download", { token: "review-token" }],
        ]);
    });
    it("preserves review expiry without replaying or falling back to an unreviewed build", async () => {
        invoke.mockRejectedValueOnce("This download review expired. Review it again.");
        expect(await commands.startLocalEvalDownload("expired-token")).toEqual({
            status: "error",
            error: "This download review expired. Review it again.",
        });
        expect(invoke).toHaveBeenCalledTimes(1);
    });
});
