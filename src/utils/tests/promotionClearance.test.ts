import { readFileSync, writeFileSync } from "node:fs";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import type { Square } from "chessops/types";
import { expect, test } from "vitest";
import {
    provePromotionClearance,
    promotionClearanceEpisodeLength,
    replayTacticalLine,
    tacticalBoardEvidence,
    normalizePromotionClearanceTimeline,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    promotionClearanceFen as fen,
    promotionClearanceLine as line,
    promotionClearanceControls as controls,
} from "./fixtures/promotionClearance";

test("the source puzzle and every selected root/recovery defence are legally accounted for", () => {
    const sample = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/cross-phase-development.json", "utf8"),
    );
    const row = sample.cases.find((r: { id: string }) => r.id === "lichess:brn5j");
    expect(row.startFen).toBe(fen);
    expect(row.bestLine).toEqual(line.slice(0, 5));
    const root = replayTacticalLine(fen, line)[0],
        proof = provePromotionClearance(root)!;
    expect(proof.gain).toBe(500);
    expect(proof.visits).toBeLessThanOrEqual(4096);
    expect(proof.branches).toHaveLength(20);
    const legal = (pos: typeof root.before) =>
        [...pos.allDests()].flatMap(([from, tos]) => [...tos].map((to) => makeUci({ from, to })));
    expect(new Set(proof.branches.map((b) => b.replyUci))).toEqual(new Set(legal(root.after)));
    let decisions = 0;
    const walk = (node: (typeof proof.branches)[number]["node"]) => {
        decisions++;
        const move = replayTacticalLine(node.fen, [node.moveUci])[0];
        expect(move).toBeDefined();
        if (!node.replies) return;
        expect(new Set(node.replies.map((r) => r.replyUci))).toEqual(new Set(legal(move.after)));
        for (const reply of node.replies) {
            const next = replayTacticalLine(makeFen(move.after.toSetup()), [reply.replyUci])[0];
            expect(makeFen(next.after.toSetup())).toBe(reply.next.fen);
            walk(reply.next);
        }
    };
    for (const branch of proof.branches) {
        expect(
            makeFen(replayTacticalLine(fen, [line[0], branch.replyUci])[1].after.toSetup()),
        ).toBe(branch.node.fen);
        walk(branch.node);
    }
    expect(decisions).toBe(38);
});
test.each([1, 3, 5, 9])(
    "root clearance does not depend on a supplied future promotion: %s plies",
    (length) => {
        const input = { fen, pvUci: line.slice(0, length) },
            result = classifyPositionTacticalMotifs(input);
        expect(result.motifs[0]).toMatchObject({
            id: "clearance",
            label: "Promotion Clearance",
            ply: 1,
            value: 500,
        });
        const scan = buildLiveTacticalScan({ ...input, depth: 16, engineName: "Regression" });
        expect(scan.labels.map((l) => [l.id, l.square])).toEqual([["clearance", "c6"]]);
        expect(scan.arrows.map((a) => [a.from, a.to])).toEqual([
            ["c6", "c7"],
            ["b6", "c6"],
        ]);
        expect(tacticalBoardEvidence(fen, input.pvUci, result.motifs[0])).toEqual({
            square: "c6",
            arrows: [{ from: "b6", to: "c6" }],
        });
    },
);
test("the actual fork, countercapture and promotion retain distinct explanatory roles", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.map((m) => [m.ply, m.label, m.value])).toEqual([
        [1, "Promotion Clearance", 500],
        [5, "Fork", 500],
        [7, "Fork Payoff", undefined],
        [8, "Countercapture", 0],
        [9, "Promotion", undefined],
    ]);
    expect(result.timeline?.find((m) => m.ply === 8)?.evidence).toContain(
        "c8=Q preserves the verified combination",
    );
    expect(result.timeline?.find((m) => m.ply === 5)?.evidence).toContain("any compensation");
    expect(result.timeline?.some((m) => m.id === "skewer")).toBe(false);
});
test("only the exact certified branch extends the episode and normalizes its captures", () => {
    const steps = replayTacticalLine(fen, line);
    expect(promotionClearanceEpisodeLength(steps)).toBe(9);
    const diverted = replayTacticalLine(fen, [...line.slice(0, 4), "f1h2", "g4g5"]);
    expect(diverted).toHaveLength(6);
    expect(promotionClearanceEpisodeLength(diverted)).toBe(4);
    const motif = {
        id: "skewer",
        label: "Skewer",
        confidence: "high" as const,
        source: "available" as const,
        ply: 5,
        moveUci: diverted[4].uci,
        value: 100,
        evidence: "Independent alternate line",
        relevance: "secondary" as const,
    };
    expect(normalizePromotionClearanceTimeline(diverted, [motif])).toEqual([motif]);
    const capture = {
        ...motif,
        id: "hangingPiece",
        label: "Hanging Piece",
        ply: 2,
        moveUci: line[7],
        value: 500,
    };
    expect(normalizePromotionClearanceTimeline(steps.slice(6), [capture])).toEqual([capture]);
});
test.each(controls)(
    "a concrete missing resource or counterplay cannot acquire this certificate: $id",
    (control) => {
        const root = replayTacticalLine(control.fen, [line[0]])[0];
        expect(root).toBeDefined();
        expect(provePromotionClearance(root)).toBeNull();
        expect(
            classifyPositionTacticalMotifs({ fen: control.fen, pvUci: [line[0]] }).motifs.some(
                (m) => m.label === "Promotion Clearance",
            ),
        ).toBe(false);
    },
);
test("removing the knight really permits immediate mate, not merely a failed fork detector", () => {
    const control = controls.find((c) => c.id === "no-forking-knight")!;
    const steps = replayTacticalLine(control.fen, [line[0], "a2a1"]);
    expect(steps).toHaveLength(2);
    expect(steps[1].after.isCheckmate()).toBe(true);
});
test.each([0, 1, 64, -1, 1.5, NaN, Infinity])(
    "partial/invalid budgets cannot borrow a cached complete proof: %s",
    (limit) => {
        const root = replayTacticalLine(fen, [line[0]])[0];
        expect(provePromotionClearance(root)?.gain).toBe(500);
        expect(provePromotionClearance(root, limit)).toBeNull();
    },
);
test.each([7, 56, 63])(
    "the mechanism, compensation and actual-ply timeline survive reflection %s",
    (flip) => {
        const setup = parseFen(fen).unwrap(),
            original = setup.board;
        setup.board = original.clone();
        setup.board.clear();
        for (const [square, piece] of original)
            setup.board.set((square ^ flip) as Square, {
                ...piece,
                color: flip & 56 ? (piece.color === "white" ? "black" : "white") : piece.color,
            });
        if (flip & 56) setup.turn = setup.turn === "white" ? "black" : "white";
        const pvUci = line.map((uci) => {
            const move = parseUci(uci)!;
            if (!("from" in move)) throw new Error("Unexpected drop");
            return makeUci({
                ...move,
                from: (move.from ^ flip) as Square,
                to: (move.to ^ flip) as Square,
            });
        });
        const input = { fen: makeFen(setup), pvUci };
        expect(provePromotionClearance(replayTacticalLine(input.fen, pvUci)[0])?.gain).toBe(500);
        expect(
            classifyPositionTacticalMotifs(input).timeline?.map((m) => [m.ply, m.label, m.value]),
        ).toEqual(
            classifyPositionTacticalMotifs({ fen, pvUci: line }).timeline?.map((m) => [
                m.ply,
                m.label,
                m.value,
            ]),
        );
    },
);
test("missed opportunities retain the root mechanism and the real secondary fork", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "b6b8",
        bestMoveUci: line[0],
        pvUci: line,
    });
    expect(review.missedMotifs[0]).toMatchObject({
        id: "clearance",
        label: "Promotion Clearance",
        ply: 1,
    });
    expect(review.missedTimeline?.find((m) => m.id === "fork")).toMatchObject({
        ply: 5,
        value: 500,
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "clearance",
        source: "missed",
    });
});
test("an opponent clearance remains neutral when a legal alternative has no causal comparison", () => {
    const previousFen = "8/8/1RP5/p3n3/6k1/1P6/r6p/5N1K b - - 2 60";
    expect(replayTacticalLine(previousFen, ["a2a1"])).toHaveLength(1);
    const review = classifyMistakeReviewMotifs({
        fen: previousFen,
        playedMoveUci: "g4h3",
        bestMoveUci: "a2a1",
        pvUci: ["a2a1"],
        refutationUci: line,
    });
    expect(review.allowedMotifs[0]).toMatchObject({ id: "clearance", ply: 1 });
    expect(review.allowedMotifs[0].comparison).toBeUndefined();
    expect(buildMistakeReviewTacticalExplanation(review)?.text).toContain(
        "not a verified explanation of the mistake",
    );
});
test.skipIf(!process.env.TACTICAL_PROMOTION_CLEARANCE_REPORT)(
    "export the complete current proof for independent witness checks",
    () => {
        const root = replayTacticalLine(fen, line)[0],
            proof = provePromotionClearance(root)!;
        expect(proof.gain).toBe(500);
        writeFileSync(
            process.env.TACTICAL_PROMOTION_CLEARANCE_REPORT!,
            JSON.stringify(
                {
                    fen,
                    pvUci: line.slice(0, 5),
                    proof,
                    result: classifyPositionTacticalMotifs({ fen, pvUci: line }),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
