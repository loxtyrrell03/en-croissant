import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { proveCheckingMate, replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

// ordinary-2:ply53: the game is already mate in three. Kf1 is the engine's
// best defence, while Kg1 allows the shorter Ne3 / Rxg2 mating threat.
const fen = "4r3/pp3k1p/2n3p1/5n2/N4P2/8/PP2rKPP/R6R w - - 1 27";
const bestLine = ["f2f1", "c6d4", "a4c3", "f5e3", "f1g1", "e2g2"];
const refutation = ["c6d4", "g2g3", "f5e3", "f1g1", "d4f3"];

test.each([0, 500])(
    "the actual best defence is not blamed for existing mate (score loss %s)",
    (cpLoss) => {
        const result = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: "f2f1",
            playedMoveUci: "f2f1",
            pvUci: bestLine,
            refutationUci: refutation,
            cpLoss,
        });
        expect(result.missedMotifs).toEqual([]);
        expect(result.allowedMotifs[0]).toMatchObject({ id: "mateIn3", comparison: "persists" });
        expect(result.allowedTimeline?.find((m) => m.ply === 1)?.comparison).toBe("persists");
        expect(result.allowedTimeline?.some((m) => m.id === "cornerMate" && m.ply === 5)).toBe(
            true,
        );
        expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
            title: "Tactical danger in the position",
            primary: { comparison: "persists" },
        });
    },
);

test("equal numeric loss does not excuse a different move that accelerates mate", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "f2f1",
        playedMoveUci: "f2g1",
        pvUci: bestLine,
        refutationUci: ["f5e3", "a4c3", "e2g2"],
        cpLoss: 0,
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "mateThreat", value: 10000 });
    expect(result.allowedMotifs[0].comparison).not.toBe("persists");
});

const captureMateFen = "r1q1kb1r/p1p2ppp/1pnpp3/6B1/Q2P2nP/2N2NP1/PPP1PP2/2KR1B1R w kq - 3 12";
const captureMateLine = ["a4c6", "c8d7", "c6a8", "d7c8", "a8c8"];

test("the real Qxc6+ mate is a mating lesson, not a knight capture valued as mate", () => {
    const result = classifyPositionTacticalMotifs({ fen: captureMateFen, pvUci: captureMateLine });
    expect(result.motifs[0]).toMatchObject({
        id: "mateIn3",
        ply: 1,
        label: "Forcing Mate",
        value: 10000,
    });
    const captures = result.timeline?.filter((m) => m.id === "hangingPiece") ?? [];
    expect(captures.every((m) => (m.value ?? 0) < 10000)).toBe(true);
    expect(result.timeline?.some((m) => m.ply === 5 && m.label === "Checkmate")).toBe(true);
});

test("the real Bh3 mistake teaches the missed mate rather than just winning a knight", () => {
    const result = classifyMistakeReviewMotifs({
        fen: captureMateFen,
        bestMoveUci: "a4c6",
        playedMoveUci: "f1h3",
        pvUci: captureMateLine,
        cpLoss: 9392,
    });
    expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
        source: "missed",
        primary: { id: "mateIn3", ply: 1, value: 10000 },
    });
});

test("a proved discovered mating mechanism does not gain a duplicate generic root badge", () => {
    const examples = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/expanded-development.json", "utf8"),
    );
    const example = examples.cases.find((item: { id: string }) => item.id === "lichess:ouIHI");
    const result = classifyPositionTacticalMotifs({
        fen: example.startFen,
        pvUci: example.bestLine,
    });
    expect(result.motifs[0]).toMatchObject({ id: "discoveredAttack", ply: 1, value: 10000 });
    expect(result.motifs.some((m) => m.label === "Forcing Mate")).toBe(false);
    expect(result.timeline?.some((m) => m.id === "operaMate" && m.ply === 3)).toBe(true);
});

test("a cooperative short mate is rejected by a legal capture of the checking queen", () => {
    const position = captureMateFen.replace("Q2P2nP", "Qn1P2nP");
    const steps = replayTacticalLine(position, captureMateLine);
    expect(steps).toHaveLength(5);
    expect(steps[4].after.isCheckmate()).toBe(true);
    expect(replayTacticalLine(position, ["a4c6", "b4c6"])).toHaveLength(2);
    expect(proveCheckingMate(steps)).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: captureMateLine }).motifs.some(
            (m) => m.label === "Forcing Mate",
        ),
    ).toBe(false);
});

test("equivalent legal castling encodings cannot create a missed mating move", () => {
    const position = "5k2/4p1p1/8/1B6/2B5/8/8/4K2R w K - 0 1";
    for (const move of ["e1g1", "e1h1"]) {
        const steps = replayTacticalLine(position, [move]);
        expect(steps).toHaveLength(1);
        expect(steps[0].after.isCheckmate()).toBe(true);
    }
    const result = classifyMistakeReviewMotifs({
        fen: position,
        bestMoveUci: "e1g1",
        playedMoveUci: "e1h1",
        pvUci: ["e1g1"],
    });
    expect(result.missedMotifs).toEqual([]);
    expect(buildMistakeReviewTacticalExplanation(result)).toBeNull();
});

type FrozenRow = {
    id: string;
    beforeFen: string;
    before: { pvUci: string[] }[];
};
const rows = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/ordinary-games-stockfish-18.json", "utf8"),
) as FrozenRow[];

test.each(rows)(
    "choosing the engine's own move cannot create a missed/allowed accusation: $id",
    (row) => {
        const pvUci = row.before[0].pvUci;
        const result = classifyMistakeReviewMotifs({
            fen: row.beforeFen,
            bestMoveUci: pvUci[0],
            playedMoveUci: pvUci[0],
            pvUci,
            refutationUci: pvUci.slice(1),
        });
        expect(result.missedMotifs).toEqual([]);
        for (const motif of result.allowedMotifs) expect(motif.comparison).toBe("persists");
        expect(buildMistakeReviewTacticalExplanation(result)?.title).not.toBe(
            "Why the move was tactically bad",
        );
    },
);
