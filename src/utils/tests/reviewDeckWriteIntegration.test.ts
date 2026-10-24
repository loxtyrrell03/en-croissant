import { afterEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
    createOpeningReviewDeck,
    readOpeningReviewDeck,
    writeOpeningReviewDeck,
} from "../openingReview";
import {
    createMistakeReviewDeck,
    DEFAULT_MISTAKE_REVIEW_SEVERITIES,
    DEFAULT_MISTAKE_REVIEW_THRESHOLDS,
    DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT,
    readMistakeReviewDeck,
    writeMistakeReviewDeck,
} from "../mistakeReview";
import { flushReviewDeckWrites } from "../reviewDeckWrites";

vi.mock("@tauri-apps/plugin-fs", () => ({
    exists: vi.fn(),
    readDir: vi.fn(),
    remove: vi.fn(),
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

describe("native review file write ownership", () => {
    const opening = createOpeningReviewDeck({ name: "Opening progress", positions: [] });
    const mistake = createMistakeReviewDeck({
        name: "Mistake progress",
        positions: [],
        settings: {
            playerDb: "fixture.db3",
            playerId: 1,
            enginePath: "fixture",
            analysisMode: "single",
            fastDepth: 12,
            deepDepth: 17,
            multiPv: 3,
            timeControls: [],
            dateRange: "all",
            minWinProbabilityDrop: 5,
            thresholds: DEFAULT_MISTAKE_REVIEW_THRESHOLDS,
            includeSeverities: DEFAULT_MISTAKE_REVIEW_SEVERITIES,
            timeManagement: DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT,
        },
    });
    it.each([
        {
            path: "fixture.opening-review.json",
            deck: opening,
            write: writeOpeningReviewDeck,
            read: readOpeningReviewDeck,
        },
        {
            path: "fixture.mistake-review.json",
            deck: mistake,
            write: writeMistakeReviewDeck,
            read: readMistakeReviewDeck,
        },
    ])(
        "retains failed $path evidence before trying the old disk copy",
        async ({ path, deck, write, read }) => {
            vi.mocked(writeTextFile)
                .mockRejectedValueOnce(new Error("File locked"))
                .mockResolvedValue(undefined);
            // The fixture table has the corresponding concrete deck writer at runtime.
            await expect(
                (write as typeof writeOpeningReviewDeck)(path, deck as typeof opening),
            ).rejects.toThrow("File locked");
            expect((await read(path)).name).toBe(deck.name);
            expect(readTextFile).not.toHaveBeenCalled();
            await flushReviewDeckWrites(path);
            expect(writeTextFile).toHaveBeenCalledTimes(2);
            expect(JSON.parse(String(vi.mocked(writeTextFile).mock.calls[1][1])).name).toBe(
                deck.name,
            );
        },
    );
});
