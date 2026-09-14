import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    matingThreatInterference,
    proveQuietMatingAttack,
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import type { Chess } from "chessops/chess";
import type { NormalMove } from "chessops/types";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    matingInterferenceCases,
    matingTrapControls,
    matingTrapFen,
    matingTrapLine,
    reflectMatingInterference,
    rookMatingInterferenceFen,
} from "./fixtures/matingInterference";

const examples = matingInterferenceCases.flatMap((row) => [
    row,
    { ...reflectMatingInterference(row), id: `${row.id}:black` },
]);
function legalMoves(pos: Chess): NormalMove[] {
    return [...pos.allDests()].flatMap(([from, dests]) =>
        [...dests].flatMap((to) =>
            pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) => ({
                      from,
                      to,
                      promotion,
                  }))
                : [{ from, to }],
        ),
    );
}

test.each(examples.filter((row) => row.expected))("new mate mechanism: $id", (row) => {
    const steps = replayTacticalLine(row.fen, [row.move]);
    expect(steps).toHaveLength(1);
    const root = steps[0];
    expect(root.before.isCheck()).toBe(false);
    const proof = proveQuietMatingAttack(root);
    const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
    expect(proof).toMatchObject({ gain: 400 });
    expect(proof!.branches).toHaveLength(legalMoves(root.after).length);
    expect(matingThreatInterference(root, proof!)).toMatchObject({ role: "rook" });
    expect(result.motifs).toHaveLength(2);
    expect(result.motifs[0]).toMatchObject({
        id: "mateIn3", label: "Mating Preparation", ply: 1, value: 10000,
    });
    expect(result.motifs[1]).toMatchObject({
        id: "interference",
        label: "Mating Interference",
        ply: 1,
        value: 400,
    });
});

test.each(examples.filter((row) => !row.expected))(
    "contrary defence or missing root proof: $id",
    (row) => {
        const steps = replayTacticalLine(row.fen, [row.move]);
        expect(steps).toHaveLength(1);
        expect(steps[0].before.isCheck()).toBe(false);
        const proof = proveQuietMatingAttack(steps[0]);
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
        // Incomplete countercheck coverage is an abstention, not a refutation.
        expect(proof).toBeNull();
        expect(result.motifs.some((m) => m.label === "Mating Interference")).toBe(false);
    },
);

test("a separately verified forced mate outranks a smaller material concession", () => {
    const data = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/mating-interference-stockfish-18.json", "utf8"),
    );
    const row = data.searches.find((row: any) => row.id === "rook-interposition:root");
    const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.lines[0].pvUci });
    expect(result.motifs[0]).toMatchObject({
        id: "mateIn3",
        label: "Mating Preparation",
        ply: 1,
        value: 10000,
    });
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "mateIn1", ply: 5 }));
});

test("the blocker cuts a legal rook interposition, not a future engine capture", () => {
    const root = replayTacticalLine(rookMatingInterferenceFen, ["e6e7"])[0];
    const proof = proveQuietMatingAttack(root)!;
    expect(proof.threatSan).toBe("Qh4#");
    expect(matingThreatInterference(root, proof)).toEqual({
        from: 49,
        to: 55,
        role: "rook",
        defence: "Rh7",
    });
    const premature = replayTacticalLine(rookMatingInterferenceFen, ["g5h4", "b7h7"]);
    expect(premature.map((step) => step.san)).toEqual(["Qh4+", "Rh7"]);
    const mateProbe = root.after.clone();
    mateProbe.turn = "white";
    mateProbe.play(proof.threat);
    expect(mateProbe.isCheckmate()).toBe(true);
    // The alternative adjacent queen mate is also stopped by that rook's
    // capture before e7; this verifies both forms of defensive route.
    const captureThreat = { ...proof, threat: { from: 38, to: 54 }, threatSan: "Qg7#" };
    expect(matingThreatInterference(root, captureThreat)).toEqual({
        from: 49,
        to: 54,
        role: "rook",
        defence: "Rxg7",
    });
});

test("root-only, accepting and declining lines retain one primary mechanism", () => {
    for (const pvUci of [["e6e7"], ["e6e7", "b7e7", "g5e7"], ["e6e7", "b7b4", "g5h5"]]) {
        const result = classifyPositionTacticalMotifs({ fen: rookMatingInterferenceFen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "mateIn3", ply: 1, value: 10000 });
        expect(result.motifs.filter((m) => m.ply === 1)).toHaveLength(2);
        const interference = result.motifs.find(m => m.id === "interference")!;
        expect(interference).toMatchObject({ value: 400, relevance: "secondary" });
        expect(interference.evidence).toContain("not a forced-mate claim");
        expect(tacticalBoardEvidence(rookMatingInterferenceFen, pvUci, interference)).toEqual({
            square: "e7",
            arrows: [
                { from: "b7", to: "h7" },
                { from: "g5", to: "h4" },
            ],
        });
    }
    const scan = buildLiveTacticalScan({
        fen: rookMatingInterferenceFen,
        pvUci: ["e6e7"],
        depth: 16,
        engineName: "Fixture",
    });
    expect(scan.labels).toHaveLength(1);
    expect(scan.motifs[0].id).toBe("mateIn3");
    expect(scan.variations[0].timeline).toContainEqual(expect.objectContaining({ id: "interference", ply: 1, value: 400 }));
    expect(scan.arrows).toEqual([
        { from: "e6", to: "e7", ply: 1, role: "trigger" },
        { from: "b7", to: "h7", ply: 1, role: "attacker" },
        { from: "g5", to: "h4", ply: 1, role: "attacker" },
    ]);
});

