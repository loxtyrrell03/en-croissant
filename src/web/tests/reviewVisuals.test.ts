import { expect, it } from "vitest";
import { reviewMistakeFrames } from "../reviewVisuals";
import { parsePgnDatabase } from "../pgn";
import type { PhoneReviewCard } from "../mistakeReview";

it("replays the mistake and mating reply, stopping before invalid continuation", () => {
    const game = parsePgnDatabase("test", "1. f3 e5 2. g4 Qh4# *").games[0];
    const frames = reviewMistakeFrames({
        fen: game.moves[2].fenBefore,
        played: "g4",
        refutation: ["Qh4#", "invalid"],
    } as PhoneReviewCard);
    expect(frames.map((f) => f.uci)).toEqual(["g2g4", "d8h4"]);
    expect(frames[1].fen).toBe(game.moves[3].fenAfter);
});
