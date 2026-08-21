import { describe, expect, test, vi } from "vitest";
import {
    createWebPgnImportRequest,
    readWebPgnImportFile,
    WEB_PGN_FILE_ACCEPT,
} from "@/web/pgnImport";

describe("phone PGN import", () => {
    test("turns pasted text into an importable named PGN", () => {
        expect(
            createWebPgnImportRequest({
                name: "My game",
                pgn: '  [Event "Phone import"]\n\n1. e4 e5 *  ',
            }),
        ).toEqual({
            name: "My game.pgn",
            pgn: '[Event "Phone import"]\n\n1. e4 e5 *',
        });
    });

    test("reads a selected PGN file without renaming it", async () => {
        const text = vi.fn().mockResolvedValue("1. d4 d5 *");

        await expect(readWebPgnImportFile({ name: "training.PGN", text })).resolves.toEqual({
            name: "training.PGN",
            pgn: "1. d4 d5 *",
        });
        expect(text).toHaveBeenCalledOnce();
        expect(WEB_PGN_FILE_ACCEPT).toContain(".pgn");
    });

    test("rejects an empty file or paste with a helpful message", () => {
        expect(() => createWebPgnImportRequest({ pgn: "   " })).toThrow(
            "Choose a PGN file or paste PGN text first.",
        );
    });
});
