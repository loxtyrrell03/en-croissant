import { TournamentEmbedded } from "../ui";
import { renderToStaticMarkup as renderRaw } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { TournamentPrepModal } from "../TournamentPrepModal";

vi.mock("../usePairingForecast", () => ({
  usePairingForecast: () => ({ forecast: null, isCalculating: false }),
}));

const renderToStaticMarkup=(node:React.ReactNode)=>renderRaw(<TournamentEmbedded.Provider value={true}>{node}</TournamentEmbedded.Provider>);

describe("TournamentPrepModal setup", () => {
  test("opens on a compact event finder without marketing copy", () => {
    const markup = renderToStaticMarkup(
      <TournamentPrepModal
        onClose={() => undefined}
        onChanged={() => undefined}
        onOpenDatabase={() => undefined}
        onOpenPrep={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Tournament directory"');
    expect(markup).not.toContain("Find your next tournament");
    expect(markup).toContain("Country / federation");
    expect(markup).toContain("Next 3 months");
    expect(markup).toContain('placeholder="Name, place or Chess-Results link"');
    expect(markup).not.toContain("Start tracking");
    expect(markup).not.toContain("One link, every opponent");
    expect(markup).not.toContain("Tournament link");
  });

  test("shows a loading state instead of the finder while an existing tracker loads", () => {
    const markup = renderToStaticMarkup(
      <TournamentPrepModal
        tournamentId="fixture-event"
        onClose={() => undefined}
        onChanged={() => undefined}
        onOpenDatabase={() => undefined}
        onOpenPrep={() => undefined}
      />,
    );

    expect(markup).toContain("Loading tournament…");
    expect(markup).not.toContain('role="combobox"');
  });
});
