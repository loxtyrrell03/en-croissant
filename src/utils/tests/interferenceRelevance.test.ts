import { readFileSync, writeFileSync } from "node:fs";
import { makeFen, parseFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { makeUci, parseSquare, parseUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveInterferenceContinuation,
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    interferenceExamples,
    interferenceControls,
    compensatedInterference,
} from "./fixtures/interferenceRelevance";

const sq = (name: string) => parseSquare(name)!;
test.each(interferenceExamples)(
    "independently covers every root and restored-defence reply: $id",
    (item) => {
        const root = replayTacticalLine(item.fen, item.pvUci)[0];
        const proof = proveInterferenceContinuation(root, sq(item.defender), sq(item.target))!;
        expect(proof.gain).toBe(item.gain);
        expect(proof.visits).toBeLessThanOrEqual(4096);
        expect(proof.branches).toHaveLength(item.branches);
        expect(new Set(proof.branches.map((b) => b.replyUci))).toEqual(
            new Set(
                [...root.after.allDests()].flatMap(([from, tos]) =>
                    [...tos].map((to) => makeUci({ from, to })),
                ),
            ),
        );
        const recovery = proof.branches.find((b) => b.replyUci === item.reply)!;
        expect(recovery).toMatchObject({ answerUci: item.answer, kind: item.kind });
        const leaves = recovery.continuation ?? recovery.recut!;
        expect(leaves).toHaveLength(item.recoveries);
        const after = replayTacticalLine(recovery.fen, [recovery.answerUci])[0].after;
        expect(new Set(leaves.map((leaf) => leaf.fen))).toEqual(
            new Set(
                [...after.allDests()].flatMap(([from, tos]) =>
                    [...tos].map((to) => {
                        const next = after.clone();
                        next.play({ from, to });
                        return makeFen(next.toSetup());
                    }),
                ),
            ),
        );
        for (const leaf of leaves)
            expect(
                replayTacticalLine(leaf.fen, ["moveUci" in leaf ? leaf.moveUci : leaf.answerUci]),
            ).toHaveLength(1);
    },
);

test.each(interferenceExamples)(
    "root-only, source and alternative continuations retain the same primary cause: $id",
    (item) => {
        for (const pvUci of [
            item.pvUci.slice(0, 1),
            item.pvUci,
            [item.pvUci[0], item.reply, item.answer],
        ]) {
            const result = classifyPositionTacticalMotifs({ fen: item.fen, pvUci });
            expect(result.motifs[0]).toMatchObject({
                id: "interference",
                ply: 1,
                moveUci: item.pvUci[0],
                value: item.gain,
            });
            expect(result.motifs[0].evidence).toContain(
                item.kind === "recut"
                    ? "f5 cuts the same defender's line again"
                    : "Bxd3 removes it",
            );
            const board = tacticalBoardEvidence(item.fen, pvUci, result.motifs[0])!;
            expect(board.square).toBe(item.id === "DBBd9" ? "b5" : "e4");
            expect(board.arrows).toContainEqual({ from: item.defender, to: board.square });
            const scan = buildLiveTacticalScan({
                fen: item.fen,
                pvUci,
                depth: 16,
                engineName: "Regression",
            });
            expect(scan.motifs[0]).toMatchObject({ id: "interference", ply: 1 });
            expect(scan.labels.map((l) => l.id)).toEqual(["interference"]);
            expect(scan.arrows.some((a) => a.to === (item.id === "DBBd9" ? "f5" : "d3"))).toBe(
                false,
            );
        }
    },
);

test("the second cut is retained at its actual ply without duplicating root board labels", () => {
    const item = interferenceExamples[1],
        result = classifyPositionTacticalMotifs(item);
    expect(
        result.timeline
            ?.filter((m) => m.id === "interference")
            .map((m) => [m.ply, m.relevance, m.value]),
    ).toEqual([
        [1, "primary", 220],
        [3, "secondary", 220],
    ]);
});

test.each(interferenceControls)(
    "a required legal branch cannot be replaced by a cooperative material capture: $id",
    (item) => {
        const steps = replayTacticalLine(item.fen, [item.move, item.reply]);
        expect(steps).toHaveLength(2);
        expect(
            proveInterferenceContinuation(steps[0], sq(item.defender), sq(item.target)),
        ).toBeNull();
        expect(
            classifyPositionTacticalMotifs({ fen: item.fen, pvUci: [item.move] }).motifs.some(
                (m) => m.id === "interference",
            ),
        ).toBe(false);
    },
);

test("taking the tempting queen really allows mate in the constructed control", () => {
    const item = interferenceControls.find((c) => c.id === "mating-counterplay")!;
    const steps = replayTacticalLine(item.fen, [item.move, item.reply, "h1h7", "b2b1"]);
    expect(steps).toHaveLength(4);
    expect(steps[3].after.isCheckmate()).toBe(true);
    expect(classifyPositionTacticalMotifs({ fen: item.fen, pvUci: [item.move] }).motifs).toEqual(
        [],
    );
});

test("the discarded king-flight control permits promotion mate instead of refuting the attack", () => {
    const item = interferenceControls.find((c) => c.id === "mating-counterplay")!;
    const refutedControl = replayTacticalLine(item.fen, [item.move, "d8c8", "e7e8q"]);
    expect(refutedControl).toHaveLength(3);
    expect(refutedControl[2].after.isCheckmate()).toBe(true);
    expect(replayTacticalLine(item.fen, [item.move, item.reply, "e7e8q"])).toHaveLength(2);
});

test("the old real rook gain debits the blocking pawn captured elsewhere", () => {
    const result = classifyPositionTacticalMotifs(compensatedInterference);
    expect(result.motifs[0]).toMatchObject({ id: "interference", ply: 1, value: 400 });
    const steps = replayTacticalLine(compensatedInterference.fen, ["c4c3", "a5a7", "c7a7", "d2c3"]);
    expect(steps).toHaveLength(4);
    expect(steps[3].balance).toBe(400);
    expect(tacticalExchangeGain(steps[3].before, steps[3].move)).toBe(100);
});

test("the reinforced bishop line includes the rook exchanges when computing its lower bound", () => {
    const item = interferenceExamples[0];
    const steps = replayTacticalLine(item.fen, ["b7e4", "e2d3", "e4d3", "e1e7", "e8e7"]);
    expect(steps).toHaveLength(5);
    const leaf = steps[4];
    expect(leaf.balance - leaf.capture + tacticalExchangeGain(leaf.before, leaf.move)).toBe(150);
});

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "invalid or partial recovery limits cannot reuse cached success: %s",
    (limit) => {
        for (const item of interferenceExamples) {
            const step = replayTacticalLine(item.fen, item.pvUci)[0];
            expect(
                proveInterferenceContinuation(step, sq(item.defender), sq(item.target))?.gain,
            ).toBe(item.gain);
            expect(
                proveInterferenceContinuation(step, sq(item.defender), sq(item.target), limit),
            ).toBeNull();
        }
    },
);

