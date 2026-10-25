import { beforeEach, expect, it, vi } from "vitest";
const lookup = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn() }));
vi.mock("@/bindings", async (original) => {
    const bindings = await original<typeof import("@/bindings")>();
    return { ...bindings, commands: { ...bindings.commands, lookupLocalLichessCloudEval: lookup } };
});
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const hit = (cp: number) => ({
    status: "ok",
    data: { fen, depth: 30, knodes: 100, pvs: [{ moves: "e2e4 e7e5", cp, mate: null }] },
});
beforeEach(() => {
    vi.resetModules();
    lookup.mockReset();
});
it("reads the same position again after the source changes instead of returning an old hit", async () => {
    const api = await import("../lichess/api"),
        source = await import("../evaluationSource");
    lookup.mockResolvedValueOnce(hit(24)).mockResolvedValueOnce(hit(42));
    expect((await api.queryLichessCloudMoves(fen, 1))?.[0].scoreCpForWhite).toBe(24);
    source.noteEvaluationSourceRevision("changed");
    expect((await api.queryLichessCloudMoves(fen, 1))?.[0].scoreCpForWhite).toBe(42);
    expect(lookup).toHaveBeenCalledTimes(2);
});
it("does not retain a missing-position result from the previous store", async () => {
    const api = await import("../lichess/api"),
        source = await import("../evaluationSource");
    lookup.mockResolvedValueOnce({ status: "ok", data: null }).mockResolvedValueOnce(hit(24));
    expect(await api.queryLichessCloudMoves(fen, 1)).toBeNull();
    source.noteEvaluationSourceRevision("changed");
    expect((await api.queryLichessCloudMoves(fen, 1))?.[0].scoreCpForWhite).toBe(24);
});
it("rejects a late old-store response without overwriting its successor", async () => {
    const api = await import("../lichess/api"),
        source = await import("../evaluationSource");
    let finish!: (value: unknown) => void;
    lookup
        .mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            }),
        )
        .mockResolvedValueOnce(hit(42));
    const old = api.queryLichessCloudMoves(fen, 1);
    const oldResult = old.catch((error) => error);
    source.noteEvaluationSourceRevision("changed");
    expect((await api.queryLichessCloudMoves(fen, 1))?.[0].scoreCpForWhite).toBe(42);
    finish(hit(24));
    expect(String(await oldResult)).toContain("source changed");
    expect((await api.queryLichessCloudMoves(fen, 1))?.[0].scoreCpForWhite).toBe(42);
    expect(lookup).toHaveBeenCalledTimes(2);
});
