import { afterEach, describe, expect, it, vi } from "vitest";
import {
    buildWebExplorerProxyUrl,
    buildWebLocalExplorerQuery,
    fetchWebExplorerMoveStats,
} from "../explorer";
import { fetchHostedDatabasePositionMoves } from "../hostedDatabaseIndex";
import {
    cancelWebOtbImport,
    getWebOtbProgressValue,
    loadWebOtbImportJob,
    startWebOtbImport,
    watchWebOtbImportJob,
    type WebOtbImportJob,
} from "../otbImport";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("phone data work offload", () => {
    it("builds the local PC query with the same Explorer filters", () => {
        expect(
            buildWebLocalExplorerQuery({
                source: "lichess-all",
                fen: INITIAL_FEN,
                options: {
                    lichess: {
                        speeds: ["rapid"],
                        ratings: [2000],
                        player: "IfanRJ",
                        color: "black",
                        moves: 18,
                    },
                },
            }),
        ).toMatchObject({
            source: "lichess-player",
            fen: INITIAL_FEN,
            speeds: ["rapid"],
            ratings: [2000],
            player: "IfanRJ",
            color: "black",
        });
    });

    it("builds a source-scoped local Masters query", () => {
        expect(
            buildWebLocalExplorerQuery({
                source: "lichess-masters",
                fen: INITIAL_FEN,
                options: { masters: { since: "2020", until: "2026", moves: 12 } },
            }),
        ).toEqual({
            source: "lichess-masters",
            fen: INITIAL_FEN,
            speeds: [],
            ratings: [],
            player: null,
            color: null,
            since: "2020",
            until: "2026",
            topGames: 0,
            recentGames: null,
        });
    });

    it("uses an authoritative local PC result without a phone token", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/v1/cloud-eval")) return { ok: false, status: 404 };
            if (url.includes("/api/lichess/opening")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        available: true,
                        white: 8,
                        draws: 1,
                        black: 1,
                        moves: [{ uci: "g1f3", san: "Nf3", white: 8, draws: 1, black: 1 }],
                    }),
                };
            }
            throw new Error(`Unexpected online request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const stats = await fetchWebExplorerMoveStats({
            source: "lichess-all",
            fen: "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1",
        });

        expect(stats.map((stat) => stat.move)).toEqual(["Nf3"]);
        expect(
            fetchMock.mock.calls.some(([input]) => String(input).includes("/api/lichess-explorer")),
        ).toBe(false);
        expect(
            fetchMock.mock.calls.some(([input]) =>
                String(input).startsWith("https://explorer.lichess.org"),
            ),
        ).toBe(false);
    });

    it("treats an empty local position as authoritative", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/v1/cloud-eval")) return { ok: false, status: 404 };
            if (url.includes("/api/lichess/opening")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        available: true,
                        white: 0,
                        draws: 0,
                        black: 0,
                        moves: [],
                    }),
                };
            }
            throw new Error(`Unexpected online request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            fetchWebExplorerMoveStats({
                source: "lichess-all",
                fen: "8/8/8/8/8/5k2/7P/6K1 w - - 0 50",
            }),
        ).resolves.toEqual([]);
        expect(
            fetchMock.mock.calls.some(([input]) => String(input).includes("/api/lichess-explorer")),
        ).toBe(false);
    });

    it("falls through only when the local source is unavailable", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/v1/cloud-eval")) return { ok: false, status: 404 };
            if (url.includes("/api/lichess/opening")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ available: false, moves: [] }),
                };
            }
            if (url.includes("/api/lichess-explorer")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        white: 3,
                        draws: 0,
                        black: 0,
                        moves: [{ uci: "b1c3", san: "Nc3", white: 3, draws: 0, black: 0 }],
                    }),
                };
            }
            throw new Error(`Unexpected direct request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const stats = await fetchWebExplorerMoveStats({
            source: "lichess-masters",
            fen: "rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/R1BQKBNR b KQkq - 1 1",
        });

        expect(stats.map((stat) => stat.move)).toEqual(["Nc3"]);
        expect(
            fetchMock.mock.calls.some(([input]) => String(input).includes("/api/lichess-explorer")),
        ).toBe(true);
    });

    it("fails closed when the PC reports an unreadable local snapshot", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/v1/cloud-eval")) return { ok: false, status: 404 };
            if (url.includes("/api/lichess/opening")) return { ok: false, status: 500 };
            throw new Error(`Unexpected fallback request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            fetchWebExplorerMoveStats({
                source: "lichess-all",
                fen: "rnbqkbnr/pppppppp/8/8/7N/8/PPPPPPPP/RNBQKB1R b KQkq - 1 1",
                token: "must-not-leak-online",
            }),
        ).rejects.toMatchObject({ status: 500 });
        expect(
            fetchMock.mock.calls.some(([input]) => String(input).includes("/api/lichess-explorer")),
        ).toBe(false);
        expect(
            fetchMock.mock.calls.some(([input]) =>
                String(input).startsWith("https://explorer.lichess.org"),
            ),
        ).toBe(false);
    });

    it("builds a private-PC explorer request with the desktop filters", () => {
        const url = new URL(
            buildWebExplorerProxyUrl({
                source: "lichess-all",
                fen: INITIAL_FEN,
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

        expect(url.origin).toBe("https://lox-pc.tail89d19b.ts.net");
        expect(url.pathname).toBe("/api/lichess-explorer");
        expect(url.searchParams.get("source")).toBe("lichess-all");
        expect(url.searchParams.get("player")).toBe("IfanRJ");
        expect(url.searchParams.get("color")).toBe("black");
        expect(url.searchParams.get("speeds")).toBe("rapid");
        expect(url.searchParams.get("ratings")).toBe("2000");
    });

    it("returns move statistics without waiting on delayed PC strength", async () => {
        let releaseStoredEvaluation!: (value: Response) => void;
        const storedEvaluation = new Promise<Response>((resolve) => {
            releaseStoredEvaluation = resolve;
        });
        const explorerData = {
            white: 100,
            draws: 40,
            black: 60,
            moves: [
                { uci: "e2e4", san: "e4", white: 60, draws: 20, black: 20 },
                { uci: "d2d4", san: "d4", white: 40, draws: 20, black: 40 },
            ],
        };
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/v1/cloud-eval")) return await storedEvaluation;
            if (url.includes("/api/lichess-explorer")) {
                return { ok: true, status: 200, json: async () => explorerData };
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);
        const startedAt = performance.now();
        const stats = await fetchWebExplorerMoveStats({
            source: "lichess-all",
            fen: INITIAL_FEN,
            token: "persistent-private-test-token",
            strengthSettings: { mode: "smart", engineWeight: 80 },
        });

        expect(stats.map((stat) => stat.move)).toEqual(["e4", "d4"]);
        expect(performance.now() - startedAt).toBeLessThan(250);
        expect(
            fetchMock.mock.calls.some(([input]) => String(input).includes("/api/lichess-explorer")),
        ).toBe(true);
        expect(
            fetchMock.mock.calls.some(([input]) =>
                String(input).startsWith("https://explorer.lichess.org"),
            ),
        ).toBe(false);

        releaseStoredEvaluation({
            ok: true,
            status: 200,
            json: async () => ({
                fen: INITIAL_FEN,
                depth: 50,
                pvs: [
                    { moves: "e2e4 e7e5", cp: 30 },
                    { moves: "d2d4 d7d5", cp: 10 },
                ],
            }),
        } as Response);
    });

    it("falls back to Lichess only when the PC explorer is unavailable", async () => {
        const explorerData = {
            white: 10,
            draws: 5,
            black: 5,
            moves: [{ uci: "c2c4", san: "c4", white: 10, draws: 5, black: 5 }],
        };
        let directHeaders: HeadersInit | undefined;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("/v1/cloud-eval")) return { ok: false, status: 404 };
            if (url.includes("/api/lichess-explorer")) return { ok: false, status: 503 };
            if (url.startsWith("https://explorer.lichess.org")) {
                directHeaders = init?.headers;
                return { ok: true, status: 200, text: async () => JSON.stringify(explorerData) };
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const stats = await fetchWebExplorerMoveStats({
            source: "lichess-all",
            fen: "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1",
            token: "fallback-test-token",
        });

        expect(stats.map((stat) => stat.move)).toEqual(["c4"]);
        expect(
            fetchMock.mock.calls.some(([input]) =>
                String(input).startsWith("https://explorer.lichess.org"),
            ),
        ).toBe(true);
        expect(directHeaders).toEqual({ Authorization: "Bearer fallback-test-token" });
    });

    it("does not bypass a PC rate-limit response with a direct Lichess retry", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/v1/cloud-eval")) return { ok: false, status: 404 };
            if (url.includes("/api/lichess-explorer")) return { ok: false, status: 429 };
            throw new Error(`Unexpected direct retry: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            fetchWebExplorerMoveStats({
                source: "lichess-all",
                fen: "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1",
                token: "rate-limit-test-token",
            }),
        ).rejects.toMatchObject({ status: 429 });

        expect(
            fetchMock.mock.calls.some(([input]) =>
                String(input).startsWith("https://explorer.lichess.org"),
            ),
        ).toBe(false);
    });

    it("uses the PC database position endpoint and reuses the phone memory result", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [
                { move: "e4", white: 12, draw: 3, black: 5, lastPlayed: "2026.07.20" },
            ],
        });
        vi.stubGlobal("fetch", fetchMock);
        const request = {
            hostedPath: "Databases/Desktop/Test/private-offload",
            fen: INITIAL_FEN,
        };

        const first = await fetchHostedDatabasePositionMoves(request);
        const second = await fetchHostedDatabasePositionMoves(request);

        expect(first).toEqual(second);
        expect(first[0]).toMatchObject({ move: "e4", white: 12, draw: 3, black: 5 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/database-position?");
    });

    it("starts and polls OTB imports only through the private PC service", async () => {
        const job = {
            id: "otb-test",
            status: "running",
            request: {
                playerName: "Kodukula, Sameera",
                fideId: "343413994",
                fromYear: 2024,
                sources: {},
            },
            progress: null,
            games: [],
            createdAt: "2026-08-17T00:00:00Z",
            updatedAt: "2026-08-17T00:00:00Z",
            completedAt: null,
            error: null,
        };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => job,
        });
        vi.stubGlobal("fetch", fetchMock);

        await startWebOtbImport({
            playerName: "Kodukula, Sameera",
            fideId: "343413994",
            fromYear: 2024,
            sources: {
                lichessBroadcasts: true,
                broadcastArchives: false,
                communityBroadcasts: false,
                chessResults: true,
                chessbaseNews: true,
                officialPgnIndexes: true,
                twic: true,
            },
        });
        await loadWebOtbImportJob("otb-test");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/otb-import/jobs");
        expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/otb-import/jobs/otb-test");
        expect(
            fetchMock.mock.calls.every(([input]) => !String(input).includes("lichess.org")),
        ).toBe(true);
    });

    it("stops phone OTB imports through the PC and never paints a running job as complete", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ id: "otb-test", status: "failed" }),
        });
        vi.stubGlobal("fetch", fetchMock);

        await cancelWebOtbImport("otb-test");

        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
        expect(
            getWebOtbProgressValue(
                {
                    jobId: "otb-test",
                    source: "Chessscope",
                    phase: "done",
                    current: 1,
                    total: 1,
                    gamesFound: 7,
                    message: "Found 7 unique OTB games",
                    overallCurrent: 8,
                    overallTotal: 10,
                },
                true,
            ),
        ).toBe(80);
        expect(
            getWebOtbProgressValue(
                {
                    jobId: "otb-test",
                    source: "Chessscope",
                    phase: "done",
                    current: 1,
                    total: 1,
                    gamesFound: 7,
                    message: "Found 7 unique OTB games",
                },
                true,
            ),
        ).toBe(95);
    });

    it("shares one status poll and one completed artifact across phone subscribers", async () => {
        const jobId = "otb-shared-artifact";
        const status = {
            id: jobId,
            status: "completed",
            request: {
                playerName: "Player, Target",
                fideId: "12345678",
                fromYear: 2020,
                sources: {},
            },
            progress: null,
            report: {
                playerName: "Player, Target",
                fideId: "12345678",
                cancelled: false,
                gamesFound: 1,
                duplicatesRemoved: 0,
            },
            gameCount: 1,
            artifactAvailable: true,
            artifactBytes: 10_000_000,
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:05Z",
            completedAt: "2026-08-29T00:00:05Z",
            error: null,
        };
        const artifact = {
            jobId,
            games: [
                {
                    id: `${jobId}:1`,
                    pgn: '[Event "Open"]\n\n1. e4 e5 1-0',
                    event: "Open",
                    site: "",
                    date: "2026.08.29",
                    white: "Player, Target",
                    black: "Opponent",
                    result: "1-0",
                    whiteElo: 2400,
                    blackElo: 2300,
                },
            ],
            prepDatabase: null,
        };
        const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => ({
            ok: true,
            status: 200,
            json: async () => (String(input).endsWith("/artifact") ? artifact : status),
        }));
        vi.stubGlobal("fetch", fetchMock);

        let unsubscribeFirst: () => void = () => undefined;
        let unsubscribeSecond: () => void = () => undefined;
        const first = new Promise<WebOtbImportJob>((resolve) => {
            unsubscribeFirst = watchWebOtbImportJob(jobId, resolve);
        });
        const second = new Promise<WebOtbImportJob>((resolve) => {
            unsubscribeSecond = watchWebOtbImportJob(jobId, resolve);
        });
        const [firstJob, secondJob] = await Promise.all([first, second]);
        unsubscribeFirst();
        unsubscribeSecond();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/jobs/${jobId}`);
        expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`/jobs/${jobId}/artifact`);
        expect(firstJob.games).toEqual(artifact.games);
        expect(secondJob.prepDatabase).toBe(artifact.prepDatabase);
    });
});
