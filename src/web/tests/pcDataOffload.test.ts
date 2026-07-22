import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWebExplorerProxyUrl,
  fetchWebExplorerMoveStats,
} from "../explorer";
import { fetchHostedDatabasePositionMoves } from "../hostedDatabaseIndex";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("phone data work offload", () => {
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

    expect(url.origin).toBe("https://gaming-pc.tail89d19b.ts.net");
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
      fetchMock.mock.calls.some(([input]) => String(input).startsWith("https://explorer.lichess.org")),
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
      fetchMock.mock.calls.some(([input]) => String(input).startsWith("https://explorer.lichess.org")),
    ).toBe(true);
    expect(directHeaders).toEqual({ Authorization: "Bearer fallback-test-token" });
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
});
