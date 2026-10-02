import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TournamentTrackerView } from "../TournamentTrackerView";
import { TournamentPrepStrip } from "../TournamentPrepStrip";
import { calculatePairingForecast } from "../pairingForecast";
import { pairingEstimateHelp } from "../pairingScoreHelp";
import { trackerFixture } from "./trackerFixture";

const store = vi.hoisted(() => ({ records: {} as Record<string, unknown> }));
vi.mock("../tournamentPrepStore", async importOriginal => ({
  ...await importOriginal<object>(), loadLocalTournamentPreps: () => store.records,
}));
const callbacks = { onOpponent: vi.fn(), onOpenDatabase: vi.fn(), onToggleUpdate: vi.fn(), onCheck: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(), projectedSideFor: () => "white" as const };
beforeEach(() => { store.records = {}; });

describe("shared desktop and phone abstention presentation", () => {
  test.each(["opening", "incomplete"])("%s forecasts show Unknown in Tracker and Prep while retaining actions", state => {
    const { record } = trackerFixture();
    if (state === "opening") Object.assign(record.snapshot, { nextRound: 1, phase: "registration", publishedRound: 0, completedRound: 0, liveRound: null, pairings: [] });
    else record.snapshot.incompletePairingRounds = [2];
    const forecast = calculatePairingForecast(record.snapshot, record.userStartNumber!);
    store.records = { [record.id]: record };
    const tracker = renderToStaticMarkup(<TournamentTrackerView record={record} forecast={forecast} {...callbacks} calculating={false} running={false} prepBusy={null} removeBusy={false} settingBusy={false} syncEvent={null} error={null} />);
    expect(tracker).toContain(">Unknown<"); expect(tracker).not.toMatch(/~\d+%/); expect(tracker).not.toContain("Other outcomes");
    expect(tracker).toContain("Import &amp; prep"); expect(tracker).toContain("Expected colour");
    const strip = renderToStaticMarkup(<TournamentPrepStrip onOpen={vi.fn()} onNew={vi.fn()} />);
    expect(strip).toContain("Pairing chance unknown"); expect(strip).not.toMatch(/~\d+%/);
    expect(pairingEstimateHelp(record.snapshot, forecast)).toContain(state === "opening" ? "Before round one" : "earlier pairing rows are missing");
  });

  test("incomplete-history help only uses explicit prior flags and preserves authoritative statuses", () => {
    const { record } = trackerFixture(), snapshot = record.snapshot;
    snapshot.incompletePairingRounds = [4];
    expect(pairingEstimateHelp(snapshot, { kind: "estimated", round: 5 })).toContain("pairing chances are unavailable");
    expect(pairingEstimateHelp(snapshot, { kind: "estimated", round: 4 })).toBeNull();
    for (const kind of ["confirmed", "scheduled", "inferred", "unavailable"] as const) expect(pairingEstimateHelp(snapshot, { kind, round: 5 })).toBeNull();
    expect(pairingEstimateHelp({ ...snapshot, incompletePairingRounds: [] }, { kind: "estimated", round: 5 })).toBeNull();
  });
});
