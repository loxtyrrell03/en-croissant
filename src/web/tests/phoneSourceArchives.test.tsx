import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import WebApp from "../WebApp";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase } from "../pgn";
import { webStateSession } from "../webStateSession";
import { phoneWorkspaceKey } from "../workspacePreferences";
import type { WebHostedLibrary } from "../hostedFiles";

const io = vi.hoisted(() => ({ save: vi.fn(async () => {}), read: vi.fn() }));
vi.mock("../storage", async (original) => ({
  ...(await original()),
  loadWebState: async () => fixture,
  saveWebState: io.save,
}));
vi.mock("@/utils/sharedLichessAuth", () => ({
  loadSharedLichessCredential: async () => null,
  saveSharedLichessCredential: async () => {},
}));
vi.mock("../stockfishEngine", () => ({
  analyzeWithWebStockfish18: vi.fn(),
  stopWebStockfish18Search: vi.fn(),
  releaseWebPcEngine: vi.fn(async () => {}),
}));
vi.mock("../hostedFiles", async (original) => {
  const actual = await original<typeof import("../hostedFiles")>();
  return {
    ...actual,
    getHostedWebLibrary: async () => library,
    getHostedWebLibraryScope: async () => library,
    getHostedWebLibraryPath: async (path: string) => ({
      library,
      listing: actual.listHostedLibraryPath(library, path),
    }),
    readHostedPgnFile: io.read,
    readHostedPgnFolder: io.read,
  };
});

const alpha = parsePgnDatabase("Alpha", "1. e4 e5 *", 1);
const beta = parsePgnDatabase("Beta", "1. d4 d5 *", 2);
for (const [item, name] of [
  [alpha, "Alpha"],
  [beta, "Beta"],
] as const)
  Object.assign(item.database, {
    sourceKind: "source",
    hostedPath: `Databases/Class/${name}`,
    hostedUpdatedAt: 1,
  });
const library: WebHostedLibrary = {
  available: true,
  manifest: {
    version: 1,
    generatedAt: "2026-10-25T00:00:00Z",
    sourceName: "Invented archive catalogue",
    files: [alpha, beta].map((item) => ({
      type: "file",
      name: "Games",
      filename: "games.pgn",
      path: `${item.database.hostedPath}/games.pgn`,
      url: "fixture.pgn",
      extension: "pgn",
      sizeBytes: 20,
      lastModified: 1,
    })),
  },
};
const fixture = createEmptyWebState();
fixture.databases = [alpha.database, beta.database];
fixture.gamesByDatabase = { [alpha.database.id]: alpha.games, [beta.database.id]: beta.games };
fixture.activePrepId = "active-prep";
fixture.prepWorkspaces = [
  {
    id: fixture.activePrepId,
    mode: "player",
    source: "local",
    name: "Invented active Prep",
    opponent: "Fixture",
    userColor: "black",
    sourceIds: [alpha.database.id],
    startFen: fixture.board.startFen,
    line: [],
    notesByFen: { note: "Keep" },
    preparedMoves: { branch: 1 },
    createdAt: 1,
    updatedAt: 1,
    panelStage: "setup",
  },
];
fixture.workspacePreferences = {
  [phoneWorkspaceKey(fixture)]: { database: { local: `hosted:${alpha.database.hostedPath}` } },
};

