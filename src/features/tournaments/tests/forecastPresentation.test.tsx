import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { precedingResultContext, forecastHeading } from "../forecastPresentation";
import { TournamentTrackerView } from "../TournamentTrackerView";
import { trackerFixture } from "./trackerFixture";

describe("round context in the tracker", () => {
  test("counts reported games without counting byes or claiming a complete source list", () => {
    const { record, forecast } = trackerFixture();
    const base = record.snapshot.pairings[0];
    record.snapshot.pairings = [
      { ...base, round: 4 },
      { ...base, round: 4, board: 2, whiteStartNumber: 4, blackStartNumber: 5, decided: false, result: null },
      { ...base, round: 4, board: null, whiteStartNumber: 6, blackStartNumber: null },
      { ...base, round: 3 },
      { ...base, round: 5 },
    ];
    record.snapshot.incompletePairingRounds = [4];
    expect(precedingResultContext(record.snapshot, forecast)).toEqual({ round: 4, reported: 1, total: 2, incomplete: true, label: "Round 4: 1 of 2 listed games have results · list incomplete" });
    expect(precedingResultContext(record.snapshot, { ...forecast, kind: "confirmed" })).toBeNull();
    expect(precedingResultContext(record.snapshot, { ...forecast, round: 1 })).toBeNull();
  });

  test("missing result rows remain unavailable rather than zero-percent coverage", () => {
    const { record, forecast } = trackerFixture();
    expect(precedingResultContext(record.snapshot, forecast)?.label).toBe("Round 4 results not available");
  });

  test("names the target round and does not display a preparation default as a colour prediction", () => {
    const fixture = trackerFixture();
    fixture.forecast.candidates = [{ ...fixture.forecast.candidates[0], color: null }];
    const markup = renderToStaticMarkup(<TournamentTrackerView {...fixture} calculating={false} running={false} prepBusy={null} removeBusy={false} settingBusy={false} syncEvent={null} error={null} projectedSideFor={() => "black"} onOpponent={vi.fn()} onOpenDatabase={vi.fn()} onToggleUpdate={vi.fn()} onCheck={vi.fn()} onStop={vi.fn()} onRemove={vi.fn()} />);
    expect(markup).toContain("Round 5 · Predicted opponents");
    expect(markup).toContain("Expected colour");
    expect(markup).toContain("Not known");
    expect(markup).not.toContain(">Black<");
    expect(forecastHeading({ ...fixture.forecast, kind: "confirmed" }, false)).toBe("Round 5 · Published pairing");
    expect(forecastHeading({ ...fixture.forecast, kind: "inferred" }, false)).toBe("Round 5 · Expected pairing");
  });
});


describe("strict source result presentation", () => {
  test("unreadable true flags do not count as results; completion heading retains live final-round meaning", () => {
    const { record, forecast } = trackerFixture();
    const base = record.snapshot.pairings[0];
    record.snapshot.pairings = [
      { ...base, round: 4, result: "1-0", decided: true },
      { ...base, round: 4, board: 2, result: "garbage.5", decided: true },
      { ...base, round: 4, board: 3, result: "1-0", decided: false },
    ];
    expect(precedingResultContext(record.snapshot, forecast)?.reported).toBe(1);
    expect(forecastHeading({ ...forecast, kind: "complete", summary: "Round 7 is the final round" }, false)).toBe("Round 7 is the final round");
    expect(forecastHeading({ ...forecast, kind: "complete", summary: "Tournament complete" }, false)).toBe("Tournament complete");
  });
});
