import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";

const {
  importOpponent,
  collectOtbGames,
  collectionCreate,
  collectionDelete,
  collectionList,
  collectionSetDescription,
  collectionSetFolder,
  fetchTournamentSnapshot,
  libraryImportPgnStream,
} = vi.hoisted(() => ({
  importOpponent: vi.fn(),
  collectOtbGames: vi.fn(),
  collectionCreate: vi.fn(),
  collectionDelete: vi.fn<(id: number) => Promise<void>>(),
  collectionList: vi.fn(),
  collectionSetDescription: vi.fn(),
  collectionSetFolder: vi.fn(),
  fetchTournamentSnapshot: vi.fn(),
  libraryImportPgnStream: vi.fn(),
}));

vi.mock("@/features/tournaments/platform", () => ({
  desktopApi: {
    collectOtbGames,
    collectionCreate,
    collectionDelete,
    collectionList,
    collectionSetDescription,
    collectionSetFolder,
    fetchTournamentSnapshot,
    libraryImportPgnStream,
  },
  isDesktop: () => true,
}));

vi.mock("../opponentImport", () => ({ importOpponent }));

vi.mock("@tauri-apps/api/path", () => ({
  appCacheDir: vi.fn(async () => "C:/cache"),
  resolve: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

vi.mock("@/features/tournaments/jobs", () => ({ registerJob: vi.fn() }));
vi.mock("@/features/tournaments/ui", () => ({ pushToast: vi.fn() }));

vi.mock("../tournamentPrepStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tournamentPrepStore")>();
  return {
    ...actual,
    loadTournamentPreps: vi.fn(),
    saveTournamentPreps: vi.fn(),
  };
});

import {
  createTournamentPrepRecord,
  loadTournamentPreps,
  saveTournamentPreps,
} from "../tournamentPrepStore";
import { latestTournamentSyncEvent, prepareTournamentOpponent, removeTournamentPrepAndDatabases, runTournamentPrepSync, stopFollowingTournament } from "../tournamentPrepSync";

const SNAPSHOT: TournamentSnapshot = {
  tournamentId: "42",
  sourceUrl: "https://chess-results.com/tnr42.aspx?lan=1",
  title: "Summer Open",
  section: null,
  format: "swiss",
  formatLabel: "Swiss-System",
  totalRounds: 7,
  completedRound: 1,
  publishedRound: 1,
  liveRound: null,
  nextRound: 2,
  phase: "between-rounds",
  dateRange: null,
  timeControl: null,
  sourceUpdatedAt: null,
  fetchedAt: "2026-08-06T12:00:00Z",
  players: [
    {
      startNumber: 1,
      name: "Able, Alice",
      fideId: "123",
      federation: "ENG",
      title: null,
      rating: 2100,
      rank: 1,
      points: 1,
      active: true,
    },
    {
      startNumber: 2,
      name: "Baker, Bob",
      fideId: "456",
      federation: "WLS",
      title: null,
      rating: 2000,
      rank: 2,
      points: 0,
      active: true,
    },
  ],
  pairings: [],
  warnings: [],
};

describe("tournament prep removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("deletes linked databases before removing the tracker", async () => {
    const record = createTournamentPrepRecord(SNAPSHOT, 1, 2022);
    record.opponents["2"].collectionId = 17;
    vi.mocked(loadTournamentPreps)
      .mockResolvedValueOnce({ "42": record })
      .mockResolvedValueOnce({ "42": record });
    collectionDelete.mockResolvedValue();

    await expect(removeTournamentPrepAndDatabases("42")).resolves.toEqual({
      databasesDeleted: 1,
    });

    expect(collectionDelete).toHaveBeenCalledWith(17);
    expect(saveTournamentPreps).toHaveBeenCalledWith({});
    expect(collectionDelete.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(saveTournamentPreps).mock.invocationCallOrder[0],
    );
  });

  test("keeps the tracker when a database cannot be deleted", async () => {
    const record = createTournamentPrepRecord(SNAPSHOT, 1, 2022);
    record.opponents["2"].collectionId = 17;
    vi.mocked(loadTournamentPreps).mockResolvedValue({ "42": record });
    collectionDelete.mockRejectedValue(new Error("database is busy"));

    await expect(removeTournamentPrepAndDatabases("42")).rejects.toThrow("database is busy");
    expect(saveTournamentPreps).not.toHaveBeenCalled();
  });
});

