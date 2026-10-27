import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import WebApp from "../WebApp";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase, webGameToLine } from "../pgn";
import { webStateSession } from "../webStateSession";
import { phoneBoardOrientation, phoneWorkspaceKey } from "../workspacePreferences";

const persistence = vi.hoisted(() => ({ save: vi.fn(async () => {}) }));
vi.mock("../storage", async (original) => ({
  ...(await original()),
  loadWebState: async () => createEmptyWebState(),
  saveWebState: persistence.save,
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

type PhoneWorkspaceFixture = {
  host: HTMLDivElement;
  parsed: ReturnType<typeof parsePgnDatabase>;
  other: ReturnType<typeof parsePgnDatabase>;
  settle: () => Promise<void>;
  remount: () => Promise<void>;
};

// Keep the default per-test deadline; these are independent real-component
// workflows, rather than one nearly-five-second combined round trip.
async function withPhoneWorkspace(check: (fixture: PhoneWorkspaceFixture) => Promise<void>) {
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
  window.scrollTo = vi.fn();
  const parsed = parsePgnDatabase("Invented file preference", "1. e4 e5 *\n\n1. d4 d5 *", 1);
  parsed.database.hostedFilePath = "C:/Lessons/Fixture.pgn";
  const other = parsePgnDatabase("Other invented file", "1. c4 e5 *", 2);
  other.database.hostedFilePath = "C:/Lessons/Other.pgn";
  await webStateSession.load();
  webStateSession.setState(() => ({
    ...createEmptyWebState(),
    databases: [parsed.database, other.database],
    gamesByDatabase: { [parsed.database.id]: parsed.games, [other.database.id]: other.games },
    board: {
      ...createEmptyWebState().board,
      annotationOwnerId: "first",
      sourceDatabaseId: parsed.database.id,
      sourceGameId: parsed.games[0].id,
      line: webGameToLine(parsed.games[0]),
      cursor: 0,
    },
  }));
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  try {
    localStorage.setItem("en-croissant-phone-engine-enabled", "false");
    await act(async () => root.render(<WebApp />));
    await vi.waitFor(async () => {
      await settle();
      expect(host.querySelector('[aria-label="Board menu"]')).not.toBeNull();
    });
    await check({
      host,
      parsed,
      other,
      settle,
      remount: async () => {
        await act(async () => root.unmount());
        root = createRoot(host);
        await act(async () => root.render(<WebApp />));
      },
    });
  } finally {
    await act(async () => root.unmount());
    await act(async () => {
      await webStateSession.flush();
    });
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
}

it("starts a new saved board from the real header and reopens it from Files after remount", async () => {
  await withPhoneWorkspace(async ({ host, parsed, settle, remount }) => {
    const oldPgn = webStateSession.getSnapshot().state.gamesByDatabase[parsed.database.id][0].pgn;
    expect(host.textContent).not.toContain("Reset position");
    expect(host.textContent).not.toContain("Reset line");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="New board, position or file"]')!.click(),
    );
    await settle();
    const newBoard = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (el) => el.textContent === "New board",
    )!;
    await act(async () => newBoard.click());
    await settle();
    await act(async () => {
      await webStateSession.flush();
    });
    const state = webStateSession.getSnapshot().state;
    expect(state.board.line).toEqual([]);
    expect(state.board.sourceTitle).toBe("Untitled.pgn");
    expect(state.gamesByDatabase[parsed.database.id][0].pgn).toBe(oldPgn);
    expect(
      host.querySelector('[role="tab"][aria-label="Moves"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    await remount();
    await settle();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[data-view="files"]')!.click(),
    );
    await settle();
    expect(host.textContent).toContain("Saved boards");
    expect(host.textContent).toContain("Untitled.pgn");
    const row = host.querySelector(`[data-import-id="${state.board.sourceDatabaseId}"]`)!;
    await act(async () =>
      [...row.querySelectorAll<HTMLButtonElement>("button")]
        .find((el) => el.textContent === "Open")!
        .click(),
    );
    await settle();
    expect(host.querySelector("h2")?.textContent).toBe("Untitled.pgn");
    expect(webStateSession.getSnapshot().state.board.sourceGameId).toBe(state.board.sourceGameId);
  });
});

it("persists actual phone Flip through games in one file and root remount", async () => {
  await withPhoneWorkspace(async ({ host, parsed, settle, remount }) => {
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Board menu"]')!.click(),
    );
    await settle();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="Flip board"]')!
        .click(),
    );
    await act(async () => {
      await webStateSession.flush();
    });
    expect(phoneBoardOrientation(webStateSession.getSnapshot().state)).toBe("black");
    expect(host.querySelector(".orientation-black")).not.toBeNull();
    expect(persistence.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspacePreferences: expect.any(Object) }),
    );
    await act(async () =>
      webStateSession.setState((state) => ({
        ...state,
        board: {
          ...state.board,
          annotationOwnerId: "second",
          sourceGameId: parsed.games[1].id,
          line: webGameToLine(parsed.games[1]),
          orientation: "white",
        },
      })),
    );
    await settle();
    expect(host.querySelector(".orientation-black")).not.toBeNull();
    await remount();
    await vi.waitFor(async () => {
      await settle();
      expect(host.querySelector(".orientation-black")).not.toBeNull();
    });
    expect(webStateSession.getSnapshot().state.board.line).toEqual(webGameToLine(parsed.games[1]));
  });
});

