import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classifyMistakeReviewNature } from "../mistakeReview";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const read = (path: string) =>
    JSON.parse(readFileSync(`benchmarks/tactical-relevance/${path}.json`, "utf8"));
const frozen = read("causal-stockfish-18");
const rare = read("rare-theme-development").cases;
const results: any[] = [];
for (const row of frozen) {
    const best = row.before[0],
        reply = row.after[0];
    const score = (line: any) => line.cp ?? Math.sign(line.mate ?? 0) * 10000;
    const sign = row.fen.split(" ")[1] === "w" ? 1 : -1;
    const input = {
        fen: row.fen,
        bestMoveUci: best.pvUci[0],
        playedMoveUci: row.played,
        pvUci: best.pvUci,
        refutationUci: reply.pvUci,
        cpBefore: score(best) * sign,
        cpAfter: -score(reply) * sign,
        cpLoss: Math.max(0, score(best) + score(reply)),
    };
    test(`frozen causal nature and primary lesson: ${row.name}`, () => {
        const nature = classifyMistakeReviewNature(input);
        const motifs = classifyMistakeReviewMotifs(input);
        const explanation = buildMistakeReviewTacticalExplanation(motifs)!;
        results.push({ name: row.name, input, nature, explanation });
        const existingDanger =
            row.name === "The real Kf1 best defence does not cause the existing mate" ||
            row.name === "A different reply wins the same queen after the better move";
        expect(nature.nature).toBe(existingDanger ? "unknown" : "tactical");
        expect({
            headlineMatches: existingDanger || nature.reason === explanation.text,
            mainThemeMatches:
                existingDanger || nature.tacticalSignals[0]?.includes(explanation.primary.label),
        }).toEqual({ headlineMatches: true, mainThemeMatches: true });
        expect(nature.tacticalSignals.length).toBeLessThanOrEqual(existingDanger ? 0 : 2);
    });
}

test("exact winning and drawing zugzwangs are not discarded for having zero material gain", () => {
    const inputs = [
        {
            fen: "8/8/8/5k2/8/4K3/5P2/8 w - - 1 69",
            bestMoveUci: "e3f3",
            playedMoveUci: "e3d3",
            pvUci: ["e3f3"],
        },
        {
            fen: "8/2k5/8/8/2K5/2P5/8/8 b - - 0 1",
            bestMoveUci: "c7c6",
            playedMoveUci: "c7d6",
            pvUci: ["c7c6"],
            refutationUci: ["c4d4"],
        },
        {
            fen: "8/2k5/8/8/2K5/8/2P5/8 w - - 0 1",
            bestMoveUci: "c4b5",
            playedMoveUci: "c2c3",
            pvUci: ["c4b5"],
            refutationUci: ["c7c6"],
        },
    ];
    for (const input of inputs) {
        const result = classifyMistakeReviewNature(input);
        expect(result.nature).toBe("tactical");
        expect(result.tacticalSignals[0]).toMatch(/zugzwang/i);
    }
});

test("a genuine quiet mate is retained while a cooperative continuation cannot fund it", () => {
    const input = {
        fen: "7k/7p/5K2/7Q/8/8/8/8 w - - 0 1",
        bestMoveUci: "h5h6",
        playedMoveUci: "f6e5",
        pvUci: ["h5h6", "h8g8", "h6g7"],
    };
    expect(classifyMistakeReviewNature(input).nature).toBe("tactical");
    const poisoned = { ...input, fen: input.fen.replace("/8 w", "/2b5 w") };
    expect(replayTacticalLine(poisoned.fen, poisoned.pvUci).at(-1)?.after.isCheckmate()).toBe(true);
    expect(replayTacticalLine(poisoned.fen, ["h5h6", "c1h6"])).toHaveLength(2);
    expect(classifyMistakeReviewNature(poisoned).nature).toBe("unknown");
});

test("the old geometric quiet-fork positive has a legal checking defence that wins the knight", () => {
    const fen = "k7/3q1r2/8/8/8/5N2/8/K7 w - - 0 1";
    const line = replayTacticalLine(fen, ["f3e5", "d7d4", "a1b1", "d4e5"]);
    expect(line).toHaveLength(4);
    expect(line[1].san).toBe("Qd4+");
    expect(line[3].san).toBe("Qxe5");
    expect(
        classifyMistakeReviewNature({
            fen,
            bestMoveUci: "f3e5",
            playedMoveUci: "a1a2",
            pvUci: ["f3e5", "d7e6", "e5f7"],
        }).nature,
    ).toBe("unknown");
});

test.each([
    ["lichess:zYjb5", "f6f5", "interference"],
    ["lichess:nBrWE", "b7b6", "forcingAttack"],
])("real rare-theme root survives cause filtering: %s", (id, playedMoveUci, primary) => {
    const row = rare.find((r: any) => r.id === id);
    expect(replayTacticalLine(row.startFen, [playedMoveUci])).toHaveLength(1);
    const input = {
        fen: row.startFen,
        bestMoveUci: row.bestLine[0],
        pvUci: row.bestLine,
        playedMoveUci,
    };
    const motifs = classifyMistakeReviewMotifs(input);
    const explanation = buildMistakeReviewTacticalExplanation(motifs)!;
    expect(explanation.primary.id).toBe(primary);
    expect(classifyMistakeReviewNature(input)).toMatchObject({
        nature: "tactical",
        reason: explanation.text,
    });
    expect(motifs.missedTimeline).toContainEqual(
        expect.objectContaining(
            id === "lichess:zYjb5"
                ? { id: "selfInterference", ply: 2 }
                : { id: "deflection", ply: 3 },
        ),
    );
});

test("missing evidence is not positional and mismatched root notation cannot move a motif", () => {
    expect(classifyMistakeReviewNature({}).nature).toBe("unknown");
    expect(classifyMistakeReviewNature({ bestMoveSan: "Qg7#", pvSan: ["Qg7#"] }).nature).toBe(
        "unknown",
    );
    expect(
        classifyMistakeReviewNature({
            fen: "7k/7p/5K2/7Q/8/8/8/8 w - - 0 1",
            bestMoveUci: "h5h6",
            playedMoveUci: "f6e5",
            pvUci: ["h5h4"],
        }).reason,
    ).toContain("disagree");
});

test.skipIf(!process.env.TACTICAL_NATURE_CAUSAL_REPORT)(
    "save the causal audit without treating agreement as general accuracy",
    () => {
        expect(results).toHaveLength(32);
        writeFileSync(
            process.env.TACTICAL_NATURE_CAUSAL_REPORT!,
            JSON.stringify(
                {
                    scope: "Reused frozen root judgements, independent nature reconciliation; not holdout accuracy.",
                    cases: results,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
