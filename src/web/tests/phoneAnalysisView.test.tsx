import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WebCompanionState, WebPrepWorkspace } from "../model";
import { parsePgnDatabase, webGameToLine } from "../pgn";
import { createEmptyWebBoardState, createEmptyWebState } from "../storage";
import { usePhoneAnalysisView } from "../usePhoneAnalysisView";
import { webStateSession } from "../webStateSession";

vi.mock("../storage", async (original) => ({
  ...(await original()),
  loadWebState: async () => createEmptyWebState(),
  saveWebState: async () => {},
}));

const source = parsePgnDatabase("Invented report view", "1. e4 e5 *", 1);
const other = parsePgnDatabase("Other invented report view", "1. d4 d5 *", 2);
const board = (database: typeof source): WebCompanionState["board"] => ({
  ...createEmptyWebBoardState(),
  sourceDatabaseId: database.database.id,
  sourceGameId: database.games[0].id,
  line: webGameToLine(database.games[0]),
});
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, select: (value: string) => void;
function Probe() {
  const { state } = useSyncExternalStore(webStateSession.subscribe, webStateSession.getSnapshot);
  const [view, onChange] = usePhoneAnalysisView(state);
  select = onChange;
  return <output>{view}</output>;
}
const update = (action: (state: WebCompanionState) => WebCompanionState) =>
  act(async () => webStateSession.setState(action));
const choose = (view: string) => act(async () => select(view));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await webStateSession.load();
  webStateSession.setState(() => ({
    ...createEmptyWebState(),
    databases: [source.database, other.database],
    gamesByDatabase: { [source.database.id]: source.games, [other.database.id]: other.games },
    board: board(source),
  }));
  await webStateSession.flush();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  await webStateSession.flush();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("a queued old-workspace choice cannot change the replacement or the former workspace", async () => {
  await choose("report");
  const oldChoice = select;
  await act(async () => {
    webStateSession.setState((state) => ({ ...state, board: board(other) }));
    oldChoice("plans"); // Before React has rendered the replacement.
  });
  expect(host.textContent).toBe("live");
  await choose("plans");
  await update((state) => ({ ...state, board: board(source) }));
  expect(host.textContent).toBe("report");
  await choose("unknown");
  expect(host.textContent).toBe("report");
});

test("removing a source forgets its report view, including a reopened source with the same path and id", async () => {
  await choose("report");
  await update((state) => ({
    ...state,
    databases: [other.database],
    board: board(other),
  }));
  await update((state) => ({
    ...state,
    databases: [source.database, other.database],
    board: board(source),
  }));
  expect(host.textContent).toBe("live");
});

test("Prep and blank boards have independent temporary views and do not inherit the source report", async () => {
  await choose("report");
  const prep: WebPrepWorkspace = {
    id: "fixture-prep",
    name: "Invented Prep",
    opponent: "Fixture",
    userColor: "white",
    sourceIds: [source.database.id],
    startFen: createEmptyWebBoardState().startFen,
    line: [],
    notesByFen: {},
    preparedMoves: {},
    createdAt: 1,
    updatedAt: 1,
  };
  await update((state) => ({ ...state, prepWorkspaces: [prep], activePrepId: prep.id }));
  expect(host.textContent).toBe("live");
  await choose("plans");
  await update((state) => ({ ...state, activePrepId: null }));
  expect(host.textContent).toBe("report");
  await update((state) => ({ ...state, activePrepId: prep.id }));
  expect(host.textContent).toBe("plans");
  await update((state) => ({
    ...state,
    activePrepId: null,
    board: { ...createEmptyWebBoardState(), annotationOwnerId: "first-blank" },
  }));
  expect(host.textContent).toBe("live");
  await choose("report");
  await update((state) => ({
    ...state,
    board: { ...createEmptyWebBoardState(), annotationOwnerId: "next-blank" },
  }));
  expect(host.textContent).toBe("live");
});

test("storage failure does not prevent view choices, which never enter saved workspace or the next app session", async () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw Error("Unavailable fixture");
  });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("Unavailable fixture");
  });
  const before = JSON.stringify(webStateSession.getSnapshot().state);
  await choose("report");
  expect(host.textContent).toBe("report");
  expect(JSON.stringify(webStateSession.getSnapshot().state)).toBe(before);
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
  expect(host.textContent).toBe("live");
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});
