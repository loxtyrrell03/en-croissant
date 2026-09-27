import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { TournamentTrackerView, opponentReady, importErrorHelp } from "../TournamentTrackerView";
import { trackerFixture } from "./trackerFixture";
describe("tournament quick list", () => {
  test("explains common import failures without inventing causes for unknown errors", () => {
    expect(importErrorHelp("HTTP 429 Too Many Requests")).toContain("Wait a few minutes");
    expect(importErrorHelp("no space left on device")).toContain("free space");
    expect(importErrorHelp("Opponent database could not be created.")).toBe("Opponent database could not be created.");
  });
  const callbacks = { onOpponent: vi.fn(), onOpenDatabase: vi.fn(), onToggleUpdate: vi.fn(), onCheck: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(), projectedSideFor: () => "white" as const };
  test("keeps all six candidates with labelled probabilities and direct actions", () => {
    const fixture = trackerFixture();
    const markup = renderToStaticMarkup(<TournamentTrackerView {...fixture} {...callbacks} calculating={false} running={false} prepBusy={null} removeBusy={false} settingBusy={false} syncEvent={null} error={null} />);
    expect(markup).toContain("Taylor Reed");
    expect(markup).toContain("~3%");
    expect(markup).toContain("Other outcomes");
    expect(markup).toContain("Search again");
    expect(markup).toContain("Import &amp; prep");
    expect(markup).toContain("Open Prep");
    expect(markup).toMatch(/class="[^"]*openPrep[^"]*" data-database-ready="true"/);
    expect(markup).toContain('aria-label="Help: Pairing chance"');
    expect(markup).not.toContain('role="tooltip"');
  });
  test("published pairings do not display an estimated percentage", () => {
    const fixture = trackerFixture();
    fixture.forecast = { ...fixture.forecast, kind: "confirmed", candidates: [{ ...fixture.forecast.candidates[0], probability: 1 }], otherProbability: 0 };
    const markup = renderToStaticMarkup(<TournamentTrackerView {...fixture} {...callbacks} calculating={false} running={false} prepBusy={null} removeBusy={false} settingBusy={false} syncEvent={null} error={null} />);
    expect(markup).toContain("Published");
    expect(markup).not.toContain("~100%");
    expect(markup).not.toContain("Pairing chance");
  });
  test("only a nonempty saved database is ready for Prep", () => {
    const { record } = trackerFixture();
    expect(opponentReady(record.opponents["2"])).toBe(true);
    expect(opponentReady(record.opponents["4"])).toBe(false);
    expect(opponentReady({ ...record.opponents["4"], status: "ready" })).toBe(false);
    expect(opponentReady(record.opponents["3"])).toBe(false);
    expect(opponentReady({ ...record.opponents["4"], collectionId: null })).toBe(false);
  });
  test("retains the relevant terminal check error and an adjacent retry without leaking another tournament's error", () => {
    const fixture=trackerFixture();
    const render=(tournamentId:string,phase:"error"|"roster")=>renderToStaticMarkup(<TournamentTrackerView {...fixture} {...callbacks} calculating={false} running={phase==="roster"} prepBusy={null} removeBusy={false} settingBusy={false} error={null} syncEvent={{tournamentId,phase,current:0,total:0,playerName:null,message:"Website temporarily unavailable"}}/>);
    expect(render("42","error")).toContain("Tournament check failed: Website temporarily unavailable");
    expect(render("42","error")).toContain("Retry check");
    expect(render("99","error")).not.toContain("Website temporarily unavailable");
    expect(render("42","roster")).not.toContain("Retry check");
  });
});
