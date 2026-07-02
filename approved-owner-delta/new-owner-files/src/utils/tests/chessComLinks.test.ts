import { describe, expect, test } from "vitest";
import { getChessComGameLinkFromPgn, parseChessComGameUrl } from "@/utils/chess.com/links";

describe("Chess.com game links", () => {
    test("accepts typed and bare Chess.com game URLs", () => {
        expect(parseChessComGameUrl("https://www.chess.com/game/live/168710736104")).toEqual({
            gameId: "168710736104",
            gameTypes: ["live"],
        });
        expect(parseChessComGameUrl("https://www.chess.com/game/168710736104")).toEqual({
            gameId: "168710736104",
            gameTypes: ["live", "daily"],
        });
        expect(
            parseChessComGameUrl("https://www.chess.com/analysis/game/live/168710736104"),
        ).toEqual({
            gameId: "168710736104",
            gameTypes: ["live"],
        });
    });

    test("extracts Chess.com Link headers from existing PGNs", () => {
        const pgn = `[Event "Live Chess"]\n[Link "https://www.chess.com/game/168710736104"]\n\n1. d4 *`;
        expect(getChessComGameLinkFromPgn(pgn)).toBe(
            "https://www.chess.com/game/168710736104",
        );
    });
});