test("missed mating preparation keeps interference as a separately proved supporting mechanism", () => {
    const review = classifyMistakeReviewMotifs({
        fen: rookMatingInterferenceFen,
        bestMoveUci: "e6e7",
        playedMoveUci: "g5f5",
        pvUci: ["e6e7", "b7e7", "g5e7"],
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "mateIn3",
        source: "missed",
        ply: 1,
    });
    expect(review.missedMotifs).toContainEqual(expect.objectContaining({ id: "interference", ply: 1 }));
});

test("invalid or exhausted budgets cannot borrow a cached interference proof", () => {
    const root = replayTacticalLine(rookMatingInterferenceFen, ["e6e7"])[0];
    expect(proveQuietMatingAttack(root)).not.toBeNull();
    for (const limit of [0, 1, 50, -1, 1.5, NaN, Infinity])
        expect(proveQuietMatingAttack(root, limit)).toBeNull();
});

test("the real mating-trap root remains unproved instead of borrowing its later trap", () => {
    const root = replayTacticalLine(matingTrapFen, matingTrapLine)[0];
    expect(proveQuietMatingAttack(root)).toBeNull();
    const result = classifyPositionTacticalMotifs({ fen: matingTrapFen, pvUci: matingTrapLine });
    expect(result.motifs.some((m) => m.ply === 1 && m.id === "forcingAttack")).toBe(false);
    const reached = replayTacticalLine(matingTrapFen, matingTrapLine)[2];
    expect(
        classifyPositionTacticalMotifs({
            fen: makeFen(reached.before.toSetup()),
            pvUci: matingTrapLine.slice(2),
        }).motifs[0],
    ).toMatchObject({ id: "trappedPiece", ply: 1 });
    // A concrete continuation exposes why one-step exchange arithmetic was
    // insufficient in the rejected prototype: Bxd5 leaves Rb2 capturable.
    const line = replayTacticalLine(matingTrapFen, [
        "d7d5",
        "e3f3",
        "a1a2",
        "c3c4",
        "a2b2",
        "c4d5",
        "c6d5",
        "c1b2",
    ]);
    expect(line).toHaveLength(8);
    expect(tacticalExchangeGain(line[7].before, line[7].move)).toBe(500);
    for (const row of matingTrapControls)
        expect(proveQuietMatingAttack(replayTacticalLine(row.fen, ["d7d5"])[0])).toBeNull();
});

test.skipIf(
    !process.env.TACTICAL_INTERFERENCE_AUDIT_INPUT ||
        !process.env.TACTICAL_INTERFERENCE_AUDIT_REPORT,
)("audit new course mechanisms and construct independent engine probes privately", () => {
    const prior = JSON.parse(readFileSync(process.env.TACTICAL_INTERFERENCE_AUDIT_INPUT!, "utf8"));
    const rows = prior.results.flatMap((group: any) => group.cases);
    expect(rows).toHaveLength(246);
    const course = [
        { row: rows.find((row: any) => row.id === "private-easy:190"), ply: 1 },
        { row: rows.find((row: any) => row.id === "private-easy:10"), ply: 5 },
    ].map(({ row, ply }) => {
        const line = row.engineLines[0].pvUci;
        const step = replayTacticalLine(row.fen, line)[ply - 1];
        return {
            id: `${row.id}:ply${ply}`,
            fen: makeFen(step.before.toSetup()),
            move: step.uci,
            expected: ply === 1 ? "interference" : "forcingAttack",
        };
    });
    const cases = [...examples, ...course].map((row) => {
        const root = replayTacticalLine(row.fen, [row.move])[0];
        const proof = proveQuietMatingAttack(root);
        if (row.expected && !proof) throw new Error(`Missing independent proof: ${row.id}`);
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
        if (row.expected && !result.motifs.some(m => m.id === row.expected))
            throw new Error(`Missing independently verified mechanism: ${row.id}`);
        return {
            ...row,
            proof,
            result,
            replies: legalMoves(root.after).map((move) => {
                const after = root.after.clone();
                after.play(move);
                return {
                    move: makeUci(move),
                    san: makeSan(root.after, move),
                    fen: makeFen(after.toSetup()),
                };
            }),
        };
    });
    const probes = cases.flatMap((row) => [
        { id: `${row.id}:best`, fen: row.fen },
        { id: `${row.id}:root`, fen: row.fen, searchMove: row.move },
        ...(row.proof
            ? row.replies.map((reply) => ({
                  id: `${row.id}:defence:${reply.move}`,
                  fen: reply.fen,
              }))
            : []),
        ...(row.proof?.decisions ?? []).map((decision, index) => ({
            id: `${row.id}:decision:${index}`,
            fen: decision.fen,
            searchMove: decision.move,
        })),
    ]);
    writeFileSync(
        process.env.TACTICAL_INTERFERENCE_AUDIT_REPORT!,
        JSON.stringify(
            {
                samplePath: "benchmarks/tactical-relevance/rare-theme-development.json",
                scope: "Private course mechanisms plus constructed controls, every root defence and recorded attacker decision. Full-position scores do not certify local material bounds.",
                cases,
                probes,
            },
            null,
            2,
        ) + "\n",
        { flag: "wx" },
    );
});
