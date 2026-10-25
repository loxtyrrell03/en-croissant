import { MantineProvider } from "@mantine/core";
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  activeTabAtom,
  tabsAtom,
  databasePanelSettingsByFileAtom,
  currentOpponentPrepAtom,
  currentUnderBoardOpponentPrepAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  comparePanelSettingsByFileAtom,
  sessionsAtom,
} from "@/state/atoms";
import { createTreeStore } from "@/state/store/tree";
import { ownTabTree } from "@/state/store/treeOwner";
import type { Tab } from "@/utils/tabs";
import type { Opening } from "@/utils/db";
import type { LocalOptions } from "./DatabasePanel";
import DatabasePanel from "./DatabasePanel";
import DatabaseComparePanel from "./DatabaseComparePanel";
import OpponentPrepPanel from "../prep/OpponentPrepPanel";

const io = vi.hoisted(() => ({
  search: vi.fn<(options: LocalOptions) => Promise<[Opening[], []]>>(),
  lichess: vi.fn(),
  masters: vi.fn(),
}));
vi.mock("@/utils/db", async (original) => ({
  ...(await original()),
  getDatabases: async () => [],
  getDatabaseSelectData: () => [],
  searchPosition: io.search,
  cancelDatabaseSearch: async () => {},
  getMostCommonPlayer: async () => ({ id: 42, name: "Fixture" }),
}));
vi.mock("@/utils/lichess/api", async (original) => ({
  ...(await original()),
  getLichessGames: io.lichess,
  getMasterGames: io.masters,
  queryLichessCloudMoves: async () => null,
}));
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async () => new Response("{}", { status: 404 }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tanstack/react-router", () => ({
  useLoaderData: () => ({ documentDir: "/synthetic" }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (value: string) => value }) }));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
vi.mock("@/components/common/LiveDatabaseFolderSelect", () => ({
  default: () => <span>Source picker fixture</span>,
}));
vi.mock("./DatabasePerspectiveControls", () => ({ DatabasePerspectiveControls: () => null }));
vi.mock("./OpeningsTable", async (original) => ({
  ...(await original()),
  default: () => <div>Table fixture</div>,
}));
vi.mock("./GamesTable", () => ({ default: () => null }));
vi.mock("../prep/OtbGameImportPanel", () => ({ default: () => null }));

