import { describe, expect, test, vi } from "vitest";
import { getOnlinePlanExplorer } from "@/utils/lichess/planExplorer";

vi.mock("@/utils/lichess/api", () => ({
    getLichessGames: vi.fn(async (fen: string, _options: unknown, _token?: string, play = []) => {
        const line = play.join(" ");
        const movesByLine =
            fen === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                ? new Map([
                      [
                          "",
                          [
                              { uci: "e2e4", san: "e4", white: 18, draws: 8, black: 10 },
                              { uci: "b2b4", san: "b4", white: 10, draws: 6, black: 8 },
                          ],
                      ],
                      ["e2e4", [{ uci: "a7a6", san: "a6", white: 16, draws: 7, black: 9 }]],
                      ["e2e4 a7a6", [{ uci: "c2c3", san: "c3", white: 15, draws: 6, black: 8 }]],
                      [
                          "e2e4 a7a6 c2c3",
                          [{ uci: "b7b6", san: "b6", white: 14, draws: 6, black: 8 }],
                      ],
                      [
                          "e2e4 a7a6 c2c3 b7b6",
                          [{ uci: "d2d3", san: "d3", white: 14, draws: 5, black: 7 }],
                      ],
                      [
                          "e2e4 a7a6 c2c3 b7b6 d2d3",
                          [{ uci: "h7h6", san: "h6", white: 14, draws: 5, black: 7 }],
                      ],
                      [
                          "e2e4 a7a6 c2c3 b7b6 d2d3 h7h6",
                          [{ uci: "h2h3", san: "h3", white: 14, draws: 5, black: 7 }],
                      ],
                  ])
                : new Map([
                      [
                          "",
                          [
                              { uci: "g2g3", san: "g3", white: 18, draws: 8, black: 10 },
                              { uci: "b1c3", san: "Nc3", white: 10, draws: 6, black: 8 },
                          ],
                      ],
                      ["g2g3", [{ uci: "f8e7", san: "Be7", white: 16, draws: 7, black: 9 }]],
                      ["g2g3 f8e7", [{ uci: "f1g2", san: "Bg2", white: 15, draws: 6, black: 8 }]],
                      [
                          "g2g3 f8e7 f1g2",
                          [{ uci: "e8g8", san: "O-O", white: 14, draws: 6, black: 8 }],
                      ],
                      [
                          "g2g3 f8e7 f1g2 e8h8",
                          [{ uci: "e1g1", san: "O-O", white: 14, draws: 5, black: 7 }],
                      ],
                  ]);
        const moves = movesByLine.get(line) ?? [];

        return {
            white: moves.reduce((sum, move) => sum + move.white, 0),
            draws: moves.reduce((sum, move) => sum + move.draws, 0),
            black: moves.reduce((sum, move) => sum + move.black, 0),
            moves: moves.map((move) => ({ ...move, averageRating: 2200 })),
        };
    }),
    getMasterGames: vi.fn(),
}));

const QUEENS_GAMBIT_NF3_FEN = "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 0 4";
const PAWN_NOISE_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("online plan explorer setups", () => {
    test("infers a setup family from sampled database route co-occurrence", async () => {
        const data = await getOnlinePlanExplorer("lch_all", QUEENS_GAMBIT_NF3_FEN, {}, 6, "token");

        const setup = data.setups.find((candidate) => {
            const pieces = new Set(
                candidate.plans.map((plan) => `${plan.color}:${plan.role}:${plan.from}`),
            );
            return (
                pieces.has("white:pawn:g2") &&
                pieces.has("white:bishop:f1") &&
                pieces.has("white:king:e1")
            );
        });
        const routes = new Map(
            setup?.plans.map((plan) => [
                `${plan.color}:${plan.role}:${plan.from}`,
                plan.line.squares,
            ]),
        );

        expect(setup?.games).toBe(26);
        expect(routes.get("white:pawn:g2")).toEqual(["g2", "g3"]);
        expect(routes.get("white:bishop:f1")).toEqual(["f1", "g2"]);
        expect(routes.get("white:king:e1")).toEqual(["e1", "g1"]);
    });

    test("does not turn unrelated pawn pushes into a setup family", async () => {
        const data = await getOnlinePlanExplorer("lch_all", PAWN_NOISE_FEN, {}, 8, "token");

        expect(data.setups).toEqual([]);
    });
});
