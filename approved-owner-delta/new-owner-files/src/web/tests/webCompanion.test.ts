import { describe, expect, test } from "vitest";
import {
    filterWebDatabasesByHostedAvailability,
    filterWebSourceDatabases,
    getWebDatabaseHostedPathFromSourceStorageValue,
    getWebDatabaseHostedSourceStorageValue,
    getWebDatabaseSourceStorageValue,
    getReusableHostedDatabaseImport,
    mergeImportedWebDatabases,
    needsHostedDatabaseRefresh,
    resolveWebDatabaseSourceId,
} from "@/web/databaseSync";
import { getWebBoardSourceTitle } from "@/web/boardTitle";
import { formatWebEngineScore, normalizeWebEngineScoreForWhite } from "@/web/engineScore";
import { buildWebExplorerUrl } from "@/web/explorer";
import {
    getHostedDatabaseFolders,
    getHostedDirectPgnFilesInPath,
    getHostedPgnFilesInPath,
    listHostedLibraryPath,
    readHostedPgnFolder,
    type WebHostedLibrary,
} from "@/web/hostedFiles";
import { getWebOnlineImportTitle, getWebOnlineRangeLabel } from "@/web/onlineImport";
import {
    findFirstWebPrepOpponentBranch,
    findWebPrepBranchStart,
    filterWebGamesByLocalFilters,
    getFirstOpenPrepStat,
    getDatabasePlayerCounts,
    getWebDatabaseGamesForPosition,
    getWebDatabaseMoveStats,
    getWebHostedPositionMoveStats,
    getWebDatabaseTitlePlayerName,
    getGamesForWebPrepSource,
    getNextOpenPrepStat,
    getWebPrepBranchCoverageStats,
    getWebPrepMoveKey,
    getWebPrepMoveStats,
    getWebPrepStrengthSideForFen,
    sortWebDatabaseMoveStats,
} from "@/web/prepIndex";
import {
    applyWebPrepModeChange,
    applyWebPrepSourceChange,
    getWebPrepSelectedLocalSourceId,
    getWebPrepWorkspacePatchFromSelection,
    getWebPrepWorkspaceName,
    normalizeWebPrepMoveSortDefaults,
    type WebPrepSetupSelection,
} from "@/web/prepSettings";
import { getWebMovePanelBranchLine, getWebMovePanelDisplayLines } from "@/web/movePanel";
import {
    countWebGameVariationMoves,
    parsePgnDatabase,
    webGameToLine,
    webGameToRootLines,
} from "@/web/pgn";
import { createEmptyWebState } from "@/web/storage";

