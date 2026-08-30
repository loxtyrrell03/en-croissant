import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_OTB_IMPORT_SOURCES, findExactWebFidePlayer } from "../otbImport";

const players = [
    {
        id: 6003788,
        name: "Tyrrell, Lachlan Baly Hughes",
        federation: "HKG",
        year: 2003,
        standard: 1852,
    },
    {
        id: 30957443,
        name: "Tyrrell, Benjamin",
        federation: "USA",
    },
];

describe("phone OTB identity resolution", () => {
    it("pins a unique exact canonical name to its FIDE player", () => {
        expect(findExactWebFidePlayer(players, "  tyrrell,  LACHLAN baly hughes ")?.id).toBe(
            6003788,
        );
    });

    it("does not guess a partial name", () => {
        expect(findExactWebFidePlayer(players, "Tyrrell")).toBeNull();
    });

    it("defaults every distinct phone source lane on", () => {
        expect(DEFAULT_WEB_OTB_IMPORT_SOURCES).toEqual({
            lichessBroadcasts: true,
            broadcastArchives: true,
            communityBroadcasts: true,
            chessResults: true,
            chessbaseNews: true,
            officialPgnIndexes: true,
            twic: true,
        });
        expect(Object.keys(DEFAULT_WEB_OTB_IMPORT_SOURCES)).toHaveLength(7);
    });
});
