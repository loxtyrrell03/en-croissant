import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MantineProvider } from "@mantine/core";
import { positionSchema } from "@/components/files/opening";
import {
    TacticalAlternativeExplanation,
    TacticalLineExplanation,
} from "@/components/panels/tactics/TacticalLineExplanation";
import { classifyMistakeReviewNature } from "../mistakeReview";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    mixedForkFen,
    mixedForkLine,
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";
import { missedAlternativeInput } from "./fixtures/missedAlternative";

test.each([false, true])(
    "a missed alternative has its own root and not the preferred timeline: reflected=%s",
    (reflected) => {
        const input = structuredClone(missedAlternativeInput);
        if (reflected) {
            input.fen = reflectMixedForkFen(input.fen!);
            input.playedMoveUci = reflectMixedForkMove(input.playedMoveUci!);
            input.bestMoveUci = reflectMixedForkMove(input.bestMoveUci!);
            input.pvUci = input.pvUci!.map(reflectMixedForkMove);
            input.bestCandidates = input.bestCandidates!.map((c) => ({
                ...c,
                fen: input.fen!,
                pvUci: c.pvUci.map(reflectMixedForkMove),
            }));
            input.cpBefore = -input.cpBefore!;
            input.cpAfter = -input.cpAfter!;
        }
        const result = classifyMistakeReviewMotifs(input);
        const lesson = buildMistakeReviewTacticalExplanation(result);
        expect(lesson).toMatchObject({
            title: "Missed alternative: Hanging Piece",
            source: "missed",
            primary: {
                id: "hangingPiece",
                source: "missed",
                ply: 1,
                moveUci: input.bestCandidates![1].pvUci[0],
            },
        });
        expect(lesson!.text).toContain("Another stronger move");
        expect(result.missedTimeline?.some((m) => m.alternativeLine)).toBe(false);
        const metadata = positionSchema.shape.mistakeReview.parse({ ...input, ...result });
        expect(metadata?.bestCandidates).toEqual(input.bestCandidates);
        expect(metadata?.missedMotifs?.[0].alternativeLine?.fen).toBe(input.fen);
        expect(classifyMistakeReviewNature(input)).toMatchObject({
            nature: "tactical",
            aspect: "missed",
        });
        expect(classifyMistakeReviewNature({ ...input, bestCandidates: [] }).nature).toBe(
            "unknown",
        );
    },
);

test.each([
    "absent",
    "board",
    "illegal",
    "shallow",
    "fractional-depth",
    "shallower-than-best",
    "mate",
    "no-principal",
    "better-than-principal",
    "too-far",
    "too-small-improvement",
    "played",
    "same-best",
    "nan-loss",
])("unsupported alternative: %s", (kind) => {
    const input = structuredClone(missedAlternativeInput),
        cs = input.bestCandidates!;
    if (kind === "absent") input.bestCandidates = [];
    if (kind === "board") cs[1].fen = cs[1].fen.replace(" b ", " w ");
    if (kind === "illegal") cs[1].pvUci.push("a1a8");
    if (kind === "shallow") cs[1].depth = 13;
    if (kind === "fractional-depth") cs[1].depth = 16.5;
    if (kind === "shallower-than-best") cs[0].depth = 17;
    if (kind === "mate") cs[0].cp = null;
    if (kind === "no-principal") cs.shift();
    if (kind === "better-than-principal") cs[1].cp = 650;
    if (kind === "too-far") cs[1].cp = 539;
    if (kind === "too-small-improvement") input.cpLoss = 89;
    if (kind === "played") input.playedMoveUci = "f8a3";
    if (kind === "same-best") input.playedMoveUci = input.bestMoveUci;
    if (kind === "nan-loss") input.cpLoss = NaN;
    expect(classifyMistakeReviewMotifs(input).missedMotifs.some((m) => m.alternativeLine)).toBe(
        false,
    );
});

test("existing preferred root stays primary", () => {
    const input = structuredClone(missedAlternativeInput);
    input.bestMoveUci = "f8a3";
    input.pvUci = ["f8a3"];
    const result = classifyMistakeReviewMotifs(input);
    expect(result.missedMotifs[0].moveUci).toBe("f8a3");
    expect(result.missedMotifs.some((m) => m.alternativeLine)).toBe(false);
});

