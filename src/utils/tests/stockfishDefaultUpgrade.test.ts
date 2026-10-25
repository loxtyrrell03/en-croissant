import { expect, it } from "vitest";
import type { Engine, LocalEngine } from "../engines";
import { planStockfishDefaultUpgrade, stockfish19Profile } from "../stockfishDefaultUpgrade";
const available = stockfish19Profile({ path: "C:/Included/stockfish-19.exe", version: "19" });
const old: LocalEngine = {
    type: "local", id: "owner-18", name: "Stockfish owner label", version: "18",
    path: "C:/Owner/stockfish-18.exe", loaded: true, enabled: false,
    image: null, go: { t: "Time", c: 250 }, settings: [{ name: "Hash", value: 128 }],
};
it("registers an included release for a missing store and waits when it is absent", () => {
    expect(planStockfishDefaultUpgrade([], true, available).engines).toEqual([available]);
    expect(planStockfishDefaultUpgrade([], true, null)).toEqual({ engines: [], complete: false });
});
it("does not inherit another freshly discovered engine's UCI options or limits", () => {
    const lc0: LocalEngine = { ...old, name: "LCZero", path: "C:/LC0/lc0.exe", version: "0.32.1", go: { t: "Depth", c: 14 }, settings: [{ name: "WeightsFile", value: "C:/LC0/network.pb.gz" }] };
    const result = planStockfishDefaultUpgrade([lc0], true, available);
    expect(result.engines[0]).toEqual(available);
    expect(result.engines[1]).toBe(lc0);
});
it.each(([
    [],
    [{ ...old, name: "Komodo", path: "C:/Owner/komodo.exe" }],
    [{ ...old, name: "Fairy Stockfish", path: "C:/Owner/fairy-stockfish.exe" }],
    [{ ...old, version: "20" }],
    [{ ...old, version: "19.1.2" }],
    [{ ...old, version: "dev" }],
    [{ ...old, version: "19" }],
    [{ type: "lichess", id: "cloud", name: "Owner cloud", url: "local://evals" }],
] as Engine[][]).map((engines) => ({ engines })))("keeps explicit empty/alternative/current/newer/unknown choices", ({ engines }) => {
    const result = planStockfishDefaultUpgrade(engines, false, available);
    expect(result.engines).toBe(engines);
    expect(result.complete).toBe(true);
});
it("updates fallback order, retains the old profile and carries tuning without starting analysis", () => {
    const result = planStockfishDefaultUpgrade([old], false, available);
    expect(result.complete).toBe(true);
    expect(result.engines[0]).toMatchObject({ version: "19", loaded: true, enabled: false, image: null, go: old.go });
    expect(result.engines[0].settings).toContainEqual({ name: "Hash", value: 128 });
    expect(result.engines[1]).toEqual({ ...old, loaded: false });
    expect(old.loaded).toBe(true);
});
it("keeps a hidden older default hidden in its new release", () => {
    expect(planStockfishDefaultUpgrade([{ ...old, loaded: false }], false, available).engines[0].loaded).toBe(false);
});
it.each([
    [{ name: "EvalFileSmall", value: "owner-small.nnue" }],
    [{ name: "EvalFile", value: "nn-stockfish-18.nnue" }],
    [{ name: "ForkOnlyOption", value: true }],
    [{ name: "Threads", value: 0 }],
    [{ name: "Hash", value: "not a number" }],
    [{ name: "Ponder", value: "yes" }],
    [{ name: "SyzygyPath", value: "relative/tables" }],
    [{ name: "Debug Log File", value: "relative.log" }],
].map((settings) => ({ settings })))("keeps an incompatible/custom network or UCI setup as its owner's default", ({ settings }) => {
    const engines = [{ ...old, settings }];
    const result = planStockfishDefaultUpgrade(engines, false, available);
    expect(result.engines).toBe(engines);
    expect(result.complete).toBe(true);
});
it("retains supported tuning, tablebases, null omissions and the current embedded network", () => {
    const settings = [
        { name: "Threads", value: "2" }, { name: "UCI_LimitStrength", value: true },
        { name: "UCI_Elo", value: 1800 }, { name: "SyzygyPath", value: "C:/Tables;D:/Tables" },
        { name: "EvalFile", value: "nn-1a298aa575a0.nnue" }, { name: "EvalFileSmall", value: null },
    ];
    const result = planStockfishDefaultUpgrade([{ ...old, settings }], false, available);
    expect(result.engines[0]).toMatchObject({ version: "19" });
    expect(result.engines[0].settings).toEqual(expect.arrayContaining(settings));
});
it("uses an already registered verified-path profile without changing its custom settings or visibility", () => {
    const current = { ...available, id: "custom-19", name: "My current engine", loaded: false, settings: [{ name: "Threads", value: 1 }] };
    const result = planStockfishDefaultUpgrade([old, current], false, available);
    expect(result.engines).toEqual([current, old]);
    expect(result.engines[0]).toBe(current);
});
it("does not automatically select an already registered target with a custom network", () => {
    const custom = { ...available, settings: [{ name: "EvalFile", value: "C:/Owner/custom-network.nnue" }] };
    const engines = [old, custom];
    expect(planStockfishDefaultUpgrade(engines, false, available)).toEqual({ engines, complete: true });
});
it("does not repoint a reused managed ID or downgrade metadata at the verified path", () => {
    const custom = { ...old, id: available.id, path: "C:/Other/stockfish-custom.exe" };
    const result = planStockfishDefaultUpgrade([custom], false, available, () => "unique-19");
    expect(result.engines[0].id).toBe("unique-19");
    expect(result.engines[1]).toMatchObject({ id: available.id, path: custom.path, version: "18" });
    expect(planStockfishDefaultUpgrade([old, { ...available, version: "20" }], false, available).complete).toBe(false);
});
it("retains the previous default while the verified release is unavailable", () => {
    const engines = [old];
    expect(planStockfishDefaultUpgrade(engines, false, null)).toEqual({ engines, complete: false });
    expect(() => stockfish19Profile({ path: available.path, version: "18" })).toThrow(/version 19/);
});
