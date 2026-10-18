import { describe, expect, test } from "vitest";
import { getWebPrepDatabaseOpponent } from "../prepIndex";

describe("opponent selection before hosted games download", () => {
    test.each([
        ["Example, Alex - OTB prep (310 games)", "Example, Alex"],
        ["Alex Example - as Black (153 games)", "Alex Example"],
        ["Alex Example – as White (12 games).db3", "Alex Example"],
        ["Alex Example - OTB games since 2021", "Alex Example"],
        ["Alex Example - opponent prep", "Alex Example"],
        ["alexexample - OTB prep", "alexexample"],
        ["alexexample_lichess.pgn", "alexexample"],
        ["alexexample chess.com recent games.db3", "alexexample"],
    ])(
        "recognizes the explicitly named collection %s without downloading games",
        (name, opponent) => {
            expect(getWebPrepDatabaseOpponent({ name, playerNames: [] }, [])).toBe(opponent);
        },
    );

    test.each(["Mega Database", "World Championships", "Study games", ""])(
        "does not invent a player from an ordinary collection: %s",
        (name) => {
            expect(getWebPrepDatabaseOpponent({ name, playerNames: [] }, [])).toBeNull();
        },
    );

    test("preserves the most common player when downloaded games establish them", () => {
        expect(
            getWebPrepDatabaseOpponent({ name: "Some collection" }, [
                { name: "Example, Alex", games: 10 },
                { name: "Other, Pat", games: 1 },
            ]),
        ).toBe("Example, Alex");
    });

    test("uses a matching metadata identity without needing games", () => {
        expect(
            getWebPrepDatabaseOpponent(
                { name: "alexexample_lichess", playerNames: ["other", "alexexample"] },
                [],
            ),
        ).toBe("alexexample");
        expect(
            getWebPrepDatabaseOpponent({ name: "My collection", playerNames: ["alexexample"] }, []),
        ).toBe("alexexample");
        expect(getWebPrepDatabaseOpponent(null, [])).toBeNull();
    });
});
