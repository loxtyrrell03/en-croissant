import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSquare, makeUci, parseSquare, parseUci } from "chessops/util";
import {
    balance,
    enumerateLtbye,
    inspectNextDefences,
    legalMoves,
    play,
    position,
} from "./ltbye-intermediate-audit.mjs";
import {
    intermediateCaptureProof,
    proveDefenderCombination,
    replayTacticalLine,
} from "../../src/utils/tacticalMotifs/causalTactics";
import * as proofCore from "../../src/utils/tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "../../src/utils/tests/fixtures/mixedTargetFork";

type Leaf = {
    fen: string;
    moveUci: string;
    balance: number;
    gain: number;
    quiet: boolean;
    lineUci?: string[];
    counterchecks?: { fen: string; moveUci: string }[];
};
type Step = ReturnType<typeof replayTacticalLine>[number];
const enumeration = enumerateLtbye();
const cases: unknown[] = [],
    controls: unknown[] = [];
const sourceRef = process.env.RARE_CAUSAL_COHORT_V2_REF ?? "working-source";
const readSource = (path: string) =>
    sourceRef !== "working-source"
        ? execFileSync("git", [
              "-c",
              "safe.directory=C:/Users/Lox/Desktop/repo/en-croissant",
              "show",
              `${sourceRef}:${path}`,
          ])
        : readFileSync(path);
const watchedSources = ["causalTactics.ts", "mistakeReviewAdapter.ts"];
if (readSource("src/utils/tacticalMotifs/causalTactics.ts").includes("./quietIntermediateCapture"))
    watchedSources.push("quietIntermediateCapture.ts");
const hashes = () =>
    Object.fromEntries(
        watchedSources.map((file) => {
            const path = `src/utils/tacticalMotifs/${file}`;
            const bytes = readSource(path);
            return [path, createHash("sha256").update(bytes).digest("hex")];
        }),
    );
const beforeHashes = hashes();
const compactDefences = (rows: ReturnType<typeof inspectNextDefences>) =>
    rows.map((row) => ({
        ...row,
        minimumReplyCount: row.minimumReplies.length,
        minimumReplies: row.minimumReplies.slice(0, 2),
    }));
function fixture(reflected: boolean) {
    const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
    const previousFen = reflected
        ? reflectMixedForkFen(enumeration.previousFen)
        : enumeration.previousFen;
    const before = replayTacticalLine(previousFen, [move(enumeration.previousMove)])[0];
    return {
        move,
        previousFen,
        previousMove: move(enumeration.previousMove),
        fen: makeFen(before.after.toSetup()),
    };
}
function kernel(
    step: Step,
    targets: string[],
    capturers: string[],
    minimumGain: number,
    budget: { nodes: number },
) {
    const leaves: Leaf[] = [],
        trace: unknown[] = [],
        start = budget.nodes;
    const gain = proveDefenderCombination(
        step,
        targets.map((s) => parseSquare(s)!),
        capturers.map((s) => parseSquare(s)!),
        16384,
        budget,
        1,
        true,
        minimumGain,
        (leaf) => leaves.push(leaf),
        true,
        (failure) => trace.push(failure),
        true,
        1,
    );
    return { gain, visits: start - budget.nodes, leaves, trace };
}
function auditLeafCoverage(step: Step, leaves: Leaf[], minimumGain: number) {
    const replies = legalMoves(step.after).map(makeUci).sort();
    expect(leaves.map((leaf) => leaf.lineUci?.[0]).sort()).toEqual(replies);
    const initial = balance(step.before, step.before.turn);
    for (const leaf of leaves) {
        const prefix = leaf.lineUci!.slice(0, -1);
        let pos = step.after;
        for (const uci of prefix) pos = play(pos, uci);
        expect(makeFen(pos.toSetup())).toBe(leaf.fen);
        expect(balance(pos, step.before.turn) - initial).toBe(leaf.balance);
        expect(pos.isLegal(parseUci(leaf.moveUci)!)).toBe(true);
        expect(leaf.gain).toBeGreaterThanOrEqual(minimumGain);
        for (const counter of leaf.counterchecks ?? []) {
            const checked = position(counter.fen);
            expect(checked.isLegal(parseUci(counter.moveUci)!)).toBe(true);
        }
    }
    return inspectNextDefences(makeFen(step.before.toSetup()), step.uci, leaves, minimumGain);
}