test.each(interferenceExamples)(
    "missed lessons use the first interference, not the later capture: $id",
    (item) => {
        const played = item.id === "DBBd9" ? "d8e8" : "e7e5";
        expect(replayTacticalLine(item.fen, [played])).toHaveLength(1);
        const review = classifyMistakeReviewMotifs({
            fen: item.fen,
            playedMoveUci: played,
            bestMoveUci: item.pvUci[0],
            pvUci: item.pvUci,
        });
        expect(review.missedMotifs[0]).toMatchObject({
            id: "interference",
            source: "missed",
            ply: 1,
            value: item.gain,
        });
        expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
            id: "interference",
            source: "missed",
        });
    },
);

test.each(interferenceExamples)(
    "an opponent continuation is not unsupported proof of why the move was a mistake: $id",
    (item) => {
        const fixture = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/secondary-theme-development.json", "utf8"),
        );
        const row = fixture.cases.find((r: { id: string }) => r.id === `lichess:${item.id}`);
        const better = item.id === "DBBd9" ? "e5f3" : "d4f3";
        expect(replayTacticalLine(row.sourceFen, [better])).toHaveLength(1);
        const review = classifyMistakeReviewMotifs({
            fen: row.sourceFen,
            playedMoveUci: row.precedingMove,
            bestMoveUci: better,
            pvUci: [better],
            refutationUci: item.pvUci,
        });
        expect(review.allowedMotifs[0]).toMatchObject({ id: "interference", ply: 1 });
        expect(review.allowedMotifs[0].comparison).toBeUndefined();
        expect(buildMistakeReviewTacticalExplanation(review)?.text).toContain(
            "not a verified explanation of the mistake",
        );
    },
);

function reflected(fen: string, line: string[], flip: number) {
    const setup = parseFen(fen).unwrap(),
        board = setup.board;
    expect(setup.castlingRights.isEmpty()).toBe(true);
    setup.board = board.clone();
    setup.board.clear();
    for (const [square, piece] of board)
        setup.board.set((square ^ flip) as Square, {
            ...piece,
            color: flip & 56 ? (piece.color === "white" ? "black" : "white") : piece.color,
        });
    if (flip & 56) setup.turn = setup.turn === "white" ? "black" : "white";
    if (setup.epSquare !== undefined) setup.epSquare = (setup.epSquare ^ flip) as Square;
    return {
        fen: makeFen(setup),
        pvUci: line.map((uci) => {
            const move = parseUci(uci)!;
            if (!("from" in move)) throw new Error("Unexpected drop");
            return makeUci({
                ...move,
                from: (move.from ^ flip) as Square,
                to: (move.to ^ flip) as Square,
            });
        }),
    };
}
test.each([7, 56, 63])("the proof and primary cause survive reflection %s", (flip) => {
    for (const item of interferenceExamples) {
        const input = reflected(item.fen, item.pvUci, flip),
            step = replayTacticalLine(input.fen, input.pvUci)[0];
        expect(
            proveInterferenceContinuation(
                step,
                (sq(item.defender) ^ flip) as Square,
                (sq(item.target) ^ flip) as Square,
            )?.gain,
        ).toBe(item.gain);
        expect(classifyPositionTacticalMotifs(input).motifs[0]).toMatchObject({
            id: "interference",
            ply: 1,
            value: item.gain,
        });
    }
});

test.skipIf(!process.env.TACTICAL_INTERFERENCE_WITNESS_REPORT)(
    "export legal all-defence witnesses for independent engine review",
    () => {
        const cases = interferenceExamples.map((item) => {
            const step = replayTacticalLine(item.fen, item.pvUci)[0],
                proof = proveInterferenceContinuation(step, sq(item.defender), sq(item.target));
            expect(proof?.gain).toBe(item.gain);
            return {
                id: item.id,
                row: { startFen: item.fen, bestLine: item.pvUci },
                proof,
                result: classifyPositionTacticalMotifs(item),
            };
        });
        const rareStep = replayTacticalLine(
            compensatedInterference.fen,
            compensatedInterference.pvUci,
        )[0];
        const rareProof = proveInterferenceContinuation(rareStep, sq("d2"), sq("a5"));
        expect(rareProof?.gain).toBe(400);
        writeFileSync(
            process.env.TACTICAL_INTERFERENCE_WITNESS_REPORT!,
            JSON.stringify(
                { cases, compensated: { ...compensatedInterference, proof: rareProof } },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