describe("web companion PGN prep index", () => {
    test("normalizes phone Stockfish evals to White perspective", () => {
        expect(formatWebEngineScore({ type: "cp", value: 35 })).toBe("+0.35");
        expect(
            formatWebEngineScore(
                normalizeWebEngineScoreForWhite({ type: "cp", value: 35 }, "black"),
            ),
        ).toBe("-0.35");
        expect(
            formatWebEngineScore(
                normalizeWebEngineScoreForWhite({ type: "mate", value: 3 }, "black"),
            ),
        ).toBe("-M3");
    });

    test("keeps PGN annotations and comments for phone game files", () => {
        const imported = parsePgnDatabase(
            "annotated-game.pgn",
            `
[Event "Annotated"]
[Site "?"]
[Date "2026.06.11"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "*"]

{Opening note}
1. e4! {Take the center [%clk 0:09:58]} e5?! {This is the line to review}
2. Nf3 $3 *
`,
            1,
        );
        const game = imported.games[0];
        const line = webGameToLine(game);

        expect(game.comments).toEqual(["Opening note"]);
        expect(game.moves[0]).toMatchObject({
            san: "e4",
            annotations: ["!"],
            comments: ["Take the center"],
        });
        expect(game.moves[1]).toMatchObject({
            san: "e5",
            annotations: ["?!"],
            comments: ["This is the line to review"],
        });
        expect(game.moves[2]).toMatchObject({
            san: "Nf3",
            annotations: ["!!"],
        });
        expect(line[0]).toMatchObject({
            san: "e4",
            annotations: ["!"],
            comments: ["Take the center"],
        });
        expect(game.pgn).toContain("Take the center [%clk 0:09:58]");
    });

    test("uses the file title for the phone board source title", () => {
        const imported = parsePgnDatabase(
            "opening-notes.pgn",
            `
[Event "Training game"]
[Site "?"]
[Date "2026.06.12"]
[Round "?"]
[White "White Player"]
[Black "Black Player"]
[Result "*"]

1. e4 *
`,
            1,
        );
        const game = imported.games[0];

        expect(getWebBoardSourceTitle(game, [imported.database])).toBe("opening-notes.pgn");
        expect(getWebBoardSourceTitle(game, [])).toBe("opening-notes.pgn");
    });

    test("keeps PGN variations visible and indexed for phone game files", () => {
        const imported = parsePgnDatabase(
            "variation-game.pgn",
            `
[Event "Variation tree"]
[Site "?"]
[Date "2026.06.12"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "*"]

1. e4! (1. d4!? {Queen pawn branch} d5) e5 (1... c5 {Sicilian branch} 2. Nf3 $5) 2. Nf3 *
`,
            1,
        );
        const game = imported.games[0];
        const line = webGameToLine(game);
        const initialStats = getWebDatabaseMoveStats({
            games: imported.games,
            fen: game.moves[0].fenBefore,
        });
        const afterE4Stats = getWebDatabaseMoveStats({
            games: imported.games,
            fen: game.moves[0].fenAfter,
        });

        expect(game.moves.map((move) => move.san)).toEqual(["e4", "e5", "Nf3"]);
        expect(game.rootVariations?.[0].map((move) => move.san)).toEqual(["d4", "d5"]);
        expect(game.rootVariations?.[0][0]).toMatchObject({
            annotations: ["!?"],
            comments: ["Queen pawn branch"],
        });
        expect(game.moves[0].variations?.[0].map((move) => move.san)).toEqual(["c5", "Nf3"]);
        expect(game.moves[0].variations?.[0][0]).toMatchObject({
            comments: ["Sicilian branch"],
        });
        expect(game.moves[0].variations?.[0][1]).toMatchObject({
            annotations: ["!?"],
        });
        expect(line[0].variations?.[0][0]).toMatchObject({
            san: "c5",
            comments: ["Sicilian branch"],
        });
        expect(countWebGameVariationMoves(game)).toBe(4);
        expect(initialStats.map((stat) => stat.move).sort()).toEqual(["d4", "e4"]);
        expect(afterE4Stats.map((stat) => stat.move).sort()).toEqual(["c5", "e5"]);
    });

    test("keeps the source mainline visible after selecting a phone variation", () => {
        const imported = parsePgnDatabase(
            "variation-selection.pgn",
            `
[Event "Variation selection"]
[Site "?"]
[Date "2026.06.12"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "*"]

1. e4 (1. d4 d5) e5 (1... c5 2. Nf3) 2. Nf3 *
`,
            1,
        );
        const game = imported.games[0];
        const rootLines = webGameToRootLines(game);
        const selectedVariationLine = getWebMovePanelBranchLine(
            [rootLines[0][0]],
            rootLines[0][0].variations?.[0] ?? [],
        );
        const displayLines = getWebMovePanelDisplayLines(selectedVariationLine, rootLines);

        expect(selectedVariationLine.map((move) => move.san)).toEqual(["e4", "c5", "Nf3"]);
        expect(displayLines[0].map((move) => move.san)).toEqual(["e4", "e5", "Nf3"]);
        expect(displayLines[0][0].variations?.[0].map((move) => move.san)).toEqual(["c5", "Nf3"]);
        expect(displayLines[1].map((move) => move.san)).toEqual(["d4", "d5"]);
    });

    test("builds Lichess All explorer URLs with desktop-style filters", () => {
        const url = new URL(
            buildWebExplorerUrl({
                source: "lichess-all",
                fen: "startpos",
                options: {
                    lichess: {
                        speeds: ["rapid"],
                        ratings: [2000],
                        since: "2026-01",
                        until: "2026-06",
                        player: "IfanRJ",
                        color: "black",
                        moves: 18,
                    },
                },
            }),
        );

        expect(url.pathname).toBe("/player");
        expect(url.searchParams.get("fen")).toBe("startpos");
        expect(url.searchParams.get("player")).toBe("IfanRJ");
        expect(url.searchParams.get("color")).toBe("black");
        expect(url.searchParams.get("speeds")).toBe("rapid");
        expect(url.searchParams.get("ratings")).toBe("2000");
        expect(url.searchParams.get("since")).toBe("2026-01");
        expect(url.searchParams.get("until")).toBe("2026-06");
        expect(url.searchParams.get("moves")).toBe("18");
    });

    test("builds Masters explorer URLs with saved date filters", () => {
        const url = new URL(
            buildWebExplorerUrl({
                source: "lichess-masters",
                fen: "startpos",
                options: {
                    masters: {
                        since: "2018",
                        until: "2025",
                        moves: 16,
                    },
                },
            }),
        );

        expect(url.pathname).toBe("/masters");
        expect(url.searchParams.get("fen")).toBe("startpos");
        expect(url.searchParams.get("since")).toBe("2018");
        expect(url.searchParams.get("until")).toBe("2025");
        expect(url.searchParams.get("moves")).toBe("16");
    });

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

    test("scores phone prep opponent moves from the opponent side at move one", () => {
        const imported = parsePgnDatabase(
            "sebastian-prep.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Sebastian443"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Sebastian443"]
[Black "Me"]
[Result "0-1"]

1. d4 d5 0-1
`,
            1,
        );

        const startFen = imported.games[0].moves[0].fenBefore;
        expect(getWebPrepStrengthSideForFen(startFen, "black")).toBe("white");

        const stats = getWebPrepMoveStats({
            games: imported.games,
            fen: startFen,
            prep: {
                mode: "player",
                opponent: "Sebastian443",
                userColor: "black",
                sourceIds: [imported.database.id],
                builder: { mode: "engine", useCloudEngine: true, maxEngineCpLoss: 70 },
            },
            engineMoves: [
                { san: "e4", scoreCpForSide: 35, rank: 1, source: "lichess" },
                { san: "d4", scoreCpForSide: 20, rank: 2, source: "lichess" },
            ],
        });
        const e4 = stats.find((stat) => stat.move === "e4");
        const d4 = stats.find((stat) => stat.move === "d4");

        expect(e4?.sourceLabel).toBe("opponent move");
        expect(e4?.scoreForUser).toBe(0);
        expect(e4?.strength?.engineCpLoss).toBe(0);
        expect(e4?.strength?.databaseWdlLoss).toBe(0);
        expect(d4?.strength?.engineCpLoss).toBe(15);
        expect(d4?.strength?.databaseWdlLoss).toBeGreaterThan(0);
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

    test("filters phone database stats by local player colour like the desktop panel", () => {
        const imported = parsePgnDatabase(
            "database-filter.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Me"]
[Black "Target"]
[Result "0-1"]

1. d4 d5 0-1
`,
            1,
        );

        const targetAsWhite = getWebDatabaseMoveStats({
            games: imported.games,
            fen: imported.games[0].moves[0].fenBefore,
            perspective: {
                playerName: "Target",
                color: "white",
            },
        });
        const targetAsBlack = getWebDatabaseMoveStats({
            games: imported.games,
            fen: imported.games[0].moves[0].fenBefore,
            perspective: {
                playerName: "Target",
                color: "black",
            },
        });

        expect(targetAsWhite.map((stat) => stat.move)).toEqual(["e4"]);
        expect(targetAsWhite[0].scoreForUser).toBe(1);
        expect(targetAsWhite[0].sourceLabel).toBe("Target as white");
        expect(targetAsBlack.map((stat) => stat.move)).toEqual(["d4"]);
        expect(targetAsBlack[0].scoreForUser).toBe(1);
        expect(targetAsBlack[0].sourceLabel).toBe("Target as black");
    });

    test("keeps phone database stats unfiltered when no local player is selected", () => {
        const imported = parsePgnDatabase(
            "database-all.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Me"]
[Black "Target"]
[Result "0-1"]

1. d4 d5 0-1
`,
            1,
        );

        const stats = getWebDatabaseMoveStats({
            games: imported.games,
            fen: imported.games[0].moves[0].fenBefore,
        });

        expect(stats.map((stat) => stat.move).sort()).toEqual(["d4", "e4"]);
        expect(stats.every((stat) => stat.sourceLabel === "database move")).toBe(true);
    });

    test("sorts phone database stats with the visible stats sort control", () => {
        const imported = parsePgnDatabase(
            "database-sort.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "1-0"]

1. e4 e5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.03"]
[Round "?"]
[White "Me"]
[Black "Target"]
[Result "0-1"]

1. d4 d5 0-1
`,
            1,
        );

        const stats = getWebDatabaseMoveStats({
            games: imported.games,
            fen: imported.games[0].moves[0].fenBefore,
        });

        expect(sortWebDatabaseMoveStats(stats, "games").map((stat) => stat.move)).toEqual([
            "e4",
            "d4",
        ]);
        expect(sortWebDatabaseMoveStats(stats, "recent").map((stat) => stat.move)).toEqual([
            "d4",
            "e4",
        ]);
        expect(sortWebDatabaseMoveStats(stats, "move").map((stat) => stat.move)).toEqual([
            "d4",
            "e4",
        ]);
    });

    test("computes fork-style blended strength measures for phone database stats", () => {
        const imported = parsePgnDatabase(
            "database-strength.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "0-1"]

1. d4 d5 0-1
`,
            1,
        );

        const stats = getWebDatabaseMoveStats({
            games: imported.games,
            fen: imported.games[0].moves[0].fenBefore,
            strengthSettings: {
                mode: "practical",
                engineWeight: 0,
                maxEngineCpLoss: 70,
            },
        });
        const e4 = stats.find((stat) => stat.move === "e4");
        const d4 = stats.find((stat) => stat.move === "d4");

        expect(e4?.strength?.score).toBeGreaterThan(d4?.strength?.score ?? 0);
        expect(e4?.strength?.databaseWdlLoss).toBe(0);
        expect(d4?.strength?.databaseWdlLoss).toBeGreaterThan(0);
        expect(sortWebDatabaseMoveStats(stats, "strengthHigh").map((stat) => stat.move)).toEqual([
            "e4",
            "d4",
        ]);
        expect(sortWebDatabaseMoveStats(stats, "wdlLow").map((stat) => stat.move)).toEqual([
            "d4",
            "e4",
        ]);
    });

    test("uses browser cloud-eval engine moves for phone blended strength", () => {
        const imported = parsePgnDatabase(
            "database-cloud-strength.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "0-1"]

1. d4 d5 0-1
`,
            1,
        );

        const stats = getWebDatabaseMoveStats({
            games: imported.games,
            fen: imported.games[0].moves[0].fenBefore,
            strengthSettings: {
                mode: "smart",
                engineWeight: 80,
                maxEngineCpLoss: 70,
            },
            engineMoves: [
                { san: "d4", scoreCpForSide: 45, rank: 1, source: "lichess" },
                { san: "e4", scoreCpForSide: 5, rank: 2, source: "lichess" },
            ],
        });
        const d4 = stats.find((stat) => stat.move === "d4");
        const e4 = stats.find((stat) => stat.move === "e4");

        expect(d4?.strength?.engineCpLoss).toBe(0);
        expect(d4?.strength?.detail).toContain("Engine best");
        expect(e4?.strength?.engineCpLoss).toBe(40);
        expect(sortWebDatabaseMoveStats(stats, "engineHigh").map((stat) => stat.move)).toEqual([
            "d4",
            "e4",
        ]);
    });

    test("applies fork-style local date and result filters to database stats", () => {
        const imported = parsePgnDatabase(
            "database-date-result.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.05.30"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "0-1"]

1. d4 d5 0-1
`,
            1,
        );

        const stats = getWebDatabaseMoveStats({
            games: imported.games,
            fen: imported.games[0].moves[0].fenBefore,
            filters: {
                startDate: "2026-06-01",
                result: "blackwon",
            },
        });

        expect(stats.map((stat) => stat.move)).toEqual(["d4"]);
        expect(
            filterWebGamesByLocalFilters(imported.games, { endDate: "2026-05-31" }),
        ).toHaveLength(1);
    });

    test("lists filtered local database games that reach the current position", () => {
        const imported = parsePgnDatabase(
            "database-games.pgn",
            `
[Event "Older"]
[Site "?"]
[Date "2026.05.30"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Latest"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Target"]
[Black "Me"]
[Result "0-1"]

1. e4 e5 0-1

[Event "Other player"]
[Site "?"]
[Date "2026.06.03"]
[Round "?"]
[White "Someone"]
[Black "Me"]
[Result "0-1"]

1. e4 c6 0-1
`,
            1,
        );

        const afterE4 = imported.games[0].moves[0].fenAfter;
        const matches = getWebDatabaseGamesForPosition({
            games: imported.games,
            fen: afterE4,
            perspective: {
                playerName: "Target",
                color: "white",
            },
            filters: {
                startDate: "2026-06-01",
                result: "blackwon",
            },
        });

        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({
            ply: 1,
            nextMove: "e5",
            game: {
                event: "Latest",
                white: "Target",
                black: "Me",
            },
        });
    });

    test("applies fork-style local date and result filters to prep stats", () => {
        const imported = parsePgnDatabase(
            "prep-date-result.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.05.30"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
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
                mode: "player",
                opponent: "Opponent",
                userColor: "white",
                sourceIds: [imported.database.id],
                startDate: "2026-06-01",
                result: "blackwon",
            },
        });

        expect(stats.map((stat) => stat.move)).toEqual(["e5"]);
    });

    test("derives fork-style prep player names from local database labels", () => {
        const imported = parsePgnDatabase(
            "lachlan1415_lichess.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "lachlan1415"]
[Black "Me"]
[Result "1-0"]

1. e4 c5 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Me"]
[Black "lachlan1415"]
[Result "0-1"]

1. d4 d5 0-1
`,
            1,
        );

        const [mostCommon] = getDatabasePlayerCounts(imported.games);

        expect(mostCommon.name).toBe("lachlan1415");
        expect(getWebDatabaseTitlePlayerName("lachlan1415_lichess", mostCommon.name)).toBe(
            "lachlan1415",
        );
        expect(getWebDatabaseTitlePlayerName("Some other database", mostCommon.name)).toBeNull();
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

    test("local prep without a selected source does not silently use every database", () => {
        const imported = parsePgnDatabase(
            "all-databases-should-not-leak.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.03"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 c5 1-0
`,
            1,
        );

        expect(
            getGamesForWebPrepSource({
                gamesByDatabase: {
                    [imported.database.id]: imported.games,
                },
                prep: {
                    source: "local",
                    sourceIds: [],
                    temporarySource: null,
                },
            }),
        ).toEqual([]);
    });

    test("selects common and next open prep rows from the shown source", () => {
        const rows = [
            { key: "fen:c5", move: "c5" },
            { key: "fen:e5", move: "e5" },
            { key: "fen:d5", move: "d5" },
        ];

        expect(getFirstOpenPrepStat(rows, { "fen:c5": 1 })?.move).toBe("e5");
        expect(getNextOpenPrepStat(rows, { "fen:c5": 1, "fen:e5": 1 }, "fen:c5")?.move).toBe("d5");
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
            actor: move.color === "black" ? ("user" as const) : ("opponent" as const),
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
        expect(
            findFirstWebPrepOpponentBranch(line, opponentToMoveRoot?.branchPly ?? 0, "black"),
        ).toMatchObject({
            key: getWebPrepMoveKey(line[2].fenBefore, "Nf3"),
        });
    });

    test("roots phone prep common-move controls after the user's first move", () => {
        const imported = parsePgnDatabase(
            "white-prep-branch-start.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.04"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
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
            actor: move.color === "white" ? ("user" as const) : ("opponent" as const),
        }));

        const afterUserMove = findWebPrepBranchStart({
            line,
            rootPly: 0,
            rootFen: line[0].fenBefore,
            userColor: "white",
            currentPly: 1,
        });
        expect(afterUserMove).toMatchObject({
            branchPly: 1,
            activeBranch: null,
        });

        const afterOpponentMove = findWebPrepBranchStart({
            line,
            rootPly: 0,
            rootFen: line[0].fenBefore,
            userColor: "white",
            currentPly: 2,
        });
        expect(afterOpponentMove).toMatchObject({
            branchPly: 1,
            activeBranch: {
                key: getWebPrepMoveKey(line[1].fenBefore, "c5"),
            },
        });
    });

    test("computes phone prep branch coverage like the desktop Prep column", () => {
        const imported = parsePgnDatabase(
            "branch-coverage.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.04"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 1-0

[Event "Training"]
[Site "?"]
[Date "2026.06.05"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "0-1"]

1. e4 c5 2. Nf3 e6 0-1
`,
            1,
        );
        const line = imported.games[0].moves.slice(0, 3).map((move) => ({
            fenBefore: move.fenBefore,
            fenAfter: move.fenAfter,
            san: move.san,
            uci: move.uci,
            actor: move.color === "white" ? ("user" as const) : ("opponent" as const),
        }));
        const afterE4 = imported.games[0].moves[0].fenAfter;
        const branchRows = getWebPrepMoveStats({
            games: imported.games,
            fen: afterE4,
            prep: {
                mode: "player",
                opponent: "Opponent",
                userColor: "white",
                sourceIds: [imported.database.id],
            },
        });
        const c5 = branchRows.find((row) => row.move === "c5");
        expect(c5).toBeTruthy();

        const d6Key = getWebPrepMoveKey(imported.games[0].moves[3].fenBefore, "d6");
        const stats = getWebPrepBranchCoverageStats({
            line,
            branchPly: 1,
            row: c5!,
            games: imported.games,
            prep: {
                mode: "player",
                opponent: "Opponent",
                userColor: "white",
                sourceIds: [imported.database.id],
            },
            minGames: 1,
            moveLimit: 10,
            preparedMoves: { [d6Key]: 1 },
            startedMoveKeys: new Set(
                line.map((move) => getWebPrepMoveKey(move.fenBefore, move.san)),
            ),
        });

        expect(stats).toMatchObject({
            depthPly: 2,
            opponentPositions: 1,
            commonReplies: 2,
            preparedReplies: 1,
            startedReplies: 0,
        });
        expect(stats.replyCoverage).toBeCloseTo(0.5);
        expect(stats.label).not.toBe("No line");
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

    test("sorts hosted pinned folders and files before unpinned siblings", () => {
        const library: WebHostedLibrary = {
            available: true,
            manifest: {
                version: 1,
                generatedAt: "2026-06-12T12:00:00.000Z",
                sourceName: "EnCroissant",
                pinnedPaths: ["Prep/Pinned folder", "Prep/pinned file.pgn"],
                files: [
                    {
                        type: "file",
                        name: "regular folder game",
                        filename: "regular folder game.pgn",
                        extension: "pgn",
                        path: "Prep/Regular folder/regular folder game.pgn",
                        url: "files/Prep/Regular%20folder/regular%20folder%20game.pgn",
                        lastModified: 1,
                        sizeBytes: 10,
                    },
                    {
                        type: "file",
                        name: "pinned folder game",
                        filename: "pinned folder game.pgn",
                        extension: "pgn",
                        path: "Prep/Pinned folder/pinned folder game.pgn",
                        url: "files/Prep/Pinned%20folder/pinned%20folder%20game.pgn",
                        lastModified: 2,
                        sizeBytes: 20,
                    },
                    {
                        type: "file",
                        name: "regular file",
                        filename: "regular file.pgn",
                        extension: "pgn",
                        path: "Prep/regular file.pgn",
                        url: "files/Prep/regular%20file.pgn",
                        lastModified: 3,
                        sizeBytes: 30,
                    },
                    {
                        type: "file",
                        name: "pinned file",
                        filename: "pinned file.pgn",
                        extension: "pgn",
                        path: "Prep/pinned file.pgn",
                        url: "files/Prep/pinned%20file.pgn",
                        lastModified: 4,
                        sizeBytes: 40,
                    },
                ],
            },
        };

        const prep = listHostedLibraryPath(library, "Prep");

        expect(prep?.entries.map((entry) => [entry.name, Boolean(entry.pinned)])).toEqual([
            ["Pinned folder", true],
            ["pinned file", true],
            ["Regular folder", false],
            ["regular file", false],
        ]);
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

    test("filters stale indexed hosted databases after the current library loads", () => {
        const databases = [
            {
                id: "local",
                name: "Manual import",
                importedAt: 1,
                updatedAt: 1,
                gameCount: 1,
                sizeBytes: 100,
                latestDate: null,
                playerNames: [],
            },
            {
                id: "current-hosted",
                name: "loxty_chesscom",
                hostedPath: "Databases/Desktop/Online Games/Chess.com/loxty_chesscom",
                hostedUpdatedAt: 4,
                importedAt: 2,
                updatedAt: 2,
                gameCount: 2,
                sizeBytes: 200,
                latestDate: null,
                playerNames: [],
            },
            {
                id: "stale-hosted",
                name: "lachlan1415_lichess",
                hostedPath: "Databases/Fork/Online Games/Lichess/lachlan1415_lichess",
                hostedUpdatedAt: 3,
                importedAt: 3,
                updatedAt: 3,
                gameCount: 3,
                sizeBytes: 300,
                latestDate: null,
                playerNames: [],
            },
        ];
        const hostedFolders = [
            {
                path: "Databases/Desktop/Online Games/Chess.com/loxty_chesscom",
                name: "loxty_chesscom",
                label: "Desktop / Online Games / Chess.com / loxty_chesscom",
                fileCount: 1,
                sizeBytes: 200,
                lastModified: 4,
            },
        ];

        expect(
            filterWebDatabasesByHostedAvailability({
                databases,
                hostedFolders,
                hostedLibraryReady: false,
            }).map((database) => database.id),
        ).toEqual(["local", "current-hosted", "stale-hosted"]);
        expect(
            filterWebDatabasesByHostedAvailability({
                databases,
                hostedFolders,
                hostedLibraryReady: true,
            }).map((database) => database.id),
        ).toEqual(["local", "current-hosted"]);
    });

    test("keeps loose opened PGNs out of phone source pickers", () => {
        const databases = [
            {
                id: "opened-file",
                name: "recent-game.pgn",
                sourceKind: "opened-file" as const,
                hostedFilePath: "Games/recent-game.pgn",
                importedAt: 1,
                updatedAt: 1,
                gameCount: 1,
                sizeBytes: 100,
                latestDate: null,
                playerNames: [],
            },
            {
                id: "legacy-opened-file",
                name: "old-recent-game.pgn",
                importedAt: 2,
                updatedAt: 2,
                gameCount: 1,
                sizeBytes: 100,
                latestDate: null,
                playerNames: [],
            },
            {
                id: "saved-import",
                name: "Opponent Chess.com recent 25.pgn",
                sourceKind: "source" as const,
                importedAt: 3,
                updatedAt: 3,
                gameCount: 25,
                sizeBytes: 5000,
                latestDate: "2026.06.01",
                playerNames: ["Opponent"],
            },
            {
                id: "hosted-db",
                name: "prep-source.pgn",
                hostedPath: "Databases/Desktop/Prep/prep-source",
                importedAt: 4,
                updatedAt: 4,
                gameCount: 100,
                sizeBytes: 20000,
                latestDate: "2026.06.02",
                playerNames: [],
            },
        ];

        expect(filterWebSourceDatabases(databases).map((database) => database.id)).toEqual([
            "saved-import",
            "hosted-db",
        ]);
        expect(
            filterWebSourceDatabases(databases, ["legacy-opened-file"]).map(
                (database) => database.id,
            ),
        ).toEqual(["legacy-opened-file", "saved-import", "hosted-db"]);
    });

    test("reuses already indexed hosted databases before downloading synced PGNs", () => {
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

1. e4 c5 1-0
`,
            1,
        );
        imported.database.hostedPath = "Databases/Fork/Prep/Opponent";
        imported.database.hostedUpdatedAt = 10;

        const state = {
            ...createEmptyWebState(),
            databases: [imported.database],
            gamesByDatabase: {
                [imported.database.id]: imported.games,
            },
        };
        const hostedFiles = [
            {
                type: "file" as const,
                name: "game-001",
                filename: "game-001.pgn",
                extension: "pgn" as const,
                path: "Databases/Fork/Prep/Opponent/game-001.pgn",
                url: "files/Databases/Fork/Prep/Opponent/game-001.pgn",
                lastModified: 10,
                sizeBytes: 120,
            },
        ];

        const reusable = getReusableHostedDatabaseImport({
            state,
            hostedPath: "\\Databases\\Fork\\Prep\\Opponent\\",
            files: hostedFiles,
        });

        expect(reusable?.database.id).toBe(imported.database.id);
        expect(reusable?.games).toHaveLength(1);
        expect(
            getReusableHostedDatabaseImport({
                state,
                hostedPath: imported.database.hostedPath,
                files: [{ ...hostedFiles[0], lastModified: 11 }],
            }),
        ).toBeNull();
        expect(
            getReusableHostedDatabaseImport({
                state: {
                    ...state,
                    gamesByDatabase: {
                        [imported.database.id]: [],
                    },
                },
                hostedPath: imported.database.hostedPath,
                files: hostedFiles,
            }),
        ).toBeNull();
    });

    test("reports hosted folder PGN chunk progress while reading synced files", async () => {
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
                        path: "Databases/Fork/Prep/Opponent/chunk-001.pgn",
                        url: "files/chunk-001.pgn",
                        lastModified: 1,
                        sizeBytes: 100,
                    },
                    {
                        type: "file",
                        name: "chunk-002",
                        filename: "chunk-002.pgn",
                        extension: "pgn",
                        path: "Databases/Fork/Prep/Opponent/chunk-002.pgn",
                        url: "files/chunk-002.pgn",
                        lastModified: 2,
                        sizeBytes: 200,
                    },
                ],
            },
        };
        const originalFetch = globalThis.fetch;
        const progress: { loaded: number; total: number; currentFile: string | null }[] = [];
        globalThis.fetch = (async (url: RequestInfo | URL) => {
            const text = String(url).includes("chunk-001")
                ? '[Event "One"]\n\n1. e4 *'
                : '[Event "Two"]\n\n1. d4 *';
            return new Response(text);
        }) as typeof fetch;

        try {
            const folder = await readHostedPgnFolder(
                library,
                "Databases/Fork/Prep/Opponent",
                (event) => progress.push(event),
            );

            expect(folder.content).toContain('[Event "One"]');
            expect(folder.content).toContain('[Event "Two"]');
            expect(progress.map((event) => `${event.loaded}/${event.total}`)).toEqual([
                "0/2",
                "1/2",
                "2/2",
            ]);
            expect(progress.map((event) => event.currentFile)).toEqual([
                "chunk-001.pgn",
                "chunk-002.pgn",
                null,
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test("replaces stale hosted databases and rewires prep sources", () => {
        const oldImport = parsePgnDatabase(
            "synced-db.pgn",
            `
[Event "Old"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 c5 1-0
`,
            1,
        );
        oldImport.database.hostedPath = "Databases/Fork/Prep/Opponent";
        oldImport.database.hostedUpdatedAt = 10;

        const newImport = parsePgnDatabase(
            "synced-db.pgn",
            `
[Event "New"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 e5 1-0
`,
            2,
        );
        newImport.database.hostedPath = oldImport.database.hostedPath;
        newImport.database.hostedUpdatedAt = 20;

        const state = {
            ...createEmptyWebState(),
            databases: [oldImport.database],
            gamesByDatabase: {
                [oldImport.database.id]: oldImport.games,
            },
            prepWorkspaces: [
                {
                    id: "prep",
                    name: "Opponent prep",
                    opponent: "Opponent",
                    userColor: "white" as const,
                    source: "local" as const,
                    sourceIds: [oldImport.database.id],
                    startFen: oldImport.games[0].moves[0].fenBefore,
                    line: [],
                    notesByFen: {},
                    preparedMoves: {},
                    skippedMoves: {},
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
            board: {
                ...createEmptyWebState().board,
                sourceDatabaseId: oldImport.database.id,
            },
        };

        const merged = mergeImportedWebDatabases(state, [newImport]);

        expect(merged.databases.map((database) => database.id)).toEqual([newImport.database.id]);
        expect(merged.gamesByDatabase[oldImport.database.id]).toBeUndefined();
        expect(merged.gamesByDatabase[newImport.database.id]).toHaveLength(1);
        expect(merged.prepWorkspaces[0].sourceIds).toEqual([newImport.database.id]);
        expect(merged.board.sourceDatabaseId).toBe(newImport.database.id);
    });

    test("resolves persisted phone database selections by hosted path after reloads", () => {
        const oldImport = parsePgnDatabase(
            "synced-db.pgn",
            `
[Event "Old"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 c5 1-0
`,
            1,
        );
        oldImport.database.hostedPath = "Databases/Fork/Prep/Opponent";

        const newImport = parsePgnDatabase(
            "synced-db.pgn",
            `
[Event "New"]
[Site "?"]
[Date "2026.06.02"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 e5 1-0
`,
            2,
        );
        newImport.database.hostedPath = oldImport.database.hostedPath;

        const stored = getWebDatabaseSourceStorageValue(oldImport.database);

        expect(stored).toBe("hosted:Databases/Fork/Prep/Opponent");
        expect(getWebDatabaseHostedSourceStorageValue("\\Databases\\Fork\\Prep\\Opponent\\")).toBe(
            stored,
        );
        expect(getWebDatabaseHostedPathFromSourceStorageValue(stored)).toBe(
            "Databases/Fork/Prep/Opponent",
        );
        expect(getWebDatabaseHostedPathFromSourceStorageValue(oldImport.database.id)).toBeNull();
        expect(resolveWebDatabaseSourceId(stored, [newImport.database])).toBe(
            newImport.database.id,
        );
        expect(resolveWebDatabaseSourceId(oldImport.database.id, [oldImport.database])).toBe(
            oldImport.database.id,
        );
        expect(resolveWebDatabaseSourceId(stored, [])).toBeNull();
    });

    test("detects hosted database updates and missing indexed games", () => {
        const imported = parsePgnDatabase(
            "refresh-db.pgn",
            `
[Event "Training"]
[Site "?"]
[Date "2026.06.01"]
[Round "?"]
[White "Me"]
[Black "Opponent"]
[Result "1-0"]

1. e4 c5 1-0
`,
            1,
        );
        imported.database.hostedPath = "Databases/Fork/Prep/Opponent";
        imported.database.hostedUpdatedAt = 10;

        const hostedFolder = {
            path: imported.database.hostedPath,
            name: "Opponent",
            label: "Fork / Prep / Opponent",
            fileCount: 1,
            sizeBytes: 100,
            lastModified: 11,
        };

        expect(
            needsHostedDatabaseRefresh({
                database: imported.database,
                games: imported.games,
                hostedFolder,
            }),
        ).toBe(true);
        expect(
            needsHostedDatabaseRefresh({
                database: { ...imported.database, hostedUpdatedAt: 11 },
                games: [],
                hostedFolder,
            }),
        ).toBe(true);
        expect(
            needsHostedDatabaseRefresh({
                database: { ...imported.database, hostedUpdatedAt: 11, hostedLazy: true },
                games: [],
                hostedFolder,
            }),
        ).toBe(false);
        expect(
            needsHostedDatabaseRefresh({
                database: { ...imported.database, hostedUpdatedAt: 11 },
                games: imported.games,
                hostedFolder,
            }),
        ).toBe(false);
    });

    test("converts hosted position buckets into normal phone move stats", () => {
        const stats = getWebHostedPositionMoveStats({
            fen: "startpos",
            side: "white",
            moves: [
                { move: "e4", uci: "e2e4", white: 2, draw: 1, black: 1, lastPlayed: "2026.06.01" },
                { move: "d4", uci: "d2d4", white: 1, draw: 0, black: 0, lastPlayed: "2026.05.01" },
            ],
        });

        expect(stats[0]).toMatchObject({
            move: "e4",
            uci: "e2e4",
            total: 4,
            share: 0.8,
            scoreForUser: 0.625,
            sourceLabel: "database move",
        });
        expect(stats[1]).toMatchObject({
            move: "d4",
            total: 1,
            share: 0.2,
            scoreForUser: 1,
        });
    });

    test("matches desktop prep source flow when choosing Lichess explorer sources", () => {
        const selection: WebPrepSetupSelection = {
            mode: "player",
            source: "local",
            sourceId: "local-db",
            temporarySource: null,
            opponent: "Opponent",
            userColor: "black",
            firstLocalSourceId: "local-db",
        };

        const next = applyWebPrepSourceChange(selection, "lichess-all", null);

        expect(next).toMatchObject({
            mode: "general",
            source: "lichess-all",
            sourceId: null,
            temporarySource: null,
            opponent: "",
            userColor: "white",
        });
    });

    test("matches desktop prep mode flow when returning from General to Player", () => {
        const selection: WebPrepSetupSelection = {
            mode: "general",
            source: "lichess-masters",
            sourceId: null,
            temporarySource: null,
            opponent: "",
            userColor: "white",
            firstLocalSourceId: "local-db",
        };

        const next = applyWebPrepModeChange(selection, "player");

        expect(next).toMatchObject({
            mode: "player",
            source: "local",
            sourceId: "local-db",
            temporarySource: null,
            opponent: "",
            userColor: "white",
        });
    });

    test("normalizes fork-style prep move sort defaults for phone setup", () => {
        expect(
            normalizeWebPrepMoveSortDefaults({ opponent: "prep", candidate: "results" }),
        ).toEqual({
            opponent: "prep",
            candidate: "results",
        });
        expect(
            normalizeWebPrepMoveSortDefaults({
                opponent: "not-a-sort",
                candidate: "state",
            } as never),
        ).toEqual({
            opponent: "games",
            candidate: "strength",
        });
    });

    test("does not fall back to the first database for an active prep with no local source", () => {
        expect(
            getWebPrepSelectedLocalSourceId({
                selectedSource: "local",
                draftSourceId: "first-db",
                activePrep: {
                    sourceIds: [],
                },
            }),
        ).toBeNull();
        expect(
            getWebPrepSelectedLocalSourceId({
                selectedSource: "local",
                draftSourceId: "first-db",
                activePrep: null,
            }),
        ).toBe("first-db");
    });

    test("clears stale opponent names when changing the local prep database", () => {
        const selection: WebPrepSetupSelection = {
            mode: "player",
            source: "local",
            sourceId: "old-db",
            temporarySource: null,
            opponent: "Old Opponent",
            userColor: "white",
            firstLocalSourceId: "old-db",
        };

        expect(applyWebPrepSourceChange(selection, "local", "new-db")).toMatchObject({
            source: "local",
            sourceId: "new-db",
            opponent: "",
        });
        expect(applyWebPrepSourceChange(selection, "local", "old-db")).toMatchObject({
            source: "local",
            sourceId: "old-db",
            opponent: "Old Opponent",
        });
    });

    test("clears player-only workspace fields when an active prep switches online", () => {
        const selection = applyWebPrepSourceChange(
            {
                mode: "player",
                source: "local",
                sourceId: "local-db",
                temporarySource: null,
                opponent: "Opponent",
                userColor: "black",
                firstLocalSourceId: "local-db",
            },
            "lichess-masters",
            null,
        );
        const patch = getWebPrepWorkspacePatchFromSelection(
            {
                id: "prep",
                name: "Opponent prep",
                mode: "player",
                source: "local",
                opponent: "Opponent",
                userColor: "black",
                sourceIds: ["local-db"],
                startFen: "start",
                line: [],
                notesByFen: {},
                preparedMoves: {},
                createdAt: 1,
                updatedAt: 1,
            },
            selection,
        );

        expect(patch).toMatchObject({
            name: "General prep",
            mode: "general",
            source: "lichess-masters",
            sourceIds: [],
            temporarySource: null,
            opponent: "",
            userColor: "white",
        });
    });

    test("derives phone prep names from mode and opponent instead of stale saved labels", () => {
        expect(getWebPrepWorkspaceName({ mode: "general", opponent: "Opponent" })).toBe(
            "General prep",
        );
        expect(getWebPrepWorkspaceName({ mode: "player", opponent: "" })).toBe("Opponent prep");
        expect(getWebPrepWorkspaceName({ mode: "player", opponent: "Nakamura" })).toBe(
            "Nakamura prep",
        );
    });

    test("renames an active prep when returning from General explorer prep to Player", () => {
        const selection = applyWebPrepModeChange(
            {
                mode: "general",
                source: "lichess-all",
                sourceId: null,
                temporarySource: null,
                opponent: "",
                userColor: "white",
                firstLocalSourceId: "local-db",
            },
            "player",
        );
        const patch = getWebPrepWorkspacePatchFromSelection(
            {
                id: "prep",
                name: "General prep",
                mode: "general",
                source: "lichess-all",
                opponent: "",
                userColor: "white",
                sourceIds: [],
                startFen: "start",
                line: [],
                notesByFen: {},
                preparedMoves: {},
                createdAt: 1,
                updatedAt: 1,
            },
            selection,
        );

        expect(patch).toMatchObject({
            name: "Opponent prep",
            mode: "player",
            source: "local",
            sourceIds: ["local-db"],
        });
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
