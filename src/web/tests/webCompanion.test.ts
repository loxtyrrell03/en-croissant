import { describe, expect, test } from "vitest";
import { getWebPrepMoveStats } from "@/web/prepIndex";
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
  });
});
