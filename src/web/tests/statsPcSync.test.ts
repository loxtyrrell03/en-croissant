import { describe, expect, it } from "vitest";
import { mergeAnalyzedEntries } from "@/web/statsPcSync";
import type { AnalyzedGameEntry } from "@/web/statsStrength";

function entry(input: {
    ts: number;
    depth: number;
    targetDepth?: number;
    nodeLimit?: number | null;
}): AnalyzedGameEntry {
    return {
        v: 2,
        ts: input.ts,
        key: "chesscom|game-1",
        end: 1,
        source: "chesscom",
        url: null,
        timeControl: { base: 600, inc: 0 },
        color: "w",
        opponent: "Opponent",
        opp: 1800,
        result: "win",
        plies: 40,
        eco: "C50",
        openingName: "Italian Game",
        stats: {
            accuracy: 91,
            acpl: 18,
            scoredCount: 20,
            complexity: 4,
            bookMoves: 8,
            blunderRate: 0,
            fastRate: 0.2,
            scramble: 0,
            analysisDepth: input.depth,
        },
        phases: {},
        counts: { inaccuracy: 0, mistake: 0, blunder: 0 },
        phaseBlunders: { opening: 0, middlegame: 0, endgame: 0 },
        advanced: {} as AnalyzedGameEntry["advanced"],
        opponentQuality: { advanced: {} } as AnalyzedGameEntry["opponentQuality"],
        ...(input.targetDepth == null
            ? {}
            : {
                  batchAnalysis: {
                      targetDepth: input.targetDepth,
                      nodeLimit: input.nodeLimit ?? null,
                      cloudHits: 5,
                      firstCloudMissPly: 5,
                      pcPositions: 36,
                      pcNodes: 36_000_000,
                      policy: "lichess-local-until-first-miss-then-pc" as const,
                  },
              }),
    };
}

describe("mergeAnalyzedEntries", () => {
    it("keeps the saved PC batch over a newer shallow phone result", () => {
        const pc = entry({ ts: 100, depth: 11, targetDepth: 25, nodeLimit: 1_000_000 });
        const phone = entry({ ts: 200, depth: 12 });

        expect(mergeAnalyzedEntries([pc], [phone])).toEqual([pc]);
        expect(mergeAnalyzedEntries([phone], [pc])).toEqual([pc]);
    });

    it("uses recency only when analysis quality is equal", () => {
        const older = entry({ ts: 100, depth: 11, targetDepth: 25, nodeLimit: 1_000_000 });
        const newer = entry({ ts: 200, depth: 11, targetDepth: 25, nodeLimit: 1_000_000 });

        expect(mergeAnalyzedEntries([older], [newer])).toEqual([newer]);
    });
});
