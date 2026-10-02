import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { completedForecastHeading } from "../completedForecastHeading";
import { calculatePairingForecast } from "../pairingForecast";
import { TournamentTrackerView } from "../TournamentTrackerView";
import { trackerFixture } from "./trackerFixture";

describe("completion status from forecast through the tracker", () => {
  function finalRound(reported: number, incomplete = false) {
    const { record } = trackerFixture();
    Object.assign(record.snapshot, {
      totalRounds: 7, completedRound: 6, publishedRound: 7, liveRound: 7,
      nextRound: null, phase: "round-in-progress", incompletePairingRounds: incomplete ? [7] : [],
      pairings: [
        { round: 7, board: 1, whiteStartNumber: 1, blackStartNumber: 2, whitePoints: 0, blackPoints: 0, result: reported > 0 ? "1-0" : null, decided: reported > 0 },
        { round: 7, board: 2, whiteStartNumber: 3, blackStartNumber: 4, whitePoints: 0, blackPoints: 0, result: reported > 1 ? "0-1" : null, decided: reported > 1 },
      ],
    });
    return record;
  }
  function render(record: ReturnType<typeof finalRound>) {
    const forecast = calculatePairingForecast(record.snapshot, record.userStartNumber!);
    const markup = renderToStaticMarkup(<TournamentTrackerView record={record} forecast={forecast} calculating={false} running={false} prepBusy={null} removeBusy={false} settingBusy={false} syncEvent={null} error={null} projectedSideFor={() => "white"} onOpponent={vi.fn()} onOpenDatabase={vi.fn()} onToggleUpdate={vi.fn()} onCheck={vi.fn()} onStop={vi.fn()} onRemove={vi.fn()} />);
    return { forecast, markup };
  }

  test.each([
    [0, false], [1, false], [1, true], [2, false],
  ])("keeps the final round live with %i reported results and incomplete list %s", (reported, incomplete) => {
    const { forecast, markup } = render(finalRound(reported, incomplete));
    expect(forecast.kind).toBe("complete");
    expect(completedForecastHeading(forecast)).toBe("Round 7 is the final round");
    expect(markup).toContain(">Round 7 is the final round<");
    expect(markup).not.toContain("Tournament complete");
  });

  test("announces completion only once the snapshot reports the event complete", () => {
    const record = finalRound(2);
    Object.assign(record.snapshot, { phase: "complete", completedRound: 7, liveRound: null });
    const { forecast, markup } = render(record);
    expect(completedForecastHeading(forecast)).toBe("Tournament complete");
    expect(markup).toContain(">Tournament complete<");
    expect(markup).not.toContain("is the final round");
  });

  test("no target round alone does not establish event completion", () => {
    const record = finalRound(2);
    Object.assign(record.snapshot, { phase: "between-rounds", liveRound: null });
    const { forecast, markup } = render(record);
    expect(completedForecastHeading(forecast)).toBe("No next round remains");
    expect(markup).toContain(">No next round remains<");
    expect(markup).not.toContain("Tournament complete");
  });

  test("prior-round forecasts remain estimates and missing roster entries remain unavailable", () => {
    const record = finalRound(1);
    Object.assign(record.snapshot, { completedRound: 5, publishedRound: 6, liveRound: 6, nextRound: 7 });
    record.snapshot.pairings = record.snapshot.pairings.map(pairing => ({ ...pairing, round: 6 }));
    const { forecast, markup } = render(record);
    expect(forecast).toMatchObject({ kind: "estimated", round: 7 });
    expect(markup).toContain("Pairing chance");
    expect(markup).not.toContain("Tournament complete");
    expect(calculatePairingForecast({ ...record.snapshot, players: [] }, 1).kind).toBe("unavailable");
  });

  test("an empty completion summary makes no claim that play has finished", () => {
    expect(completedForecastHeading({ summary: "  " })).toBe("No next pairing to predict");
  });
});
