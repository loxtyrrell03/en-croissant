import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { provePerpetualCheck, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "r6k/5Q1p/6p1/8/q7/8/8/5R1K w - - 0 1";
const line = ["f7f6", "h8g8", "f6f7", "g8h8", "f7f6"];

test("checks establish a repeatable all-defence drawing strategy without claiming a completed draw", () => {
    const proof = provePerpetualCheck(replayTacticalLine(fen, line));
    expect(proof).not.toBeNull();
    expect(proof?.cycle).toEqual(["Kg8", "Qf7+", "Kh8", "Qf6+"]);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line, rootCp: 0 });
    expect(result.motifs[0]).toMatchObject({ id: "perpetualCheck", value: 0, ply: 1 });
    expect(result.motifs[0].evidence).toContain("not a draw already claimed");
    expect(result.timeline?.filter((m) => m.id === "perpetualCheck")).toHaveLength(1);
});

test("a root-only check can find its cycle without depending on a cooperative PV", () => {
    expect(provePerpetualCheck(replayTacticalLine(fen, [line[0]]))).not.toBeNull();
    expect(classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] }).motifs[0]?.id).toBe(
        "perpetualCheck",
    );
});

test("board arrows show the present check, not future queen squares", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Regression" });
    expect(scan.labels[0]?.text).toContain("Perpetual Check");
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["f7f6", "f6h8"]);
});

test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "invalid/exhausted budget %s cannot reuse a warm proof",
    (budget) => {
        const steps = replayTacticalLine(fen, line);
        expect(provePerpetualCheck(steps)).not.toBeNull();
        expect(provePerpetualCheck(steps, budget)).toBeNull();
    },
);

test("a legal capture of the checking queen refutes the attractive repetition", () => {
    const capture = fen.replace("8/q7", "6b1/q7");
    expect(replayTacticalLine(capture, ["f7f6", "g5f6"])).toHaveLength(2);
    expect(provePerpetualCheck(replayTacticalLine(capture, line))).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: capture, pvUci: line }).motifs.some(
            (m) => m.id === "perpetualCheck",
        ),
    ).toBe(false);
});

test("removing the queen's support permits a king capture, even though the supplied cycle stays legal", () => {
    const position = fen.replace("5R1K", "7K");
    expect(replayTacticalLine(position, line)).toHaveLength(5);
    expect(replayTacticalLine(position, ["f7f6", "h8g8", "f6f7", "g8f7"])).toHaveLength(4);
    expect(provePerpetualCheck(replayTacticalLine(position, line))).toBeNull();
});

test("a material advantage or positive engine evaluation does not nominate a routine repetition", () => {
    const winning = fen.replace("q7", "8");
    expect(provePerpetualCheck(replayTacticalLine(winning, line))).not.toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: winning, pvUci: line }).motifs.some(
            (m) => m.id === "perpetualCheck",
        ),
    ).toBe(false);
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: line, rootCp: 600 }).motifs.some(
            (m) => m.id === "perpetualCheck",
        ),
    ).toBe(false);
});

test("non-checking and mating roots are not perpetual checks", () => {
    expect(provePerpetualCheck(replayTacticalLine(fen, ["h1h2"]))).toBeNull();
    expect(
        provePerpetualCheck(replayTacticalLine("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1", ["f7g7"])),
    ).toBeNull();
});

test("colour reflection retains the drawing proof", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const reflected = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: reflected }).motifs[0]?.id,
    ).toBe("perpetualCheck");
});

test("the missed drawing resource stays in review with zero material value", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "f7f6",
        playedMoveUci: "h1h2",
        pvUci: line,
        refutationUci: ["a4a2", "f7a2", "a8a2"],
        cpBefore: 0,
        cpAfter: -370,
        cpLoss: 370,
    });
    expect(review.missedMotifs[0]).toMatchObject({
        id: "perpetualCheck",
        value: 0,
        source: "missed",
    });
    expect(
        buildMistakeReviewTacticalExplanation({
            allowedMotifs: [],
            missedMotifs: review.missedMotifs,
        })?.text,
    ).toContain("repeated checks");
    expect(buildMistakeReviewTacticalExplanation(review)?.primary.id).toBe("perpetualCheck");
});

test("playing the analysed drawing move is not a missed opportunity", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "f7f6",
        playedMoveUci: "f7f6",
        pvUci: line,
        refutationUci: line.slice(1),
        cpBefore: 0,
        cpAfter: 0,
        cpLoss: 0,
    });
    expect(review.missedMotifs).toEqual([]);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE)(
    "the real saving combination has a certified reached perpetual, not an unproved quiet root",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 11);
        const steps = replayTacticalLine(row.fen, row.sourceUci);
        const reached = makeFen(steps[4].before.toSetup());
        expect(
            classifyPositionTacticalMotifs({ fen: reached, pvUci: [steps[4].uci], rootCp: 0 })
                .motifs[0]?.id,
        ).toBe("perpetualCheck");
        expect(provePerpetualCheck(steps)).toBeNull();
    },
);
