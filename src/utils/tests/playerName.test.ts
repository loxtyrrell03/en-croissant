import { describe, expect, test } from "vitest";
import { getPlayerSearchQueries, selectResolvedPlayerCandidate } from "@/utils/playerName";

describe("player name resolution", () => {
    test("matches a Chess.com-labeled prep player to the database username", () => {
        const player = selectResolvedPlayerCandidate(
            [{ id: 1, name: "Sebastian443" }],
            "Sebastian443 Chess.com",
        );

        expect(player?.id).toBe(1);
    });

    test("matches a database title that contains a provider and username", () => {
        const player = selectResolvedPlayerCandidate(
            [
                { id: 1, name: "SebastianDs" },
                { id: 2, name: "Sebastian443" },
            ],
            "04 Mokhber-Garcia, Sebastian - Chess.com Sebastian443",
        );

        expect(player?.id).toBe(2);
    });

    test("keeps provider-only text from resolving to unrelated chess usernames", () => {
        const player = selectResolvedPlayerCandidate([{ id: 84, name: "1kchess" }], "Chess.com");

        expect(player).toBeNull();
    });

    test("searches meaningful username tokens from provider labels", () => {
        expect(getPlayerSearchQueries("Sebastian443 Chess.com")).toContain("sebastian443");
    });
});
