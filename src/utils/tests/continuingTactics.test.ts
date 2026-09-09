import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import {
    normalizeContinuingTactics,
    replayTacticalLine,
} from "@/utils/tacticalMotifs/causalTactics";
import type { TacticalMotifEvidence } from "@/utils/tacticalMotifs/types";

const ordinary = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/ordinary-games-stockfish-18.json", "utf8"),
).find((row: { id: string }) => row.id === "ordinary-2:ply18");
const fen: string = ordinary.fen;
const line: string[] = ordinary.after[0].pvUci;

test("the proved mating attack does not advertise its independently irrelevant rook fork", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs[0].id).toBe("mateIn7");
    expect(
        result.timeline?.filter((motif) => motif.id === "fork").map((motif) => motif.ply),
    ).toEqual([]);
    expect(result.timeline?.some((motif) => motif.ply === 13 && /mate/i.test(motif.id))).toBe(true);
});

test("a renewed rook threat after interruption is a new fork", () => {
    const position = makeFen(replayTacticalLine(fen, line)[6].before.toSetup()).replace(
        "rnbq2r1",
        "rnb3r1",
    );
    const continuation = ["d5f7", "e7d6", "f7d7", "d6c5", "d7d5"];
    expect(replayTacticalLine(position, continuation)).toHaveLength(5);
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: continuation });
    expect(
        result.timeline?.filter((motif) => motif.id === "fork").map((motif) => motif.ply),
    ).toEqual([1, 5]);
});

test("a new victim used by the mating line retains its fork after the irrelevant old one is removed", () => {
    const position = makeFen(replayTacticalLine(fen, line)[6].before.toSetup()).replace(
        "3Q4",
        "n2Q4",
    );
    const continuation = line.slice(6);
    expect(replayTacticalLine(position, continuation)).toHaveLength(7);
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: continuation });
    const forks = result.timeline?.filter((motif) => motif.id === "fork");
    expect(forks?.map((motif) => motif.ply)).toEqual([5]);
    expect(forks?.[0].evidence).toContain("knight on a5");
});

test.each([
    ["3Q3b", "a bishop on h5 defended by the g6 pawn", []],
    ["r2Q4", "a rook on a5 that can capture the checking queen on d5", [1]],
] as const)(
    "geometrical extra targets are not additional fork lessons: %s (%s)",
    (rank, _description, expected) => {
        const position = makeFen(replayTacticalLine(fen, line)[6].before.toSetup()).replace(
            "3Q4",
            rank,
        );
        const result = classifyPositionTacticalMotifs({ fen: position, pvUci: line.slice(6) });
        expect(
            result.timeline?.filter((motif) => motif.id === "fork").map((motif) => motif.ply),
        ).toEqual(expected);
    },
);

test("normalization is idempotent and keeps evidence on actual moves", () => {
    const steps = replayTacticalLine(fen, line);
    const evidence = [7, 11].map(
        (ply) =>
            ({
                id: "fork",
                label: "Fork",
                source: "available",
                confidence: "high",
                ply,
                moveUci: steps[ply - 1].uci,
                evidence: steps[ply - 1].san,
                relevance: "secondary",
            }) as TacticalMotifEvidence,
    );
    const once = normalizeContinuingTactics(steps, evidence);
    expect(once.map((motif) => motif.ply)).toEqual([7]);
    expect(normalizeContinuingTactics(steps, once)).toEqual(once);
    expect(evidence).toHaveLength(2);
    const primary = evidence.map((motif) =>
        motif.ply === 11 ? { ...motif, relevance: "primary" as const } : motif,
    );
    expect(normalizeContinuingTactics(steps, primary)).toHaveLength(2);
});

test("a fork that creates a new pin keeps that distinct supporting event", () => {
    const position = "2q1k3/4p3/8/8/4N3/8/8/4R1K1 w - - 0 1";
    const continuation = ["e4d6", "e8d8", "d6c8"];
    expect(replayTacticalLine(position, continuation)).toHaveLength(3);
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: continuation });
    expect(result.timeline?.filter((motif) => motif.ply === 1).map((motif) => motif.id)).toEqual(
        expect.arrayContaining(["fork", "pin"]),
    );
});