it("opens new phone workspaces on Live and remembers explicit analysis views only for the current session", async () => {
  await withPhoneWorkspace(async ({ host, parsed, other, settle, remount }) => {
    const showAnalysis = async () => {
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Analysis"]')!.click(),
      );
    };
    const choose = async (value: string) => {
      await act(async () =>
        host
          .querySelector<HTMLInputElement>(`[aria-label="Analysis view"] input[value="${value}"]`)!
          .click(),
      );
    };
    const expectView = (value: string) =>
      expect(
        host.querySelector<HTMLInputElement>(`[aria-label="Analysis view"] input[value="${value}"]`)
          ?.checked,
      ).toBe(true);
    const first = webStateSession.getSnapshot().state.board;
    await showAnalysis();
    expectView("live");
    await choose("report");
    await act(async () =>
      webStateSession.setState((state) => ({
        ...state,
        board: {
          ...state.board,
          annotationOwnerId: "same-file-next-game",
          sourceGameId: parsed.games[1].id,
          line: webGameToLine(parsed.games[1]),
        },
      })),
    );
    await settle();
    expectView("report");
    await act(async () =>
      webStateSession.setState((state) => ({
        ...state,
        board: {
          ...state.board,
          annotationOwnerId: "other-file",
          sourceDatabaseId: other.database.id,
          sourceGameId: other.games[0].id,
          line: webGameToLine(other.games[0]),
        },
      })),
    );
    await settle();
    expectView("live");
    await choose("plans");
    await act(async () => webStateSession.setState((state) => ({ ...state, board: first })));
    await settle();
    expectView("report");
    await choose("live");
    await choose("report");
    const before = JSON.stringify(webStateSession.getSnapshot().state);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('nav[aria-label="Workspace"] [data-view="files"]')!
        .click(),
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('nav[aria-label="Workspace"] [data-view="board"]')!
        .click(),
    );
    await showAnalysis();
    expectView("report");
    expect(JSON.stringify(webStateSession.getSnapshot().state)).toBe(before);
    await remount();
    await showAnalysis();
    expectView("live");
    expect(JSON.stringify(webStateSession.getSnapshot().state)).toBe(before);
  });
});

it("retains independent actual Database and Prep source choices across files, modes and panels", async () => {
  await withPhoneWorkspace(async ({ host, other, settle }) => {
    const fileKey = phoneWorkspaceKey(webStateSession.getSnapshot().state);
    const click = async (selector: string) =>
      act(async () => {
        const target = host.querySelector<HTMLElement>(selector)!;
        expect(target).not.toBeNull();
        target.click();
      });
    await click('[role="tab"][aria-label="Database"]');
    await click('[aria-label="Database source"] input[value="lichess-all"]');
    expect(
      webStateSession.getSnapshot().state.workspacePreferences?.[fileKey]?.database?.source,
    ).toBe("lichess-all");
    const firstBoard = webStateSession.getSnapshot().state.board;
    await act(async () =>
      webStateSession.setState((state) => ({
        ...state,
        board: {
          ...state.board,
          annotationOwnerId: "other-file",
          sourceDatabaseId: other.database.id,
          sourceGameId: other.games[0].id,
          line: webGameToLine(other.games[0]),
          orientation: "white",
        },
      })),
    );
    await settle();
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Database source"] input[value="local"]')
        ?.checked,
    ).toBe(true);
    await click('[aria-label="Database source"] input[value="lichess-masters"]');
    await act(async () => webStateSession.setState((state) => ({ ...state, board: firstBoard })));
    await settle();
    expect(
      host.querySelector<HTMLInputElement>(
        '[aria-label="Database source"] input[value="lichess-all"]',
      )?.checked,
    ).toBe(true);
    await click('[role="tab"][aria-label="Prep"]');
    await click('[aria-label="Prep target"] input[value="general"]');
    const picker = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Lichess All",
    )!;
    await act(async () => picker.click());
    await vi.waitFor(async () => {
      await settle();
      expect(document.querySelector('[aria-label="Search databases"]')).toBeInstanceOf(
        HTMLInputElement,
      );
    });
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search databases"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "Lichess Masters",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const masters = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.startsWith("Lichess Masters"),
    )!;
    await act(async () => masters.click());
    await click('[aria-label="Prep target"] input[value="player"]');
    await click('[aria-label="Prep target"] input[value="general"]');
    expect(webStateSession.getSnapshot().state.workspacePreferences?.[fileKey]?.prep).toMatchObject(
      {
        mode: "general",
        sources: { general: { source: "lichess-masters" }, player: { source: "local" } },
      },
    );
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent === "Lichess Masters",
      ),
    ).toBe(true);
    await click('[role="tab"][aria-label="Moves"]');
    await click('[role="tab"][aria-label="Prep"]');
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Prep target"] input[value="general"]')
        ?.checked,
    ).toBe(true);
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent === "Lichess Masters",
      ),
    ).toBe(true);
    await act(async () => {
      await webStateSession.flush();
    });
    expect(host.textContent).not.toContain("This view could not open");
  });
});
