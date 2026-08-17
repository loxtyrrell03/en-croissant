import { describe, expect, test } from "vitest";
import { __databaseFileExportTestUtils } from "@/utils/databaseFileExport";

const {
    createExistingPgnIndex,
    findReusablePgnEntry,
    getDuplicatePgnPathsForMainline,
    getOrderedSlotFromFileName,
    getPrefixedPgnFileName,
    getStaleOrderedSlotEntries,
} = __databaseFileExportTestUtils;

describe("database linked folder sync helpers", () => {
    test("prefers the annotated PGN when ordered study sync sees duplicate mainlines", () => {
        const plain = `[Event "Remote"]

1. e4 e5 2. Nf3 Nc6 *`;
        const annotated = `[Event "Local"]

1. e4 {keep this note} e5 2. Nf3 Nc6 *`;
        const contentHash = __databaseFileExportTestUtils.hashPgnMainline(plain);
        const mainlineHash = __databaseFileExportTestUtils.hashPgnMainline(plain);
        const index = createExistingPgnIndex([
            {
                path: "C:/Study/0001 Remote.pgn",
                contentHash: "plain-content",
                mainlineHash,
                annotationScore: __databaseFileExportTestUtils.getPgnAnnotationScore(plain),
            },
            {
                path: "C:/Study/old annotated copy.pgn",
                contentHash: "annotated-content",
                mainlineHash,
                annotationScore: __databaseFileExportTestUtils.getPgnAnnotationScore(annotated),
            },
        ]);

        const reusable = findReusablePgnEntry(index, {
            contentHash,
            mainlineHash,
            targetFileName: "0001 Remote.pgn",
        });

        expect(reusable?.path).toBe("C:/Study/old annotated copy.pgn");
        expect(getDuplicatePgnPathsForMainline(index, mainlineHash, reusable!.path)).toEqual([
            "C:/Study/0001 Remote.pgn",
        ]);
    });

    test("keeps the study-title prefix behind the source-order index", () => {
        expect(
            getPrefixedPgnFileName("0016 2026.03.08 Binx, Michael - Tyrrell, Lachlan.pgn", "My classical games"),
        ).toBe("0016 My classical games 2026.03.08 Binx, Michael - Tyrrell, Lachlan.pgn");
        expect(
            getPrefixedPgnFileName(
                "0029 2026.04.20 My classical games - Lachlan vs Mike gale 1-0.pgn",
                "My classical games",
            ),
        ).toBe("0029 2026.04.20 My classical games - Lachlan vs Mike gale 1-0.pgn");
        expect(getPrefixedPgnFileName("Some notes.pgn", "My classical games")).toBe(
            "My classical games Some notes.pgn",
        );
    });

    test("parses the source-order slot from current and legacy sync filenames", () => {
        expect(getOrderedSlotFromFileName("0046 2026.06.11 My study - Yawar 0-1.pgn")).toBe("0046");
        expect(getOrderedSlotFromFileName("My classical games 0029 2026.04.20 Me - Me.pgn")).toBe(
            "0029",
        );
        // Ratings and years after the date must not be mistaken for the index.
        expect(
            getOrderedSlotFromFileName("2026.06.11 Lachlan vs surag prabhu 1718 1-0.pgn"),
        ).toBeNull();
        expect(getOrderedSlotFromFileName("Free analysis.pgn")).toBeNull();
    });

    test("flags a same-slot same-date leftover as stale when it matches no incoming game", () => {
        const staleAnnotated = {
            path: "C:/Study/0046 2026.06.11 My study - Yawar 0-1 Unknown - Unknown.pgn",
            contentHash: "old-content",
            mainlineHash: "old-mainline",
            annotationScore: 900_000,
        };
        const reorderedNeighbour = {
            path: "C:/Study/0046 2026.05.30 My study - Other game.pgn",
            contentHash: "neighbour-content",
            mainlineHash: "neighbour-mainline",
            annotationScore: 100,
        };
        const currentCopyOfAnotherGame = {
            path: "C:/Study/0046 2026.06.11 My study - Same day game.pgn",
            contentHash: "other-incoming-content",
            mainlineHash: "other-incoming-mainline",
            annotationScore: 100,
        };
        const index = createExistingPgnIndex([
            staleAnnotated,
            reorderedNeighbour,
            currentCopyOfAnotherGame,
        ]);

        const stale = getStaleOrderedSlotEntries(index, {
            targetFileName: "0046 2026.06.11 My study - Yawar vs lachlan 0-1.pgn",
            excludePath: null,
            incomingContentHashes: new Set(["new-content", "other-incoming-content"]),
            incomingMainlineHashes: new Set(["new-mainline", "other-incoming-mainline"]),
        });

        // Only the stale copy qualifies: the reordered neighbour has a different
        // date and the same-day file still matches an incoming game.
        expect(stale.map((entry) => entry.path)).toEqual([staleAnnotated.path]);
    });

    test("does not flag stale slot entries when the target has no date", () => {
        const index = createExistingPgnIndex([
            {
                path: "C:/Study/0002 Old copy.pgn",
                contentHash: "old",
                mainlineHash: "old",
                annotationScore: 0,
            },
        ]);

        expect(
            getStaleOrderedSlotEntries(index, {
                targetFileName: "0002 Untitled chapter.pgn",
                excludePath: null,
                incomingContentHashes: new Set(),
                incomingMainlineHashes: new Set(),
            }),
        ).toEqual([]);
    });
});
