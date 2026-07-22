import { describe, expect, test } from "vitest";
import { __databaseFileExportTestUtils } from "@/utils/databaseFileExport";

const { createExistingPgnIndex, findReusablePgnEntry, getDuplicatePgnPathsForMainline } =
    __databaseFileExportTestUtils;

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
});