describe("tracking-only tournament refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("retains a failed background check until retry, then replaces it with the current outcome", async () => {
    const record=createTournamentPrepRecord(SNAPSHOT,1,2022);
    vi.mocked(loadTournamentPreps).mockResolvedValue({"42":record});
    fetchTournamentSnapshot.mockRejectedValueOnce(new Error("Pairing website unavailable"));
    await expect(runTournamentPrepSync("42","roster")).rejects.toThrow("Pairing website unavailable");
    expect(latestTournamentSyncEvent("42")).toMatchObject({phase:"error",message:"Pairing website unavailable"});
    let finish!: (snapshot: TournamentSnapshot) => void;
    fetchTournamentSnapshot.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
    const retry=runTournamentPrepSync("42","roster");
    expect(latestTournamentSyncEvent("42")?.phase).toBe("queued");
    await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));
    expect(latestTournamentSyncEvent("42")?.phase).toBe("roster");
    finish(SNAPSHOT);await retry;
    expect(latestTournamentSyncEvent("42")?.phase).toBe("complete");
    await stopFollowingTournament("42");
    expect(latestTournamentSyncEvent("42")).toBeNull();
  });

  test("updates the roster without opening or importing player databases", async () => {
    const record = createTournamentPrepRecord(SNAPSHOT, 1, 2022);
    vi.mocked(loadTournamentPreps).mockResolvedValue({ "42": record });
    fetchTournamentSnapshot.mockResolvedValue(SNAPSHOT);

    await expect(runTournamentPrepSync("42", "roster")).resolves.toMatchObject({
      databasesUpdated: 0,
      failures: 0,
      stopped: false,
    });

    expect(fetchTournamentSnapshot).toHaveBeenCalledWith(record.url);
    expect(collectionList).not.toHaveBeenCalled();
    expect(saveTournamentPreps).toHaveBeenCalledTimes(1);
  });

  test("imports only the opponent selected from the Prep action", async () => {
    const snapshot: TournamentSnapshot = {
      ...SNAPSHOT,
      players: [
        ...SNAPSHOT.players,
        {
          startNumber: 3,
          name: "Clark, Cara",
          fideId: "789",
          federation: "SCO",
          title: null,
          rating: 1950,
          rank: 3,
          points: 0,
          active: true,
        },
      ],
    };
    const record = createTournamentPrepRecord(snapshot, 1, 2022);
    vi.mocked(loadTournamentPreps).mockResolvedValue({ "42": record });
    fetchTournamentSnapshot.mockResolvedValue(snapshot);
    collectionList.mockResolvedValue([]);
    collectionCreate.mockResolvedValue(99);
    collectionSetFolder.mockResolvedValue(undefined);
    collectionSetDescription.mockResolvedValue(undefined);
    importOpponent.mockResolvedValue({
      collectionId:99,gameCount:0,fromYear:2022,
      playerName: "Baker, Bob",
      fideId: "456",
      outputPath: "C:/cache/baker.pgn",
      cancelled: false,
      gamesFound: 0,
      duplicatesRemoved: 0,
      suspectedOnlineGamesExcluded: 0,
      identityMismatchesExcluded: 0,
      newestGame: null,
      sources: [],
    });

    await expect(runTournamentPrepSync("42", "player", 2)).resolves.toMatchObject({
      databasesUpdated: 1,
      failures: 0,
    });

    expect(collectionCreate).toHaveBeenCalledTimes(1);
    expect(importOpponent).toHaveBeenCalledTimes(1);
    expect(importOpponent.mock.calls[0]?.[0]).toMatchObject({
      playerName: "Baker, Bob",
    });
    expect(libraryImportPgnStream).not.toHaveBeenCalled();
    const saved = vi.mocked(saveTournamentPreps).mock.calls.at(-1)?.[0]["42"];
    expect(saved?.opponents["2"].collectionId).toBe(99);
    expect(saved?.opponents["3"].collectionId).toBeNull();
  });

  test("a cancelled final opponent retains saved games and never automatically hands an old database to Prep", async () => {
    const record = createTournamentPrepRecord(SNAPSHOT, 1, 2022);
    record.opponents["2"].collectionId = 17;
    record.opponents["2"].status = "ready";
    record.opponents["2"].gameCount = 10;
    vi.mocked(loadTournamentPreps).mockImplementation(async () => ({ "42": record }));
    fetchTournamentSnapshot.mockResolvedValue(SNAPSHOT);
    collectionList.mockResolvedValue([{ id: 17, name: "Baker, Bob", folder: record.folder, game_count: 10 }]);
    importOpponent.mockResolvedValue({collectionId:17,playerName:"Baker, Bob",fideId:"456",fromYear:2022,cancelled:true,gameCount:10});

    await expect(prepareTournamentOpponent("42", 2)).rejects.toThrow("Opponent import stopped.");
    expect(libraryImportPgnStream).not.toHaveBeenCalled();
    const saved = vi.mocked(saveTournamentPreps).mock.calls.at(-1)?.[0]["42"];
    expect(saved?.opponents["2"].status).toBe("queued");
    expect(saved?.opponents["2"].collectionId).toBe(17);
    expect(saved?.lastDatabaseSyncAt).toBeNull();
  });
});


