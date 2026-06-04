import { describe, expect, test } from "vitest";
import {
  getHostedDatabaseFolders,
  getHostedDirectPgnFilesInPath,
  getHostedPgnFilesInPath,
  listHostedLibraryPath,
  type WebHostedLibrary,
} from "@/web/hostedFiles";
import { getWebOnlineImportTitle, getWebOnlineRangeLabel } from "@/web/onlineImport";
import {
  findFirstWebPrepOpponentBranch,
  findWebPrepBranchStart,
  getFirstOpenPrepStat,
  getGamesForWebPrepSource,
  getNextOpenPrepStat,
  getWebPrepMoveKey,
  getWebPrepMoveStats,
} from "@/web/prepIndex";
import { parsePgnDatabase } from "@/web/pgn";

describe("web companion PGN prep index", () => {
  test("indexes PGN games and returns opponent prep moves from a reached FEN", () => {
    const imported = parsePgnDatabase(
      "opponent.pgn",
      `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 0-1
`,
      1,
    );

    const afterE4 = imported.games[0].moves[0].fenAfter;
    const stats = getWebPrepMoveStats({
      games: imported.games,
      fen: afterE4,
      prep: {
        opponent: "Opponent",
        userColor: "white",
        sourceIds: [imported.database.id],
      },
    });

    expect(imported.database.gameCount).toBe(2);
    expect(stats.map((stat) => stat.move)).toEqual(["c5", "e5"]);
    expect(stats[0]).toMatchObject({
      move: "c5",
      total: 1,
      sourceLabel: "opponent move",
    });
    expect(stats[0].examples[0]).toMatchObject({
      white: "Me",
      black: "Opponent",
      date: "2026.06.01",
    });
  });

  test("general prep mode uses the database position without player filtering", () => {
    const imported = parsePgnDatabase(
      "general.pgn",
      `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Me"]
[Black "First Opponent"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Someone"]
[Black "Second Opponent"]
[Result "0-1"]

1. e4 e5 0-1
`,
      1,
    );

    const afterE4 = imported.games[0].moves[0].fenAfter;
    const stats = getWebPrepMoveStats({
      games: imported.games,
      fen: afterE4,
      prep: {
        mode: "general",
        opponent: "First Opponent",
        userColor: "white",
        sourceIds: [imported.database.id],
      },
    });

    expect(stats.map((stat) => stat.move)).toEqual(["c5", "e5"]);
  });

  test("unsaved prep imports are usable without joining the normal database list", () => {
    const imported = parsePgnDatabase(
      "temporary-prep.pgn",
      `
[Event "Training"]
[Site "?"]
[Date "2026.06.03"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 1-0
`,
      1,
    );

    const prep = {
      mode: "player" as const,
      source: "temporary" as const,
      opponent: "Opponent",
      userColor: "white" as const,
      sourceIds: [imported.database.id],
      temporarySource: {
        id: imported.database.id,
        name: imported.database.name,
        gameCount: imported.games.length,
        importedAt: imported.database.importedAt,
        updatedAt: imported.database.updatedAt,
        games: imported.games,
      },
    };
    const games = getGamesForWebPrepSource({
      gamesByDatabase: {},
      prep,
    });
    const afterE4 = imported.games[0].moves[0].fenAfter;
    const stats = getWebPrepMoveStats({
      games,
      fen: afterE4,
      prep,
    });

    expect(games).toHaveLength(1);
    expect(stats.map((stat) => stat.move)).toEqual(["c5"]);
  });

  test("selects common and next open prep rows from the shown source", () => {
    const rows = [
      { key: "fen:c5", move: "c5" },
      { key: "fen:e5", move: "e5" },
      { key: "fen:d5", move: "d5" },
    ];

    expect(getFirstOpenPrepStat(rows, { "fen:c5": 1 })?.move).toBe("e5");
    expect(getNextOpenPrepStat(rows, { "fen:c5": 1, "fen:e5": 1 }, "fen:c5")?.move).toBe(
      "d5",
    );
    expect(getNextOpenPrepStat(rows, { "fen:c5": 1, "fen:e5": 1, "fen:d5": 1 }, "fen:c5")).toBe(
      null,
    );
  });

  test("finds the desktop-equivalent prep branch start in a phone line", () => {
    const imported = parsePgnDatabase(
      "branch-start.pgn",
      `
[Event "Training"]
[Site "?"]
[Date "2026.06.04"]
[Round "?"]
[White "Opponent"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 1-0
`,
      1,
    );
    const line = imported.games[0].moves.map((move) => ({
      fenBefore: move.fenBefore,
      fenAfter: move.fenAfter,
      san: move.san,
      uci: move.uci,
      actor: move.color === "black" ? "user" as const : "opponent" as const,
    }));

    const afterOpponentMove = findWebPrepBranchStart({
      line,
      rootPly: 1,
      rootFen: line[0].fenAfter,
      userColor: "black",
    });
    expect(afterOpponentMove).toMatchObject({
      branchPly: 0,
      activeBranch: {
        key: getWebPrepMoveKey(line[0].fenBefore, "e4"),
      },
    });

    const opponentToMoveRoot = findWebPrepBranchStart({
      line,
      rootPly: 2,
      rootFen: line[1].fenAfter,
      userColor: "black",
    });
    expect(opponentToMoveRoot).toMatchObject({
      branchPly: 2,
      activeBranch: null,
    });
    expect(findFirstWebPrepOpponentBranch(line, opponentToMoveRoot?.branchPly ?? 0, "black"))
      .toMatchObject({
        key: getWebPrepMoveKey(line[2].fenBefore, "Nf3"),
      });
  });

  test("lists hosted web-library folders without requiring a laptop bridge", () => {
    const library: WebHostedLibrary = {
      available: true,
      manifest: {
        version: 1,
        generatedAt: "2026-06-03T12:00:00.000Z",
        sourceName: "EnCroissant",
        files: [
          {
            type: "file",
            name: "game one",
            filename: "game one.pgn",
            extension: "pgn",
            path: "Prep/Opponent/game one.pgn",
            url: "files/Prep/Opponent/game%20one.pgn",
            lastModified: 1,
            sizeBytes: 10,
          },
          {
            type: "file",
            name: "report",
            filename: "report.pdf",
            extension: "pdf",
            path: "Prep/report.pdf",
            url: "files/Prep/report.pdf",
            lastModified: 2,
            sizeBytes: 20,
          },
        ],
      },
    };

    const root = listHostedLibraryPath(library, "");
    const prep = listHostedLibraryPath(library, "Prep");

    expect(root?.entries.map((entry) => entry.name)).toEqual(["Prep"]);
    expect(prep?.entries.map((entry) => entry.name)).toEqual(["Opponent", "report"]);
    expect(prep?.parentPath).toBe("");
    expect(getHostedPgnFilesInPath(library, "Prep")).toHaveLength(1);
  });

  test("identifies synced database folders without treating broad parents as direct databases", () => {
    const library: WebHostedLibrary = {
      available: true,
      manifest: {
        version: 1,
        generatedAt: "2026-06-03T12:00:00.000Z",
        sourceName: "EnCroissant",
        files: [
          {
            type: "file",
            name: "chunk-001",
            filename: "chunk-001.pgn",
            extension: "pgn",
            path: "Databases/Fork/Online Games/Chess.com/loxty_chesscom/chunk-001.pgn",
            url: "files/Databases/Fork/Online%20Games/Chess.com/loxty_chesscom/chunk-001.pgn",
            lastModified: 3,
            sizeBytes: 1024,
          },
          {
            type: "file",
            name: "chunk-002",
            filename: "chunk-002.pgn",
            extension: "pgn",
            path: "Databases/Fork/Online Games/Chess.com/loxty_chesscom/chunk-002.pgn",
            url: "files/Databases/Fork/Online%20Games/Chess.com/loxty_chesscom/chunk-002.pgn",
            lastModified: 4,
            sizeBytes: 2048,
          },
        ],
      },
    };

    const root = listHostedLibraryPath(library, "Databases/Fork/Online Games/Chess.com");
    const databaseFolders = getHostedDatabaseFolders(library);

    expect(root?.entries[0]).toMatchObject({
      name: "loxty_chesscom",
      directPgnFileCount: 2,
      pgnFileCount: 2,
    });
    expect(getHostedDirectPgnFilesInPath(library, "Databases/Fork")).toHaveLength(0);
    expect(databaseFolders).toEqual([
      expect.objectContaining({
        path: "Databases/Fork/Online Games/Chess.com/loxty_chesscom",
        label: "Fork / Online Games / Chess.com / loxty_chesscom",
        fileCount: 2,
        sizeBytes: 3072,
      }),
    ]);
  });

  test("labels web online imports like prep databases", () => {
    expect(
      getWebOnlineImportTitle({
        source: "chesscom",
        username: "Opponent",
        mode: "count",
        count: 25,
        range: "3m",
      }),
    ).toBe("Opponent Chess.com recent 25");
    expect(getWebOnlineRangeLabel("1y")).toBe("Last year");
  });
});