const tab: Tab = {
  value: "date-owner",
  name: "Invented date lesson",
  type: "analysis",
  gameOrigin: {
    kind: "file",
    gameNumber: 0,
    sourceIdentity: "synthetic",
    file: {
      type: "file",
      path: "C:/Fixture/Dates.pgn",
      name: "Dates",
      numGames: 1,
      lastModified: 1,
      metadata: { type: "game", tags: [] },
    },
  },
};
beforeEach(() => {
  localStorage.clear();
  io.search.mockReset().mockResolvedValue([[], []]);
  io.lichess.mockReset().mockResolvedValue({ moves: [] });
  io.masters.mockReset().mockResolvedValue({ moves: [] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function harness() {
  const atoms = createStore();
  atoms.set(tabsAtom, [tab]);
  atoms.set(activeTabAtom, tab.value);
  atoms.set(sessionsAtom, [{ lichess: { accessToken: "synthetic-token" } }] as never);
  const tree = createTreeStore();
  ownTabTree(tree, tab.value);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (child: React.ReactNode) =>
    act(async () =>
      root.render(
        <MantineProvider env="test">
          <SWRConfig
            value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
          >
            <Provider store={atoms}>
              <TreeStateContext.Provider value={tree}>{child}</TreeStateContext.Provider>
            </Provider>
          </SWRConfig>
        </MantineProvider>,
      ),
    );
  const close = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  const input = async (label: string, value: string) =>
    act(async () => {
      const field = host.querySelector<HTMLInputElement>(`[aria-label="${label} date"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const click = async (text: string) =>
    act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === text)!
        .click(),
    );
  return { atoms, tree, host, render, close, settle, input, click };
}

it.each(["side", "underBoard"] as const)(
  "hydrates %s file dates before querying and wires custom controls into the real request path",
  async (scope) => {
    const h = harness();
    const settingsKey = `c:/fixture/dates.pgn${scope === "underBoard" ? "::under-board-database" : ""}`;
    h.atoms.set(databasePanelSettingsByFileAtom, {
      [settingsKey]: {
        source: { type: "local", value: "synthetic.db3" },
        localOptions: {
          type: "exact",
          player: null,
          color: "white",
          result: "any",
          dateRange: { period: "custom", since: "2026-01-01", until: "2026-10-25" },
        },
        lichessOptions: { color: "white" },
        masterOptions: {},
        moveHealthSide: "sideToMove",
        tabType: "stats",
      },
    });
    try {
      await h.render(<DatabasePanel scope={scope} />);
      await vi.waitFor(async () => {
        await h.settle();
        expect(io.search).toHaveBeenCalled();
      });
      expect(io.lichess).not.toHaveBeenCalled();
      expect(
        io.search.mock.calls.every(
          ([options]) => options.start_date === "2026.01.01" && options.end_date === "2026.10.25",
        ),
      ).toBe(true);
      await h.click("Edit dates");
      await h.input("From", "2026-09-03");
      await h.click("Apply dates");
      await vi.waitFor(async () => {
        await h.settle();
        expect(io.search).toHaveBeenLastCalledWith(
          expect.objectContaining({ start_date: "2026.09.03", end_date: "2026.10.25" }),
          expect.any(String),
          expect.any(Object),
        );
      });
      expect(
        h.atoms.get(databasePanelSettingsByFileAtom)[settingsKey].localOptions.dateRange,
      ).toEqual({ period: "custom", since: "2026-09-03", until: "2026-10-25" });
      expect(h.tree.getState().dirty).toBe(false);
    } finally {
      await h.close();
    }
  },
);

it("keeps invalid saved dates repairable without issuing an unfiltered request", async () => {
  const h = harness();
  const invalid = { period: "custom" as const, since: "2026-12-31", until: "2026-01-01" };
  h.atoms.set(databasePanelSettingsByFileAtom, {
    "c:/fixture/dates.pgn": {
      source: { type: "local", value: "synthetic.db3" },
      localOptions: {
        type: "exact",
        player: null,
        color: "white",
        result: "any",
        dateRange: invalid,
      },
      lichessOptions: { color: "white" },
      masterOptions: {},
      moveHealthSide: "sideToMove",
      tabType: "stats",
    },
  });
  try {
    await h.render(<DatabasePanel />);
    await h.settle();
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain(
      "Saved dates are invalid",
    );
    expect(io.search).not.toHaveBeenCalled();
    expect(io.lichess).not.toHaveBeenCalled();
    expect(
      h.atoms.get(databasePanelSettingsByFileAtom)["c:/fixture/dates.pgn"].localOptions.dateRange,
    ).toEqual(invalid);
    await h.click("Clear date filter");
    await vi.waitFor(async () => {
      await h.settle();
      expect(io.search).toHaveBeenCalledWith(
        expect.objectContaining({
          start_date: undefined,
          end_date: undefined,
          dateRange: { period: "all", since: "", until: "" },
        }),
        expect.any(String),
        expect.any(Object),
      );
    });
    expect(h.host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await h.close();
  }
});

it("keeps Prep date choices independent and drops a builder's delayed response after its date context changes", async () => {
  const h = harness();
  h.atoms.set(lichessOptionsAtom, (current) => ({
    ...current,
    dateRange: { period: "3m", since: "", until: "" },
  }));
  h.atoms.set(currentOpponentPrepAtom, (current) => ({
    ...current,
    source: "local",
    mode: "player",
    databasePath: "synthetic.db3",
    databaseLabel: "Invented",
    player: 42,
    playerName: "Fixture",
    color: "white",
    rootPath: [],
    dateRanges: { "player:local": { period: "custom", since: "2026-01-01", until: "2026-10-25" } },
  }));
  let resolve!: (rows: [Opening[], []]) => void;
  const pending = new Promise<[Opening[], []]>((done) => {
    resolve = done;
  });
  io.search.mockImplementation(async (options) =>
    options.start_date === "2026.02.01" ? pending : [[], []],
  );
  try {
    await h.render(<OpponentPrepPanel />);
    await vi.waitFor(async () => {
      await h.settle();
      expect(io.search).toHaveBeenCalled();
    });
    await act(async () =>
      h.host.querySelector<HTMLInputElement>('input[value="general"]')!.click(),
    );
    await h.settle();
    expect(h.host.querySelector<HTMLInputElement>('[aria-label="Game date range"]')?.value).toBe(
      "All time",
    );
    expect(h.atoms.get(lichessOptionsAtom).dateRange?.period).toBe("3m");
    await act(async () => h.host.querySelector<HTMLInputElement>('input[value="player"]')!.click());
    await vi.waitFor(async () => {
      await h.settle();
      expect(h.atoms.get(currentOpponentPrepAtom).player).toBe(42);
    });
    expect(h.host.querySelector<HTMLInputElement>('[aria-label="Game date range"]')?.value).toBe(
      "Custom range…",
    );
    await h.click("Edit dates");
    await h.input("From", "2026-02-01");
    await h.click("Apply dates");
    await vi.waitFor(async () => {
      await h.settle();
      expect(io.search.mock.calls.some(([options]) => options.start_date === "2026.02.01")).toBe(
        true,
      );
    });
    expect(h.atoms.get(currentUnderBoardOpponentPrepAtom).dateRanges).toBeUndefined();
    const builder = Array.from(h.host.querySelectorAll("button")).find(
      (button) => button.textContent === "Build prep",
    )!;
    expect(builder).not.toBeNull();
    expect(builder.disabled).toBe(false);
    await act(async () => builder.click());
    await act(async () =>
      h.atoms.set(currentOpponentPrepAtom, (current) => ({
        ...current,
        dateRanges: {
          ...current.dateRanges,
          "player:local": { period: "custom", since: "2027-01-01", until: "2027-12-31" },
        },
      })),
    );
    await act(async () => resolve([[{ move: "e4", white: 8, black: 1, draw: 1 }], []]));
    await h.settle();
    await vi.waitFor(async () => {
      await h.settle();
      expect(
        Array.from(h.host.querySelectorAll("button")).find(
          (button) => button.textContent === "Build prep",
        )?.disabled,
      ).toBe(false);
    });
    expect(h.tree.getState().root.children).toHaveLength(0);
    expect(h.tree.getState().dirty).toBe(false);
    expect(h.atoms.get(currentOpponentPrepAtom).dateRanges?.["player:local"].since).toBe(
      "2027-01-01",
    );
  } finally {
    resolve([[], []]);
    await h.close();
  }
});

it("keeps Compare source ranges independent and persists their real query options", async () => {
  const h = harness();
  h.atoms.set(lichessOptionsAtom, (current) => ({
    ...current,
    dateRange: { period: "custom", since: "2026-01-01", until: "2026-10-31" },
  }));
  h.atoms.set(masterOptionsAtom, {
    dateRange: { period: "custom", since: "2020-01-01", until: "2025-12-31" },
  });
  try {
    await h.render(<DatabaseComparePanel />);
    await vi.waitFor(async () => {
      await h.settle();
      expect(io.lichess).toHaveBeenCalled();
      expect(io.masters).toHaveBeenCalled();
    });
    const source = h.host.querySelector('[data-game-date-source="lch_all"]')!;
    await act(async () =>
      Array.from(source.querySelectorAll("button"))
        .find((button) => button.textContent === "Edit dates")!
        .click(),
    );
    const field = source.querySelector<HTMLInputElement>('[aria-label="From date"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        field,
        "2026-09",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      Array.from(source.querySelectorAll("button"))
        .find((button) => button.textContent === "Apply dates")!
        .click(),
    );
    await vi.waitFor(async () => {
      await h.settle();
      expect(io.lichess.mock.calls.at(-1)?.[1].since.getMonth()).toBe(8);
    });
    expect(h.atoms.get(masterOptionsAtom).dateRange).toEqual({
      period: "custom",
      since: "2020-01-01",
      until: "2025-12-31",
    });
    const saved = h.atoms.get(comparePanelSettingsByFileAtom)["c:/fixture/dates.pgn"];
    expect(saved.lichessOptions.dateRange).toEqual({
      period: "custom",
      since: "2026-09-01",
      until: "2026-10-31",
    });
    expect(saved.masterOptions.dateRange?.since).toBe("2020-01-01");
    expect(h.tree.getState().dirty).toBe(false);
  } finally {
    await h.close();
  }
});