describe("following lifecycle", () => {
  test("waits for an in-flight roster refresh before unfollowing and keeps databases", async () => {
    vi.clearAllMocks();
    const record = createTournamentPrepRecord(SNAPSHOT, null, 2022);
    record.opponents["2"].collectionId = 17;
    let records = { "42": record };
    vi.mocked(loadTournamentPreps).mockImplementation(async () => records);
    vi.mocked(saveTournamentPreps).mockImplementation(async next => { records = next as typeof records; });
    let finish!: (snapshot: TournamentSnapshot) => void;
    fetchTournamentSnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refresh = runTournamentPrepSync("42", "roster");
    await vi.waitFor(() => expect(fetchTournamentSnapshot).toHaveBeenCalledOnce());
    const stop = stopFollowingTournament("42");
    finish(SNAPSHOT);
    await expect(refresh).resolves.toMatchObject({ stopped: true });
    await stop;
    expect(records).toEqual({});
    expect(collectionDelete).not.toHaveBeenCalled();
    expect(collectOtbGames).not.toHaveBeenCalled();
  });

  test("roster refresh uses an entry choice saved while the request was loading", async () => {
    vi.clearAllMocks();
    const record = createTournamentPrepRecord(SNAPSHOT, null, 2022);
    let records = { "42": record };
    vi.mocked(loadTournamentPreps).mockImplementation(async () => records);
    vi.mocked(saveTournamentPreps).mockImplementation(async next => { records = next as typeof records; });
    let finish!: (snapshot: TournamentSnapshot) => void;
    fetchTournamentSnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refresh = runTournamentPrepSync("42", "roster");
    await vi.waitFor(() => expect(fetchTournamentSnapshot).toHaveBeenCalledOnce());
    records["42"] = { ...record, userStartNumber: 1, userName: "Able, Alice", userFideId: "123", autoUpdate: false, seenPlayerKeys: ["fide:123"] };
    finish(SNAPSHOT);
    await refresh;
    expect(records["42"]).toMatchObject({ userStartNumber: 1, autoUpdate: false, seenPlayerKeys: ["fide:123"] });
    expect(collectionCreate).not.toHaveBeenCalled();
  });
});
