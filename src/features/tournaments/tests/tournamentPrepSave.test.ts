import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { settingsSet } = vi.hoisted(() => ({
  settingsSet: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock("@/features/tournaments/platform", () => ({
  desktopApi: { settingsSet },
  isDesktop: () => true,
}));

import {
  saveTournamentPreps,
  TOURNAMENT_PREP_UPDATED_EVENT,
} from "../tournamentPrepStore";

describe("tournament prep saves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("retains the previous cache and reports a failed desktop save", async () => {
    const setItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    vi.stubGlobal("dispatchEvent", dispatchEvent);
    settingsSet.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(saveTournamentPreps({})).rejects.toThrow("disk unavailable");
    expect(setItem).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  test("notifies the home UI only after the desktop value is current", async () => {
    let finishWrite: (() => void) | undefined;
    settingsSet.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    const dispatchEvent = vi.fn((_event: Event) => true);
    vi.stubGlobal("dispatchEvent", dispatchEvent);

    const saving = saveTournamentPreps({});
    await Promise.resolve();

    expect(settingsSet).toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();

    finishWrite?.();
    await saving;

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0].type).toBe(TOURNAMENT_PREP_UPDATED_EVENT);
  });
});
