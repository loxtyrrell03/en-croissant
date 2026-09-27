import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TournamentPrepStrip } from "../TournamentPrepStrip";

describe("TournamentPrepStrip", () => {
  test("renders one restrained tournament preparation utility section", () => {
    const markup = renderToStaticMarkup(
      <TournamentPrepStrip
        onNew={() => undefined}
        onOpen={() => undefined}
      />,
    );

    expect(markup).toContain("Tournament preparation");
    expect(markup).not.toContain("Import player games");
    expect(markup).toContain("Find tournaments");
    expect(markup).not.toContain("Tournament tools");
    expect(markup).not.toContain("Next-round watch");
  });
});
