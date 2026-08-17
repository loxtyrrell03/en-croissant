import { describe, expect, it } from "vitest";
import { parseFidePlayers, rankFidePlayers, type FidePlayer } from "@/utils/fidePlayer";

const player = (id: number, name: string, extra: Partial<FidePlayer> = {}): FidePlayer => ({
    id,
    name,
    ...extra,
});

describe("FIDE player matching", () => {
    it("parses valid results and removes duplicate IDs", () => {
        expect(
            parseFidePlayers([
                { id: 6003788, name: "TYRRELL, LACHLAN BALY HUGHES", federation: "ENG" },
                { id: 6003788, name: "duplicate" },
                { name: "missing id" },
            ]),
        ).toEqual([{ id: 6003788, name: "TYRRELL, LACHLAN BALY HUGHES", federation: "ENG" }]);
    });

    it("ranks exact and one-letter surname matches ahead of unrelated hits", () => {
        const players = [
            player(1, "TAYLOR, LACHLAN", { standard: 2300 }),
            player(2, "TYRRELL, LACHLAN BALY HUGHES", { standard: 2100 }),
            player(3, "TYRELL, LACHLAN", { standard: 2050 }),
        ];
        expect(rankFidePlayers("Tyrrell Lachlan", players).map(({ id }) => id)).toEqual([2, 3, 1]);
        expect(
            rankFidePlayers("Tyrell Lachlan", players)
                .map(({ id }) => id)
                .slice(0, 2),
        ).toEqual([3, 2]);
    });

    it("prefers active players and rating when textual scores tie", () => {
        const players = [
            player(1, "CARLSEN, MAGNUS", { standard: 2700, inactive: true }),
            player(2, "CARLSEN, MAGNUS", { standard: 2500 }),
            player(3, "CARLSEN, MAGNUS", { standard: 2600 }),
        ];
        expect(rankFidePlayers("Carlsen", players).map(({ id }) => id)).toEqual([3, 2, 1]);
    });
});
