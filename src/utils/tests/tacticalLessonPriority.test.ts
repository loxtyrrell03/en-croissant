import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    tacticalMotifPerspective,
} from "../tacticalMotifs/mistakeReviewAdapter";
import type { TacticalMotifEvidence } from "../tacticalMotifs/types";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";

const motif = (overrides: Partial<TacticalMotifEvidence>): TacticalMotifEvidence => ({
    id: "fork",
    label: "Fork",
    source: "missed",
    ply: 1,
    moveUci: "e5f7",
    confidence: "high",
    evidence: "Nxf7 forks the queen and rook.",
    value: 500,
    relevance: "primary",
    ...overrides,
});

test("a verified missed root opportunity outranks a larger but causally unverified opponent tactic", () => {
    const result = buildMistakeReviewTacticalExplanation({
        missedMotifs: [motif({})],
        allowedMotifs: [
            motif({ source: "allowed", id: "hangingPiece", label: "Hanging Piece", value: 900 }),
        ],
    });
    expect(result?.primary.source).toBe("missed");
    expect(result?.primary.id).toBe("fork");
    expect(result?.secondary).toBeUndefined();
});

test("an independently causal larger loss stays primary without hiding the missed opportunity", () => {
    const result = buildMistakeReviewTacticalExplanation({
        missedMotifs: [motif({})],
        allowedMotifs: [
            motif({
                source: "allowed",
                id: "hangingPiece",
                label: "Hanging Piece",
                value: 900,
                comparison: "prevented",
            }),
        ],
    });
    expect(result?.primary.id).toBe("hangingPiece");
    expect(result?.secondary?.source).toBe("missed");
    expect(result?.text).toContain("You also missed a tactical opportunity (Fork)");
});

test.each([{ ply: 3 }, { confidence: "low" as const }, { value: 50 }])(
    "conditional, weak or incidental missed evidence is not promoted into another accusation: %j",
    (change) => {
        const result = buildMistakeReviewTacticalExplanation({
            missedMotifs: [motif(change)],
            allowedMotifs: [motif({ source: "allowed", comparison: "prevented", value: 900 })],
        });
        expect(result?.secondary).toBeUndefined();
    },
);

test("opponent forks and your own forks have unambiguous learning labels", () => {
    expect(tacticalMotifPerspective(motif({}))).toBe("Missed opportunity");
    expect(tacticalMotifPerspective(motif({ source: "allowed", comparison: "prevented" }))).toBe(
        "Overlooked threat",
    );
    expect(tacticalMotifPerspective(motif({ source: "allowed", comparison: "persists" }))).toBe(
        "Existing danger",
    );
    expect(tacticalMotifPerspective(motif({ source: "allowed" }))).toBe("Opponent tactic");
});

test.each([undefined, "persists"] as const)(
    "a missed mate does not turn %s opponent danger into another mistake",
    (comparison) => {
        const result = buildMistakeReviewTacticalExplanation({
            missedMotifs: [motif({ id: "mateIn2", label: "Forcing Mate", value: 10000 })],
            allowedMotifs: [motif({ source: "allowed", comparison })],
        });
        expect(result?.primary.source).toBe("missed");
        expect(result?.secondary).toBeUndefined();
        expect(result?.text).not.toContain("also allowed");
    },
);

test.each(["prevented", "reduced"] as const)(
    "a missed mate retains the separately proved %s opponent fork",
    (comparison) => {
        const result = buildMistakeReviewTacticalExplanation({
            missedMotifs: [motif({ id: "mateIn2", label: "Forcing Mate", value: 10000 })],
            allowedMotifs: [
                motif({
                    source: "allowed",
                    comparison,
                    comparisonEvidence: "The better move limits this loss.",
                }),
            ],
        });
        expect(result?.primary.source).toBe("missed");
        expect(result?.secondary?.source).toBe("allowed");
        expect(result?.text).toContain("The better move limits this loss.");
        expect(result?.text).toContain(comparison === "reduced" ? "more costly" : "also allowed");
    },
);

type EngineLine = { pvUci: string[]; pvSan: string[]; cp: number | null; mate: number | null };
type CausalCase = {
    name: string;
    fen: string;
    played: string;
    source: string;
    primary: string;
    before: EngineLine[];
    after: EngineLine[];
};
const cases: CausalCase[] = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/causal-stockfish-18.json", "utf8"),
);
function classify(row: CausalCase) {
    const best = row.before[0],
        reply = row.after[0];
    const sign = row.fen.split(" ")[1] === "w" ? 1 : -1;
    const score = (line: EngineLine) => line.cp ?? Math.sign(line.mate ?? 0) * 10000;
    return classifyMistakeReviewMotifs({
        fen: row.fen,
        playedMoveUci: row.played,
        bestMoveUci: best.pvUci[0],
        pvUci: best.pvUci,
        pvSan: best.pvSan,
        refutationUci: reply.pvUci,
        refutationSan: reply.pvSan,
        cpBefore: score(best) * sign,
        cpAfter: -score(reply) * sign,
        cpLoss: Math.max(0, score(best) + score(reply)),
    });
}

// Keep the human judgements fixed. The old exchange-discovery proof ignored
// a counterattack on its queen; withdrawal creates two known coverage gaps.
const unresolvedJudgements = new Set([
    "Developing the bishop misses the overloaded-queen discovery",
    "The real Nxd4 mistake allows the overloaded-queen discovery",
]);
for (const row of cases)
    (unresolvedJudgements.has(row.name) ? test.fails : test)(
        `frozen before/after engine evidence retains the judged primary: ${row.name}`,
        () => {
            const result = buildMistakeReviewTacticalExplanation(classify(row));
            // Conditional registration above is still a real Vitest test.
            // eslint-disable-next-line jest/no-standalone-expect
            expect({ id: result?.primary.id, source: result?.primary.source }).toEqual({
                id: row.primary,
                source: row.source,
            });
        },
    );