test("the same nomination path can retain a independently proved fork, not only captures", () => {
    const result = classifyMistakeReviewMotifs({
        fen: mixedForkFen,
        playedMoveUci: "g6f7",
        bestMoveUci: "g6h7",
        pvUci: ["g6h7"],
        cpLoss: 300,
        bestCandidates: [
            { fen: mixedForkFen, pvUci: ["g6h7"], cp: 380, depth: 16 },
            { fen: mixedForkFen, pvUci: mixedForkLine, cp: 340, depth: 16 },
        ],
    });
    expect(result.missedMotifs[0]).toMatchObject({
        id: "fork",
        moveUci: "d2f3",
        alternativeLine: { uci: ["d2f3"] },
    });
});

test("a supported opponent cause stays primary over a separate missed option", () => {
    const missed = classifyMistakeReviewMotifs(missedAlternativeInput).missedMotifs;
    const explanation = buildMistakeReviewTacticalExplanation({
        missedMotifs: missed,
        allowedMotifs: [
            {
                id: "perpetualCheck",
                label: "Perpetual Check",
                confidence: "high",
                source: "allowed",
                ply: 1,
                moveUci: "a1a8",
                value: 0,
                comparison: "prevented",
                evidence: "Verified saving checks.",
            },
        ],
    });
    expect(explanation?.primary.id).toBe("perpetualCheck");
    expect(explanation?.secondary?.alternativeLine).toBeTruthy();
});

test("alternative rendering is separate from best-move annotations", () => {
    const motifs = classifyMistakeReviewMotifs(missedAlternativeInput).missedMotifs;
    const render = (child: ReturnType<typeof createElement>) =>
        renderToStaticMarkup(createElement(MantineProvider, {}, child));
    const alternative = render(createElement(TacticalAlternativeExplanation, { motifs }));
    expect(alternative).toContain("Alternative move you missed");
    expect(alternative).toContain("Bxa3");
    const preferred = render(
        createElement(TacticalLineExplanation, { title: "Preferred", moves: ["Qxc3+"], motifs }),
    );
    expect(preferred).not.toContain("Hanging Piece");
});

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "frozen owner missed bishop capture is recovered without inventing principal-line events",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        const row = report.results.find(
            (r: { ply: number; playedMoveUci: string }) =>
                r.ply === 21 && r.playedMoveUci === "e8a8",
        );
        expect(row).toBeTruthy();
        const result = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: row.playedMoveUci,
            bestMoveUci: row.before[0].pvUci[0],
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            cpBefore: -row.before[0].cp,
            cpAfter: row.after[0].cp,
            cpLoss: row.before[0].cp + row.after[0].cp,
            bestCandidates: row.before.map((c: { pvUci: string[]; cp: number; depth: number }) => ({
                ...c,
                fen: row.fen,
            })),
        });
        expect(result.missedMotifs[0]).toMatchObject({
            id: "hangingPiece",
            moveUci: "f8a3",
            alternativeLine: { uci: ["f8a3"] },
        });
        expect(result.missedTimeline?.some((m) => m.alternativeLine)).toBe(false);
        const drawingRow = report.results.find(
            (r: { ply: number; playedSan: string }) => r.ply === 87 && r.playedSan === "Rxh7",
        );
        const drawing = classifyMistakeReviewMotifs({
            fen: drawingRow.fen,
            playedMoveUci: drawingRow.playedMoveUci,
            bestMoveUci: drawingRow.before[0].pvUci[0],
            pvUci: drawingRow.before[0].pvUci,
            refutationUci: drawingRow.after[0].pvUci,
            cpBefore: -drawingRow.before[0].cp,
            cpAfter: drawingRow.after[0].cp,
            cpLoss: drawingRow.before[0].cp + drawingRow.after[0].cp,
            bestCandidates: drawingRow.before.map(
                (c: { pvUci: string[]; cp: number; depth: number }) => ({
                    ...c,
                    fen: drawingRow.fen,
                }),
            ),
        });
        expect(buildMistakeReviewTacticalExplanation(drawing)?.primary.id).toBe("perpetualCheck");
        expect(drawing.missedMotifs.some((m) => m.alternativeLine)).toBe(false);
    },
);
