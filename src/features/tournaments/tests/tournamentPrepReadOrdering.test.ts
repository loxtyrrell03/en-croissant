import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { settingsGet, settingsSet } = vi.hoisted(() => ({
  settingsGet: vi.fn<() => Promise<string | null>>(),
  settingsSet: vi.fn<() => Promise<void>>(),
}));
vi.mock("@/features/tournaments/platform", () => ({ desktopApi: { settingsGet, settingsSet }, isDesktop: () => true }));
import { loadLocalTournamentPreps, loadTournamentPreps, saveTournamentPreps } from "../tournamentPrepStore";
import { trackerFixture } from "./trackerFixture";

function records(title: string) {
  const { record } = trackerFixture();
  return { [record.id]: { ...record, title } };
}
function deferred() {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>(done => { resolve = done; });
  return { promise, resolve };
}
describe("tournament fallback read ordering", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    let value: string | null = JSON.stringify(records("Cached"));
    vi.stubGlobal("localStorage", { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } });
    vi.stubGlobal("dispatchEvent", vi.fn());
    settingsSet.mockResolvedValue();
  });
  afterEach(() => vi.unstubAllGlobals());
  test("an older response retains its read result without replacing the newer fallback", async () => {
    const old = deferred(), latest = deferred();
    settingsGet.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const readingOld = loadTournamentPreps(), readingLatest = loadTournamentPreps();
    latest.resolve(JSON.stringify(records("Latest")));
    await readingLatest;
    old.resolve(JSON.stringify(records("Old")));
    expect((await readingOld)["42"].title).toBe("Old");
    expect(loadLocalTournamentPreps()["42"].title).toBe("Latest");
    settingsGet.mockRejectedValueOnce(new Error("Disk unavailable"));
    expect((await loadTournamentPreps())["42"].title).toBe("Latest");
  });
  test("a successful save invalidates pending fallback writes from reads", async () => {
    const old = deferred();
    settingsGet.mockReturnValueOnce(old.promise);
    const reading = loadTournamentPreps();
    await saveTournamentPreps(records("Saved"));
    old.resolve(JSON.stringify(records("Old")));
    await reading;
    expect(loadLocalTournamentPreps()["42"].title).toBe("Saved");
  });
  test("a failed save retains the fallback and allows a current native read to refresh it", async () => {
    const current = deferred();
    settingsGet.mockReturnValueOnce(current.promise);
    const reading = loadTournamentPreps();
    settingsSet.mockRejectedValueOnce(new Error("Disk full"));
    await expect(saveTournamentPreps(records("Unsaved"))).rejects.toThrow("Disk full");
    expect(loadLocalTournamentPreps()["42"].title).toBe("Cached");
    current.resolve(JSON.stringify(records("Current native value")));
    await reading;
    expect(loadLocalTournamentPreps()["42"].title).toBe("Current native value");
  });
});
