import { describe, expect, test } from "vitest";
import {
    extractLichessStudyChapterRefs,
    getLichessStudyPushErrorMessage,
    normalizedGameToPgn,
} from "@/utils/lichess/study";
import type { NormalizedGame } from "@/bindings";

describe("Lichess study sync helpers", () => {
    test("extracts chapter refs from study PGN exports", () => {
        const pgn = `[Event "Import"]
[Site "https://lichess.org/gameid"]
[StudyName "My study"]
[ChapterName "Model game"]
[ChapterURL "https://lichess.org/study/abcdefgh/ijklmnop"]

1. e4 e5 *

[Event "Second"]
[ChapterURL "https://lichess.org/study/abcdefgh/ABCDEFGH"]

1. d4 d5 *`;

        expect(extractLichessStudyChapterRefs(pgn)).toEqual([
            {
                chapterId: "ijklmnop",
                chapterName: "Model game",
                chapterUrl: "https://lichess.org/study/abcdefgh/ijklmnop",
                sourceSite: "https://lichess.org/gameid",
            },
            {
                chapterId: "ABCDEFGH",
                chapterName: null,
                chapterUrl: "https://lichess.org/study/abcdefgh/ABCDEFGH",
                sourceSite: null,
            },
        ]);
    });

    test("serializes normalized games with tags and local movetext", () => {
        const game: NormalizedGame = {
            id: 12,
            event: "My game",
            event_id: 1,
            site: "London",
            site_id: 1,
            date: "2026.05.28",
            time: null,
            round: "3",
            white: "Lachlan Tyrrell",
            white_id: 2,
            white_elo: 1800,
            black: "Opponent",
            black_id: 3,
            black_elo: null,
            result: "1-0",
            time_control: null,
            eco: "D15",
            ply_count: 2,
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            moves: "1. d4 d5 {note} 1-0",
        };

        expect(normalizedGameToPgn(game)).toContain(`[White "Lachlan Tyrrell"]`);
        expect(normalizedGameToPgn(game)).toContain(`[ECO "D15"]`);
        expect(normalizedGameToPgn(game)).toContain("1. d4 d5 {note} 1-0");
    });

    test("explains study push permission failures", () => {
        expect(getLichessStudyPushErrorMessage(401, "Unauthorized", "moves")).toContain(
            "session has expired",
        );
        expect(getLichessStudyPushErrorMessage(403, "Forbidden", "moves")).toContain(
            "study write access",
        );
        expect(getLichessStudyPushErrorMessage(500, "Server Error", "tags")).toBe(
            "Lichess study tags push failed: 500 Server Error",
        );
    });
});
