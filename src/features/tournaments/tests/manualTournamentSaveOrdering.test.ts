import { afterEach, describe, expect, test, vi } from "vitest";
const { settingsGet, settingsSet } = vi.hoisted(() => ({ settingsGet: vi.fn(), settingsSet: vi.fn() }));
vi.mock("@/features/tournaments/platform", () => ({ desktopApi: { settingsGet, settingsSet }, isDesktop: () => true }));
import { trackerFixture } from "./trackerFixture";
import { updateTournamentPrep } from "../tournamentPrepUpdates";
import { manualResultInput, setManualResult } from "../manualTournamentResults";
import { mergeTournamentRoster } from "../tournamentRoster";

afterEach(() => vi.unstubAllGlobals());
describe("manual edit and official refresh save ordering", () => {
  test.each(["manual-first", "official-first"])("official result wins %s across an in-flight write", async order => {
    vi.clearAllMocks();
    const { record } = trackerFixture();
    record.snapshot = { ...record.snapshot, pairings: record.snapshot.pairings.map(p => ({ ...p, result: null, decided: false })) };
    const input = manualResultInput(record.snapshot, record.snapshot.pairings[0], "1-0");
    const official = { ...record.snapshot, pairings: record.snapshot.pairings.map(p => ({ ...p, result: "0-1", decided: true })) };
    let stored = JSON.stringify({ [record.id]: record });
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    settingsGet.mockImplementation(async () => stored);
    settingsSet.mockImplementationOnce(async (_key, value) => { started(); await gate; stored = value; });
    settingsSet.mockImplementation(async (_key, value) => { stored = value; });
    vi.stubGlobal("localStorage", { setItem: vi.fn(), getItem: () => stored });
    vi.stubGlobal("dispatchEvent", vi.fn());
    const manual = () => updateTournamentPrep(record.id, current => ({ ...current,
      manualResults: setManualResult(current.snapshot, current.manualResults, input, "1-0") }));
    const refresh = () => updateTournamentPrep(record.id, current => mergeTournamentRoster(current, official).record);
    const first = order === "manual-first" ? manual() : refresh();
    await entered;
    const second = order === "manual-first" ? refresh() : manual();
    await Promise.resolve();
    expect(settingsGet).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]);
    const saved = JSON.parse(stored)[record.id];
    expect(saved.snapshot.pairings[0].result).toBe("0-1");
    expect(saved.manualResults).toEqual([]);
    expect(settingsGet).toHaveBeenCalledTimes(2);
  });
  test("a failed write leaves the queue usable and never recreates a removed tracker", async () => {
    vi.clearAllMocks();
    const { record } = trackerFixture();
    let stored = JSON.stringify({ [record.id]: record });
    settingsGet.mockImplementation(async () => stored);
    settingsSet.mockRejectedValueOnce(new Error("disk unavailable"));
    settingsSet.mockImplementation(async (_key, value) => { stored = value; });
    vi.stubGlobal("localStorage", { setItem: vi.fn(), getItem: () => stored });
    vi.stubGlobal("dispatchEvent", vi.fn());
    await expect(updateTournamentPrep(record.id, current => current)).rejects.toThrow("disk unavailable");
    await expect(updateTournamentPrep(record.id, current => ({ ...current, autoUpdate: true }))).resolves.toMatchObject({ autoUpdate: true });
    stored = "{}";
    await expect(updateTournamentPrep(record.id, () => record)).resolves.toBeNull();
    expect(stored).toBe("{}");
  });
});