test("the real Be7 lesson retains both the hanging bishop and missed forcing attack", () => {
    const row = cases.find(
        (row) => row.name === "Be7 hangs the bishop while also missing the checking attack",
    )!;
    const result = buildMistakeReviewTacticalExplanation(classify(row));
    expect(result?.primary).toMatchObject({ id: "hangingPiece", source: "allowed" });
    expect(result?.secondary).toMatchObject({ id: "forcingAttack", source: "missed", ply: 1 });
    expect(result?.text).toContain("Qf1+");
});

function reflect(row: CausalCase): CausalCase {
    const flipCase = (text: string) =>
        text.replace(/[a-zA-Z]/g, (c) =>
            c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
        );
    const move = (uci: string) => uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
    const fields = row.fen.split(" ");
    fields[0] = flipCase(fields[0].split("/").reverse().join("/"));
    fields[1] = fields[1] === "w" ? "b" : "w";
    fields[2] = flipCase(fields[2]);
    fields[3] = move(fields[3]);
    const line = (item: EngineLine) => ({ ...item, pvUci: item.pvUci.map(move), pvSan: [] });
    return {
        ...row,
        fen: fields.join(" "),
        played: move(row.played),
        before: row.before.map(line),
        after: row.after.map(line),
    };
}

for (const original of cases)
    (unresolvedJudgements.has(original.name) ? test.fails : test)(
        `colour-reflected control preserves legal lines and lesson ownership: ${original.name}`,
        () => {
            const row = reflect(original);
            // Conditional registration above is still a real Vitest test.
            /* eslint-disable jest/no-standalone-expect */
            expect(replayTacticalLine(row.fen, row.before[0].pvUci)).toHaveLength(
                row.before[0].pvUci.length,
            );
            expect(replayTacticalLine(row.fen, [row.played, ...row.after[0].pvUci])).toHaveLength(
                row.after[0].pvUci.length + 1,
            );
            const result = buildMistakeReviewTacticalExplanation(classify(row));
            expect({ id: result?.primary.id, source: result?.primary.source }).toEqual({
                id: row.primary,
                source: row.source,
            });
            /* eslint-enable jest/no-standalone-expect */
        },
    );

test("a missed chance to exploit a pin is a user's opportunity, not an opponent threat", () => {
    const result = classifyMistakeReviewMotifs({
        fen: "8/4n1kp/8/3P4/2B5/8/8/4R1K1 w - - 1 2",
        bestMoveUci: "d5d6",
        playedMoveUci: "g1h1",
        pvUci: ["d5d6", "g7f8", "d6e7"],
    });
    // This king is not on the rook's pin ray: ordinary pawn pressure must abstain.
    expect(result.missedMotifs.some((m) => m.id === "pin")).toBe(false);
    const pinned = classifyMistakeReviewMotifs({
        fen: "4k3/4n2p/8/3P4/2B5/8/8/4R1K1 w - - 1 2",
        bestMoveUci: "d5d6",
        playedMoveUci: "g1h1",
        pvUci: ["d5d6", "e8f8", "d6e7"],
    });
    expect(pinned.missedMotifs[0]).toMatchObject({ id: "pin", source: "missed" });
    expect(buildMistakeReviewTacticalExplanation(pinned)?.primary.id).toBe("pin");
});

test.skipIf(!process.env.TACTICAL_LESSON_REPORT)(
    "record the frozen lesson audit without treating it as general accuracy",
    () => {
        const report = cases.map((row) => {
            const result = buildMistakeReviewTacticalExplanation(classify(row));
            return {
                name: row.name,
                expectedPrimary: row.primary,
                expectedSource: row.source,
                primary: result?.primary.id ?? null,
                source: result?.primary.source ?? null,
                comparison: result?.primary.comparison ?? "unproved",
                secondary: result?.secondary?.id ?? null,
                secondarySource: result?.secondary?.source ?? null,
                explanation: result?.text,
            };
        });
        expect(report).toHaveLength(32);
        expect(
            report.every(
                (row) =>
                    unresolvedJudgements.has(row.name) ||
                    (row.primary === row.expectedPrimary && row.source === row.expectedSource),
            ),
        ).toBe(true);
        writeFileSync(
            process.env.TACTICAL_LESSON_REPORT!,
            JSON.stringify(
                {
                    scope: "32 frozen before/after engine scenarios from real-game positions and constructed controls, plus separately tested colour-reflected controls. Human judgements remain unchanged; two known exchange-discovery proof gaps are expected failures, not correct negatives. Reused development data, not holdout validation or general accuracy. Engine lines are frozen depth-16 evidence, not fresh searches in this report.",
                    unresolvedJudgements: [...unresolvedJudgements],
                    primaryMatches: report.filter(
                        (row) =>
                            row.primary === row.expectedPrimary &&
                            row.source === row.expectedSource,
                    ).length,
                    secondaryLessons: report.filter((row) => row.secondary).length,
                    distinctPrimaryThemes: [
                        ...new Set(report.flatMap((row) => (row.primary ? [row.primary] : []))),
                    ].sort(),
                    cases: report,
                },
                null,
                2,
            ),
        );
    },
);
