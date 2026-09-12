import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import {
    proveExchangeDeflection,
    replayTacticalLine,
    counterCaptureMaterialDefence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "4r1k1/3q1pbp/6p1/3Q4/8/5P2/P5PP/R2R2K1 b - - 0 1";
const line = ["e8e1", "d1e1", "d7d5"];
test("a checking offer deflects the guard even after the queen exchange is declined", () => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(3);
    expect(proveExchangeDeflection(steps[0])).toMatchObject({ gain: 400 });
    expect(classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs[0]?.id).toBe("deflection");
});

test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "budget %s cannot borrow a successful default proof",
    (budget) => {
        const root = replayTacticalLine(fen, line)[0];
        expect(proveExchangeDeflection(root)).not.toBeNull();
        expect(proveExchangeDeflection(root, budget)).toBeNull();
    },
);

test.each([
    fen.replace("R2R2K1", "3R2K1"), // no connected second rook
    fen.replace("3q1pbp", "5pbp"), // no queen payoff
    fen.replace("R2R2K1", "R5K1"), // no overloaded guard
    fen.replace("3Q4", "3N4"), // minor does not repay the offered rook
    fen.replace("3Q4", "3Q3R"), // another rook still defends the queen
    fen.replace("P5PP", "6PP"), // legal Ra8+ resource after declining
])("changed victims or a real additional defence cannot borrow the combination: %s", (position) => {
    const steps = replayTacticalLine(position, [line[0]]);
    expect(steps).toHaveLength(1);
    expect(proveExchangeDeflection(steps[0])).toBeNull();
});

test("the limiting acceptance and the alternate queen-exchange witness are both legal", () => {
    const root = replayTacticalLine(fen, line)[0];
    const proof = proveExchangeDeflection(root)!;
    expect(proof.acceptance).toEqual(["Rxe1", "Qxd5"]);
    expect(proof.recovery).toEqual(["Kf2", "Qxd5", "Rxd5", "Rxa1"]);
    for (const witness of [proof.acceptance, proof.recovery]) {
        const position = root.after.clone();
        for (const san of witness) {
            const move = parseSan(position, san)!;
            expect(position.isLegal(move)).toBe(true);
            position.play(move);
        }
    }
});

test.each([[line[0]], line, ["e8e1", "g1f2", "d7d5", "d1d5", "e1a1"]])(
    "source acceptance is not required to nominate the root mechanism: %j",
    (...pvUci) => {
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]).toMatchObject({
            id: "deflection",
            ply: 1,
            value: 400,
        });
    },
);

test("the board shows the offer and current guarding relationship, not a premature rook capture", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Constructed" });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["e8e1", "d1e1", "d1d5"]);
    expect(scan.labels).toHaveLength(1);
    expect(scan.motifs[0].evidence).toContain("Kf2 Qxd5 Rxd5 Rxa1");
});

test("accepting the proved non-capturing rook offer is not a newly hanging rook", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    const after = makeFen(replayTacticalLine(fen, line)[0].after.toSetup());
    const contextual = classifyPositionTacticalMotifs({
        fen: after,
        previousFen: fen,
        previousMoveUci: line[0],
        pvUci: [line[1]],
    });
    expect(contextual.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
    expect(
        counterCaptureMaterialDefence(replayTacticalLine(after, [line[1]])[0], 8192, 0, true)
            ?.defence,
    ).toBe("Qxd5");
    expect(
        classifyPositionTacticalMotifs({ fen: after, pvUci: [line[1]] }).motifs.some(
            (m) => m.id === "hangingPiece",
        ),
    ).toBe(false);
});

test("missing the checking deflection names the root opportunity rather than a later loose queen", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: "d7d5",
        pvUci: line,
        refutationUci: ["d1d5"],
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "deflection",
        source: "missed",
        ply: 1,
    });
    expect(review.missedTimeline?.some((m) => m.id === "hangingPiece" && m.ply === 2)).toBe(false);
});

test("colour reflection preserves the guarded targets, local gain and explanation", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    const moves = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const result = classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: moves });
    expect(result.motifs[0]).toMatchObject({ id: "deflection", value: 400, ply: 1 });
});

test("an opponent deflection without a positive before/better proof is not a causal accusation", () => {
    const before = "4r1k1/3q1pbp/6p1/8/4Q3/5P2/P5PP/R2R2K1 w - - 0 1";
    expect(replayTacticalLine(before, ["e4d5", ...line])).toHaveLength(4);
    const review = classifyMistakeReviewMotifs({
        fen: before,
        bestMoveUci: "e4c2",
        playedMoveUci: "e4d5",
        pvUci: ["e4c2"],
        refutationUci: line,
    });
    expect(review.allowedMotifs[0]).toMatchObject({ id: "deflection", ply: 1 });
    expect(review.allowedMotifs[0].comparison).toBeUndefined();
    expect(buildMistakeReviewTacticalExplanation(review)?.title).toBe("Tactic after the move");
});
test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_SAMPLE)(
    "the real checking rook deflection has an independently proved decline",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 200);
        expect(
            proveExchangeDeflection(replayTacticalLine(row.fen, row.sourceUci)[0]),
        ).toMatchObject({ gain: 400 });
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs[0]?.id,
        ).toBe("deflection");
    },
);