test("the public quiet root has exactly31 legal replies, including two counterchecks", () => {
    expect(enumeration.rootChecks).toBe(false);
    expect(enumeration.previousCapture).toBe(500);
    expect(enumeration.branches).toHaveLength(31);
    expect(
        enumeration.branches
            .filter((row) => row.check)
            .map((row) => row.reply)
            .sort(),
    ).toEqual(["a5c3", "c1d2"]);
});
for (const reflected of [false, true]) {
    test(`all-reply forward and reversed local certificates fit one fixed budget, reflected=${reflected}`, () => {
        const row = fixture(reflected),
            m = row.move;
        const square = (s: string) => (reflected ? reflectMixedForkMove(s) : s);
        const root = replayTacticalLine(row.fen, [m("d5e6")])[0];
        const reverse = replayTacticalLine(row.fen, [m("c2c1"), m("e6d5")])[1];
        const budget = { nodes: 16384 };
        const forward = kernel(
            root,
            [square("c1"), square("c8")],
            [square("c2"), square("e6")],
            230,
            budget,
        );
        const reversed = kernel(reverse, [], [square("d5")], 330, budget);
        expect(forward.gain).toBe(230);
        expect(reversed.gain).toBe(330);
        expect(forward.trace).toEqual([]);
        expect(reversed.trace).toEqual([]);
        expect(budget.nodes).toBeGreaterThan(0);
        const nextForward = auditLeafCoverage(root, forward.leaves, 230);
        const nextReverse = auditLeafCoverage(reverse, reversed.leaves, 330);
        expect(nextForward.reduce((n, row) => n + row.replyCount, 0)).toBe(861);
        expect(nextReverse.reduce((n, row) => n + row.replyCount, 0)).toBe(873);
        expect(Math.min(...nextForward.map((row) => row.materialFloor))).toBe(230);
        // Fixed-depth totals alone are not a reverse-order proof: pawn grabs
        // temporarily dip below330 before a legal recovery or check evasion.
        const repairs = nextReverse.flatMap((row) => row.belowRequired);
        expect(repairs.length).toBeGreaterThan(0);
        expect(repairs.every((row) => row.legalImmediateRepair !== null)).toBe(true);
        expect(
            [...nextForward, ...nextReverse]
                .flatMap((row) => row.checkingReplies)
                .some((reply) => reply.checkmate),
        ).toBe(false);
        const quietAdmission =
            typeof proofCore.proveQuietIntermediateCapture === "function"
                ? proofCore.proveQuietIntermediateCapture(root)
                : null;
        const classifierRootOnly = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: [m("d5e6")],
        });
        const classifierFull = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: ["d5e6", "f7e6", "c2c1"].map(m),
            previousFen: row.previousFen,
            previousMoveUci: row.previousMove,
        });
        expect(intermediateCaptureProof(root)).toBeNull();
        const baseline = /adapter-(172|173)$/.test(MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION);
        expect(
            quietAdmission && {
                gain: quietAdmission.gain,
                recovery: quietAdmission.recovery,
                extra: quietAdmission.extra,
            },
        ).toEqual(baseline ? null : { gain: 230, recovery: 330, extra: 230 });
        expect(classifierRootOnly.motifs.map(({ id, value }) => ({ id, value }))).toEqual(
            baseline ? [] : [{ id: "intermezzo", value: 230 }],
        );
        expect(classifierFull.motifs.map(({ id, value }) => ({ id, value }))).toEqual(
            baseline ? [] : [{ id: "intermezzo", value: 0 }],
        );
        cases.push({
            reflected,
            fen: row.fen,
            previousFen: row.previousFen,
            previousMove: row.previousMove,
            forward: { ...forward, nextDefences: compactDefences(nextForward) },
            reverse: { ...reversed, nextDefences: compactDefences(nextReverse) },
            totalKernelVisits: 16384 - budget.nodes,
            currentIntermediateAdmission: intermediateCaptureProof(root),
            quietAdmission,
            classifierRootOnly,
            classifierFull,
        });
    });
    test(`necessary participants, safe retreat and off-square liability have distinct outcomes, reflected=${reflected}`, () => {
        const row = fixture(reflected),
            m = row.move,
            s = (square: string) => parseSquare(reflected ? reflectMixedForkMove(square) : square)!;
        for (const kind of [
            "missing-deferred-bishop",
            "missing-rook-target",
            "missing-root-victim",
            "off-square-queen-liability",
        ]) {
            const pos = position(row.fen);
            if (kind === "missing-deferred-bishop") pos.board.take(s("c1"));
            if (kind === "missing-rook-target") pos.board.take(s("c8"));
            if (kind === "missing-root-victim") pos.board.take(s("e6"));
            if (kind === "off-square-queen-liability")
                pos.board.set(s("c3"), {
                    role: "rook",
                    color: pos.turn === "white" ? "black" : "white",
                });
            const fen = makeFen(pos.toSetup()),
                root = replayTacticalLine(fen, [m("d5e6")])[0],
                budget = { nodes: 16384 };
            expect(root).toBeDefined();
            const result = kernel(
                root,
                [s("c1"), s("c8")].map(makeSquare),
                [s("c2"), s("e6")].map(makeSquare),
                230,
                budget,
            );
            expect(result.gain).toBe(kind === "missing-rook-target" ? 230 : null);
            expect(result.visits).toBeLessThanOrEqual(16385);
            controls.push({
                kind,
                reflected,
                fen,
                gain: result.gain,
                visits: result.visits,
                budgetExhausted: budget.nodes < 0,
                trace: result.trace,
            });
        }
        const root = replayTacticalLine(row.fen, [m("d5e6")])[0];
        for (const limit of [0, 1, 20]) {
            const result = proveDefenderCombination(
                root,
                [s("c1"), s("c8")],
                [s("c2"), s("e6")],
                limit,
                undefined,
                1,
                true,
                230,
                undefined,
                true,
                undefined,
                true,
                1,
            );
            expect(result).toBeNull();
        }
    });
    test(`move order, poisoned recapture and prior exchange debt are explicit, reflected=${reflected}`, () => {
        const row = fixture(reflected),
            m = row.move,
            root = position(row.fen),
            initial = balance(root, root.turn);
        const net = (line: string[]) => {
            let pos = root;
            for (const move of line) pos = play(pos, m(move));
            return balance(pos, root.turn) - initial;
        };
        expect(net(["d5e6", "f7e6", "c2c1"])).toBe(330);
        expect(net(["d5e6", "f7e6", "c2c1", "a5a2"])).toBe(230);
        expect(net(["c2c1", "e6d5"])).toBe(0);
        expect(net(["d5e6", "a5a3", "c2c1", "a3c1"])).toBe(-240);
        const checked = play(play(root, m("d5e6")), m("c1d2"));
        expect(checked.isCheck()).toBe(true);
        expect(checked.isLegal(parseUci(m("c2c1"))!)).toBe(false);
        expect(checked.isLegal(parseUci(m("f3d2"))!)).toBe(true);
        expect(230 - enumeration.previousCapture).toBe(-270);
        expect(0 - enumeration.previousCapture).toBe(-500);
    });
}
test("retain a bounded diagnostic, not new classifier truth labels", () => {
    expect(cases).toHaveLength(2);
    expect(controls).toHaveLength(8);
    expect(hashes()).toEqual(beforeHashes);
    if (process.env.LTBYE_AUDIT_REPORT)
        writeFileSync(
            process.env.LTBYE_AUDIT_REPORT,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    scope: "One retained public puzzle, both colours. Existing bounded kernel certificates plus independent legal coverage/material checks; not a game-theoretic win or population accuracy.",
                    sourceRef,
                    sourceHashes: beforeHashes,
                    version: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
                    enumeration: {
                        ...enumeration,
                        branches: enumeration.branches.map((row) => ({
                            reply: row.reply,
                            san: row.san,
                            fen: row.fen,
                            check: row.check,
                            capture: row.capture,
                        })),
                    },
                    cases,
                    controls,
                    accounting: {
                        forwardCurrentRoot: 230,
                        immediateCapture: 330,
                        reversedRecovery: 330,
                        reverseCurrentRootUpper: 0,
                        moveOrderImprovementLower: 230,
                        previousRookDebt: 500,
                        forwardIncludingPriorDebt: -270,
                        reverseIncludingPriorDebtUpper: -500,
                    },
                    boundary: /adapter-(172|173)$/.test(MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION)
                        ? "Frozen baseline: quiet Bxe6 is rejected by checking-only intermediate admission. Shared bounded kernel contrast is evidence, not current classifier admission."
                        : "Quiet admission now proves both orders separately under one budget. Root-only230 includes exact previous-rook debt500 as value0 in the history-aware full input; this is improved recovery, not a free-material gain. Independent finite kernel checks are not full-game proof or population accuracy.",
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});