it("archives and restores through real Files/import controls, preserves active Prep and excludes archived defaults", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  Element.prototype.scrollIntoView = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  const click = async (selector: string) =>
    act(async () => {
      const target = host.querySelector<HTMLElement>(selector)!;
      expect(target).not.toBeNull();
      target.click();
    });
  try {
    localStorage.setItem("en-croissant-phone-engine-enabled", "false");
    await act(async () => root.render(<WebApp />));
    await vi.waitFor(async () => {
      await settle();
      expect(host.querySelector('button[data-view="files"]')).not.toBeNull();
    });
    await click('button[data-view="files"]');
    for (const path of ["Databases", "Databases/Class"]) {
      await vi.waitFor(async () => {
        await settle();
        expect(host.querySelector(`[data-hosted-path="${path}"] > button`)).not.toBeNull();
      });
      await click(`[data-hosted-path="${path}"] > button`);
    }
    await vi.waitFor(async () => {
      await settle();
      expect(host.querySelector('[aria-label="Archive Alpha"]')).not.toBeNull();
    });
    const before = webStateSession.getSnapshot().state;
    await click('[aria-label="Archive Alpha"]');
    expect(host.querySelector('[data-hosted-path="Databases/Class/Alpha"]')).toBeNull();
    expect(host.querySelector('[data-hosted-path="Databases/Class/Beta"]')).not.toBeNull();
    await act(async () => {
      await webStateSession.flush();
    });
    const archived = webStateSession.getSnapshot().state;
    expect(archived.sourceArchives?.hostedPaths).toEqual(["Databases/Class/Alpha"]);
    expect(archived.prepWorkspaces).toBe(before.prepWorkspaces);
    expect(archived.gamesByDatabase).toBe(before.gamesByDatabase);
    expect(archived.board).toBe(before.board);
    expect(io.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceArchives: expect.any(Object) }),
    );
    await click('[aria-label="Open archive"]');
    expect(host.querySelector('[data-hosted-path="Databases/Class/Alpha"]')?.textContent).toContain(
      "Archived",
    );
    expect(host.querySelector('[data-hosted-path="Databases/Class/Beta"]')).toBeNull();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Help: Archived sources"]')!.focus(),
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("sync with Novelty Dev");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await click('button[data-view="board"]');
    await click('[role="tab"][aria-label="Database"]');
    await settle();
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent === "Alpha (Archived)",
      ),
    ).toBe(true);
    await click('[role="tab"][aria-label="Prep"]');
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent === "Alpha (Archived)",
      ),
    ).toBe(true);
    expect(webStateSession.getSnapshot().state.prepWorkspaces[0].sourceIds).toEqual([
      alpha.database.id,
    ]);
    await act(async () =>
      webStateSession.setState((state) => ({
        ...state,
        activePrepId: null,
        board: {
          ...state.board,
          annotationOwnerId: "fresh-source-owner",
          sourceDatabaseId: beta.database.id,
          sourceGameId: beta.games[0].id,
        },
      })),
    );
    await click('[role="tab"][aria-label="Database"]');
    await settle();
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent === "Alpha (Archived)",
      ),
    ).toBe(false);
    expect(
      Array.from(host.querySelectorAll("button")).some((button) => button.textContent === "Beta"),
    ).toBe(true);
    await click('button[data-view="import"]');
    expect(host.querySelector(`[data-import-id="${alpha.database.id}"]`)).toBeNull();
    expect(host.querySelector(`[data-import-id="${beta.database.id}"]`)).not.toBeNull();
    await click('[aria-label="Open archive"]');
    expect(host.querySelector(`[data-import-id="${alpha.database.id}"]`)?.textContent).toContain(
      "Archived",
    );
    expect(host.querySelector(`[data-import-id="${beta.database.id}"]`)).toBeNull();
    await click('[aria-label="Unarchive Alpha"]');
    expect(host.querySelector(`[data-import-id="${alpha.database.id}"]`)).toBeNull();
    await click('[aria-label="Back to active sources"]');
    expect(host.querySelector(`[data-import-id="${alpha.database.id}"]`)).not.toBeNull();
    expect(webStateSession.getSnapshot().state.sourceArchives?.hostedPaths).toEqual([]);
    await act(async () => {
      await webStateSession.flush();
    });
    expect(webStateSession.getSnapshot().state.gamesByDatabase).toBe(before.gamesByDatabase);
    expect(io.read).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("This view could not open");
  } finally {
    await act(async () => root.unmount());
    await webStateSession.flush();
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
