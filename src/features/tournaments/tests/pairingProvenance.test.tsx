import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { TournamentTrackerView } from "../TournamentTrackerView";
import { trackerFixture } from "./trackerFixture";

test("inferred Berger pairing is expected with help, never published or 100 percent", () => {
  const fixture=trackerFixture();
  fixture.forecast={...fixture.forecast,kind:"inferred",confidence:"low",candidates:[{...fixture.forecast.candidates[0],probability:1}],otherProbability:0,caveat:"Assumes Berger numbering; not a published pairing."};
  const markup=renderToStaticMarkup(<TournamentTrackerView {...fixture} calculating={false} running={false} prepBusy={null} removeBusy={false} settingBusy={false} syncEvent={null} error={null} onOpponent={vi.fn()} onOpenDatabase={vi.fn()} onToggleUpdate={vi.fn()} onCheck={vi.fn()} onStop={vi.fn()} onRemove={vi.fn()} projectedSideFor={()=>"white"} />);
  expect(markup).toContain("Expected");
  expect(markup).toContain('aria-label="Help: Expected pairing"');
  expect(markup).not.toContain("~100%");
  expect(markup).not.toContain("Scheduled");
  expect(markup).not.toContain("Published");
});
