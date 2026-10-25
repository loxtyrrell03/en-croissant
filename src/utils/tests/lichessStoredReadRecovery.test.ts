import { beforeEach, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn(async () => {}) }));
vi.mock("@/bindings", async (original) => {
    const bindings = await original<typeof import("@/bindings")>();
    return { ...bindings, commands: { ...bindings.commands, lookupLocalLichessCloudEval: lookup } };
});
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const hit = { fen, depth: 30, knodes: 100, pvs: [{ moves: "e2e4 e7e5", cp: 24, mate: null }] };
beforeEach(() => {
    vi.resetModules();
    lookup.mockReset();
});

it("exposes unreadable downloaded data as a failure rather than a confirmed missing position", async () => {
    lookup.mockResolvedValue({ status: "error", error: "Invented temporarily unreadable shard" });
    const { queryLichessCloudMoves } = await import("../lichess/api");
    await expect(queryLichessCloudMoves(fen, 1)).rejects.toThrow("unreadable shard");
});

it("recovers at the same FEN after a failed read without a cached false miss", async () => {
    lookup
        .mockRejectedValueOnce(new Error("Invented disk read failure"))
        .mockResolvedValue({ status: "ok", data: hit });
    const { queryLichessCloudMoves } = await import("../lichess/api");
    await queryLichessCloudMoves(fen, 1).catch(() => null);
    expect(await queryLichessCloudMoves(fen, 1)).toMatchObject([{ uci: "e2e4", depth: 30 }]);
    expect(lookup).toHaveBeenCalledTimes(2);
});

it("retains a confirmed missing position without repeating the native read", async () => {
    lookup.mockResolvedValue({ status: "ok", data: null });
    const { queryLichessCloudMoves } = await import("../lichess/api");
    expect(await queryLichessCloudMoves(fen, 1)).toBeNull();
    expect(await queryLichessCloudMoves(fen, 1)).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
});

it("shares a pending first read across consumers without declaring it missing", async () => {
    const replies: ((value: unknown) => void)[] = [];
    lookup.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
    const { queryLichessCloudMoves } = await import("../lichess/api");
    const first = queryLichessCloudMoves(fen, 1);
    const second = queryLichessCloudMoves(fen, 1);
    for (const resolve of replies) resolve({ status: "ok", data: hit });
    expect(await Promise.all([first, second])).toMatchObject([
        [{ uci: "e2e4", depth: 30 }],
        [{ uci: "e2e4", depth: 30 }],
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
});
