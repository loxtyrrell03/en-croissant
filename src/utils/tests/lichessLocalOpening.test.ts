import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    queryLocal: vi.fn(),
    status: vi.fn(),
    onlineFetch: vi.fn(),
}));

vi.mock("@/bindings", () => ({
    commands: {
        queryLocalLichessOpening: mocks.queryLocal,
        getLocalLichessOpeningDbStatus: mocks.status,
    },
}));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.onlineFetch }));

import { getLichessGames } from "@/utils/lichess/api";
import type { LichessGamesOptions } from "@/utils/lichess/explorer";
import { localExplorerFen } from "@/utils/lichess/localOpening";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const OPTIONS = {
    speeds: ["blitz"],
    ratings: [2000],
    color: "white",
    moves: 12,
} satisfies LichessGamesOptions;

function localResult(available: boolean) {
    return {
        available,
        white: BigInt(2),
        draws: BigInt(1),
        black: BigInt(0),
        moves: available
            ? [
                  {
                      san: "e4",
                      uci: "e2e4",
                      white: BigInt(2),
                      draws: BigInt(1),
                      black: BigInt(0),
                  },
              ]
            : [],
        opening: null,
        topGames: [],
        recentGames: [],
        coverage: available
            ? {
                  source: "lichess-all",
                  standardMonths: ["2026-07"],
                  mastersMonths: [],
                  maxPlies: 40,
              }
            : null,
        error: null,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(globalThis, { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
    delete (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__;
});

describe("local-first Lichess opening queries", () => {
    it("uses an authoritative local result without a token or network request", async () => {
        mocks.queryLocal.mockResolvedValue({ status: "ok", data: localResult(true) });

        const result = await getLichessGames(INITIAL_FEN, OPTIONS);

        expect(result.moves).toEqual([
            expect.objectContaining({ san: "e4", uci: "e2e4", white: 2, draws: 1, black: 0 }),
        ]);
        expect(mocks.onlineFetch).not.toHaveBeenCalled();
    });

    it("does not leak online when the installed snapshot cannot be read", async () => {
        mocks.queryLocal.mockResolvedValue({ status: "error", error: "bad sqlite header" });

        await expect(getLichessGames(INITIAL_FEN, OPTIONS, "linked-token")).rejects.toThrow(
            /could not be read/i,
        );
        expect(mocks.onlineFetch).not.toHaveBeenCalled();
    });

    it("requires a linked token when the local source is genuinely unavailable", async () => {
        mocks.queryLocal.mockResolvedValue({ status: "ok", data: localResult(false) });

        await expect(getLichessGames(INITIAL_FEN, OPTIONS)).rejects.toThrow(/Link Lichess/);
        expect(mocks.onlineFetch).not.toHaveBeenCalled();
    });

    it("uses the paced online fallback only after local unavailability", async () => {
        mocks.queryLocal.mockResolvedValue({ status: "ok", data: localResult(false) });
        mocks.onlineFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    white: 1,
                    draws: 0,
                    black: 0,
                    moves: [
                        {
                            san: "d4",
                            uci: "d2d4",
                            averageRating: 2100,
                            white: 1,
                            draws: 0,
                            black: 0,
                        },
                    ],
                }),
                { status: 200 },
            ),
        );

        const result = await getLichessGames(INITIAL_FEN, OPTIONS, "linked-token");

        expect(result.moves[0]?.san).toBe("d4");
        expect(mocks.queryLocal.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.onlineFetch.mock.invocationCallOrder[0]!,
        );
        expect(mocks.onlineFetch).toHaveBeenCalledTimes(1);
    });

    it("replays Explorer continuation moves before querying the local store", () => {
        expect(localExplorerFen(INITIAL_FEN, ["e2e4", "e7e5"])).toContain(
            "rnbqkbnr/pppp1ppp/8/4p3/4P3",
        );
    });
});
