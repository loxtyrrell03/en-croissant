import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseSquare } from "chessops/util";
import { makeFen } from "chessops/fen";
import {
    replayTacticalLine,
    proveKingCaptureDefenderRemoval,
    tacticalExchangeGain,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { kingDefenderRemovalCases } from "./fixtures/kingDefenderRemoval";

const fen = "8/2k5/3b3R/8/5r2/6K1/8/R7 w - - 0 1";

test("removing a king's capture guard needs legality evidence, not an illegal exchange value", () => {
    const root = replayTacticalLine(fen, ["h6d6"])[0];
    const capture = { from: parseSquare("g3")!, to: parseSquare("f4")! };
    expect(root.before.isLegal(capture)).toBe(false);
    const unguarded = root.before.clone();
    unguarded.board.take(parseSquare("d6")!);
    expect(unguarded.isLegal(capture)).toBe(true);
    expect(tacticalExchangeGain(root.before, capture)).toBe(-20000);
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["h6d6"] }).motifs[0]?.id).toBe(
        "capturingDefender",
    );
});

test.each(kingDefenderRemovalCases)(
    "$id has the same defended-capture judgement in both colours",
    (item) => {
        for (const reflected of [false, true]) {
            const position = reflected ? reflectMixedForkFen(item.fen) : item.fen;
            const move = reflected ? reflectMixedForkMove(item.move) : item.move;
            const root = replayTacticalLine(position, [move])[0];
            expect(root).toBeDefined();
            const proof = proveKingCaptureDefenderRemoval(root);
            expect(Boolean(proof)).toBe(item.positive);
        }
    },
);

test.each(kingDefenderRemovalCases.filter((item) => item.positive))(
    "$id covers every defence without requiring a supplied continuation",
    (item) => {
        for (const reflected of [false, true]) {
            const position = reflected ? reflectMixedForkFen(item.fen) : item.fen;
            const move = reflected ? reflectMixedForkMove(item.move) : item.move;
            const root = replayTacticalLine(position, [move])[0];
            const proof = proveKingCaptureDefenderRemoval(root);
            const themes = classifyPositionTacticalMotifs({ fen: position, pvUci: [move] });
            expect(themes.motifs[0]).toMatchObject({
                id: "capturingDefender",
                ply: 1,
                moveUci: move,
                value: proof!.gain,
            });
            expect(themes.motifs[0].evidence).toContain("could not legally take");
            const replies = [...root.after.allDests()].flatMap(([from, tos]) =>
                [...tos].map((to) => ({ from, to })),
            );
            expect(proof!.branches).toHaveLength(replies.length);
            for (const branch of proof!.branches) {
                const steps = replayTacticalLine(makeFen(root.after.toSetup()), [
                    branch.replyUci,
                    branch.answerUci,
                ]);
                expect(steps).toHaveLength(2);
                expect(branch.gain).toBeGreaterThanOrEqual(90);
                for (const decision of branch.counterchecks)
                    expect(replayTacticalLine(decision.fen, [decision.moveUci])).toHaveLength(1);
            }
        }
    },
);

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "an incomplete budget cannot borrow a cached certificate: %s",
    (limit) => {
        const root = replayTacticalLine(fen, ["h6d6"])[0];
        expect(proveKingCaptureDefenderRemoval(root)).not.toBeNull();
        expect(proveKingCaptureDefenderRemoval(root, limit)).toBeNull();
    },
);

test("root-only, accepted and declined lines share the initiating lesson and correct board geometry", () => {
    for (const pvUci of [["h6d6"], ["h6d6", "c7d6", "g3f4"], ["h6d6", "f4f8", "d6d3"]]) {
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(pvUci.length);
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "capturingDefender", ply: 1 });
        expect(tacticalBoardEvidence(fen, pvUci, result.motifs[0])).toEqual({
            square: "d6",
            arrows: [
                { from: "d6", to: "f4" },
                { from: "g3", to: "f4" },
            ],
        });
        const scan = buildLiveTacticalScan({
            fen,
            pvUci,
            depth: 16,
            engineName: "Constructed mechanism",
        });
        expect(scan.motifs[0]?.id).toBe("capturingDefender");
    }
});

test("missing the defender capture explains the root opportunity; playing it is not a miss", () => {
    const args = { fen, bestMoveUci: "h6d6", pvUci: ["h6d6", "c7d6", "g3f4"] };
    const missed = classifyMistakeReviewMotifs({ ...args, playedMoveUci: "a1b1" });
    expect(buildMistakeReviewTacticalExplanation(missed)?.primary).toMatchObject({
        id: "capturingDefender",
        source: "missed",
        ply: 1,
    });
    const played = classifyMistakeReviewMotifs({ ...args, playedMoveUci: "h6d6" });
    expect(played.missedMotifs).toEqual([]);
});

test("acceptance and the king capture do not invent a second free rook", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["h6d6", "c7d6", "g3f4"] });
    expect(result.timeline?.filter((m) => m.ply === 2 && m.id === "hangingPiece")).toEqual([]);
    expect(result.timeline?.filter((m) => m.ply === 3 && (m.value ?? 0) > 330)).toEqual([]);
    expect(result.timeline).toContainEqual(
        expect.objectContaining({
            label: "Defender Removal Payoff",
            ply: 3,
            moveUci: "g3f4",
            value: undefined,
        }),
    );
    const reached = replayTacticalLine(fen, ["h6d6", "c7d6"])[1].after;
    const isolated = classifyPositionTacticalMotifs({
        fen: makeFen(reached.toSetup()),
        pvUci: ["g3f4"],
    });
    expect(isolated.motifs[0]).toMatchObject({ label: "Hanging Piece", value: 500 });
    expect(isolated.timeline?.some((m) => m.label === "Defender Removal Payoff")).toBe(false);
});

test.skipIf(!process.env.TACTICAL_KING_REMOVAL_REPLAY || !process.env.TACTICAL_KING_REMOVAL_REPORT)(
    "inspect private king capture guard removal",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const report = JSON.parse(readFileSync(process.env.TACTICAL_KING_REMOVAL_REPLAY!, "utf8"));
        const row = report.results.find((r: any) => r.id === process.env.TACTICAL_KING_REMOVAL_ID);
        expect(row).toBeDefined();
        const root = replayTacticalLine(row.fen, [row.before[0].pvUci[0]])[0];
        const failures: string[] = [];
        const proof = proveKingCaptureDefenderRemoval(root, 4096, (reason) =>
            failures.push(reason),
        );
        const output = privateReportPath(process.env.TACTICAL_KING_REMOVAL_REPORT!);
        expect(existsSync(output)).toBe(false);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    proof,
                    failures,
                    classification: classifyPositionTacticalMotifs({
                        fen: row.fen,
                        pvUci: row.before[0].pvUci,
                    }),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        expect(failures).toEqual([]);
        expect(proof).not.toBeNull();
    },
);
