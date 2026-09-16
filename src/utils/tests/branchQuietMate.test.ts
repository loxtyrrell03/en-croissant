import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveCheckingMate,
    replayTacticalLine,
    preservesVerifiedMate,
    proveMateWithinThree,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    branchQuietMateCases,
    branchQuietMateChoice,
    branchQuietMateFen,
} from "./fixtures/branchQuietMate";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

function inspect(fen: string, pvUci: string[]) {
    const steps = replayTacticalLine(fen, pvUci);
    expect(steps).toHaveLength(pvUci.length);
    let proof = proveCheckingMate(steps, 65536, true);
    const short = !proof ? proveMateWithinThree(steps) : null;
    if (short) {
        const advance = (fen: string, ...moves: string[]) =>
            makeFen(replayTacticalLine(fen, moves).at(-1)!.after.toSetup());
        const afterRoot = makeFen(steps[0].after.toSetup());
        proof = {
            maxMoves: 3,
            replyCount: short.replyCount,
            example: [steps[0].san, ...short.example],
            visits: short.visits,
            strategy: {
                fen: afterRoot,
                replies: short.branches.map((branch) => {
                    const afterAttack = advance(afterRoot, branch.replyUci, branch.attackUci);
                    return {
                        move: branch.replyUci,
                        answer: branch.attackUci,
                        next: {
                            fen: afterAttack,
                            replies: (branch.replies ?? []).map((reply) => ({
                                move: reply.replyUci,
                                answer: reply.mateUci,
                                next: {
                                    fen: advance(afterAttack, reply.replyUci, reply.mateUci),
                                    replies: [],
                                },
                            })),
                        },
                    };
                }),
            },
        };
    }
    if (!proof) return { fen, pvUci, proof, quietMaximum: 0 };
    const { strategy, visits, ...production } = proof;
    if (!short) assert.deepEqual(proveCheckingMate(steps), production);
    else assert.equal(preservesVerifiedMate(steps), true);
    expect(visits).toBeLessThanOrEqual(65536);
    let quietMaximum = 0;
    const walk = (node: NonNullable<typeof strategy>, remaining: number, quiet: number) => {
        const pos = Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
        const legal = [...pos.allDests()].flatMap(([from, dests]) =>
            [...dests].flatMap((to) =>
                pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                    ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) =>
                          makeUci({ from, to, promotion }),
                      )
                    : [makeUci({ from, to })],
            ),
        );
        expect(node.replies.map((branch) => branch.move).sort()).toEqual(legal.sort());
        if (!legal.length) {
            assert(pos.isCheckmate());
            quietMaximum = Math.max(quietMaximum, quiet);
            return;
        }
        expect(pos.isEnd()).toBe(false);
        expect(remaining).toBeGreaterThan(0);
        expect(pos.halfmoves).toBeLessThan(100);
        for (const branch of node.replies) {
            const after = pos.clone();
            after.play(parseUci(branch.move)!);
            expect(after.isEnd()).toBe(false);
            const answer = parseUci(branch.answer)!;
            expect(after.isLegal(answer)).toBe(true);
            after.play(answer);
            expect(makeFen(after.toSetup())).toBe(branch.next.fen);
            walk(branch.next, remaining - 1, quiet + Number(!after.isCheck()));
        }
    };
    expect(strategy!.fen).toBe(makeFen(steps[0].after.toSetup()));
    walk(strategy!, proof.maxMoves - 1, 0);
    return { fen, pvUci, proof, quietMaximum };
}

const cases = branchQuietMateCases.flatMap((row) =>
    [false, true].map((reflected) => ({
        ...row,
        id: `${row.id}:${reflected}`,
        fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
        pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
    })),
);

test.each(cases)("branch-dependent checking roles retain full defensive proof: $id", (row) => {
    const checked = inspect(row.fen, row.pvUci);
    expect(!!checked.proof).toBe(row.positive);
    const scan = buildLiveTacticalScan({
        ...row,
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.motifs[0]?.id).toBe(row.positive ? "mateIn4" : undefined);
    if (!checked.proof) return;
    expect(checked.proof.maxMoves).toBe(4);
    expect(checked.quietMaximum).toBe(2);
    const failures: string[] = [];
    const steps = replayTacticalLine(row.fen, row.pvUci);
    expect(
        proveCheckingMate(steps, checked.proof.visits, true, (reason) => failures.push(reason)),
    ).toEqual(checked.proof);
    expect(failures).toEqual([]);
    expect(proveCheckingMate(steps, checked.proof.visits! - 1, true)).toBeNull();
    expect(scan.labels.map((label) => label.id)).toEqual(["mateIn4"]);
    expect(scan.variations[0].timeline?.some((motif) => motif.ply === 7)).toBe(true);
    expect(
        scan.arrows.every(
            (arrow) =>
                arrow.from === row.pvUci[0].slice(0, 2) || arrow.from === row.pvUci[0].slice(2, 4),
        ),
    ).toBe(true);
    for (const limit of [0, 1, -1, NaN, Infinity, 1.5])
        expect(proveCheckingMate(replayTacticalLine(row.fen, row.pvUci), limit)).toBeNull();
});

test("failure diagnostics cannot change normal results or borrow cached proofs", () => {
    const row = cases[0];
    const steps = replayTacticalLine(row.fen, row.pvUci);
    expect(proveCheckingMate(steps)).not.toBeNull();
    const failures: string[] = [];
    expect(proveCheckingMate(steps, 1, true, (failure) => failures.push(failure))).toBeNull();
    expect(failures.some((failure) => failure.includes("budget exhausted"))).toBe(true);
    expect(proveCheckingMate(steps)).not.toBeNull();
});

test.each([false, true])(
    "a slower verified mate is not a missed win: reflected=%s",
    (reflected) => {
        const transform = (move: string) => (reflected ? reflectMixedForkMove(move) : move);
        const fen = reflected
            ? reflectMixedForkFen(branchQuietMateChoice.fen)
            : branchQuietMateChoice.fen;
        const played = branchQuietMateChoice.pvUci.map(transform),
            best = branchQuietMateChoice.bestLine.map(transform);
        expect(inspect(fen, played).proof?.maxMoves).toBe(4);
        expect(preservesVerifiedMate(replayTacticalLine(fen, played))).toBe(true);
        const short = branchQuietMateChoice.shortLine.map(transform);
        expect(inspect(fen, short).proof?.maxMoves).toBe(3);
        expect(preservesVerifiedMate(replayTacticalLine(fen, short))).toBe(true);
        expect(classifyPositionTacticalMotifs({ fen, pvUci: short }).motifs[0]).toMatchObject({
            id: "mateIn3",
            ply: 1,
        });
        const input = {
            fen,
            bestMoveUci: best[0],
            playedMoveUci: played[0],
            pvUci: best,
            refutationUci: played.slice(1),
            cpLoss: 10000,
        };
        const result = classifyMistakeReviewMotifs(input);
        expect(result.missedMotifs).toEqual([]);
        expect(result.missedTimeline).toEqual([]);
        expect(buildMistakeReviewTacticalExplanation(result)).toBeNull();
        // Missing evidence must not borrow a prior cached all-defence proof.
        const incomplete = classifyMistakeReviewMotifs({ ...input, refutationUci: [] });
        expect(incomplete.missedMotifs[0]?.id).toBe("mateIn2");
        const defendedFen = reflected
            ? reflectMixedForkFen(branchQuietMateChoice.fen.replace("R4K1R", "R2B1K1R"))
            : branchQuietMateChoice.fen.replace("R4K1R", "R2B1K1R");
        expect(replayTacticalLine(defendedFen, played).at(-1)?.after.isCheckmate()).toBe(true);
        expect(preservesVerifiedMate(replayTacticalLine(defendedFen, played))).toBe(false);
        expect(
            classifyMistakeReviewMotifs({ ...input, fen: defendedFen }).missedMotifs[0]?.id,
        ).toBe("mateIn2");
    },
);

test.each([false, true])(
    "the shorter root mate subsumes a duplicate longer certificate: reflected=%s",
    (reflected) => {
        let fen = makeFen(
            replayTacticalLine(branchQuietMateFen, ["e7e2", "f2f1"]).at(-1)!.after.toSetup(),
        );
        let line = ["c6d4", "a2a3", "f5e3", "f1g1", "d4f3", "g2f3", "e2g2"];
        if (reflected) {
            fen = reflectMixedForkFen(fen);
            line = line.map(reflectMixedForkMove);
        }
        expect(inspect(fen, line).proof?.maxMoves).toBe(4);
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
        expect(
            result.motifs.filter((m) => m.ply === 1 && /^mateIn/.test(m.id)).map((m) => m.id),
        ).toEqual(["mateIn3"]);
        expect(result.timeline?.some((m) => m.ply === 7 && m.id === "mateIn1")).toBe(true);
    },
);

test("fresh engine decisions match the selected first answers and preserve contrary controls", () => {
    const receipt = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/branch-quiet-mate-stockfish-18.json", "utf8"),
    );
    expect(receipt.completed).toBe(18);
    expect(receipt.searches).toHaveLength(18);
    for (const row of cases) {
        const probe = receipt.searches.find((s: any) => s.id === `${row.id}:root`);
        expect(probe).toMatchObject({ fen: row.fen, searchMove: row.pvUci[0] });
        expect(probe.lines[0].pvUci[0]).toBe(row.pvUci[0]);
        const proof = proveCheckingMate(replayTacticalLine(row.fen, row.pvUci), 65536, true);
        if (proof) {
            assert.equal(probe.lines[0].mate, 4);
            for (const branch of proof.strategy!.replies) {
                const answer = receipt.searches.find(
                    (s: any) => s.id === `${row.id}:answer:${branch.move}`,
                );
                const fen = makeFen(
                    replayTacticalLine(row.fen, [row.pvUci[0], branch.move])[1].after.toSetup(),
                );
                assert.equal(answer.fen, fen);
                assert.equal(answer.searchMove, branch.answer);
                assert(answer.lines[0].mate > 0);
                assert.equal(answer.lines[0].pvUci[0], branch.answer);
            }
        } else if (/king-flight|rook-countercheck/.test(row.id)) {
            // These invalidate the supplied short certificate, not all mates.
            assert(probe.lines[0].mate > 4);
        } else if (row.id.startsWith("capturable-checker")) {
            assert(probe.lines[0].cp < 0);
        } else if (row.id.startsWith("claim-before-mate")) {
            assert.equal(probe.lines[0].cp, 0);
        } else {
            assert.equal(probe.lines[0].mate, 4); // Root-only input misses a real mate.
        }
    }
});

test("preserved mating choices retain fresh engine support for every selected first answer", () => {
    const receipt = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/branch-quiet-mate-alternatives-stockfish-18.json",
            "utf8",
        ),
    );
    expect(receipt.completed).toBe(28);
    expect(receipt.searches).toHaveLength(28);
    const rows = [
        { id: "castling-alternative", fen: "5k2/8/8/8/8/8/4R1R1/4K2R w K - 0 1", pvUci: ["e2e3"] },
        ...[false, true].map((reflected) => ({
            id: `alternative-mate:${reflected}`,
            fen: reflected
                ? reflectMixedForkFen(branchQuietMateChoice.fen)
                : branchQuietMateChoice.fen,
            pvUci: reflected
                ? branchQuietMateChoice.pvUci.map(reflectMixedForkMove)
                : branchQuietMateChoice.pvUci,
        })),
    ];
    const checkedIds = new Set<string>();
    for (const row of rows) {
        const { proof } = inspect(row.fen, row.pvUci);
        assert(proof?.strategy);
        const decisions = [
            { id: `${row.id}:root`, fen: row.fen, move: row.pvUci[0] },
            ...proof.strategy.replies.map((branch) => ({
                id: `${row.id}:answer:${branch.move}`,
                fen: makeFen(
                    replayTacticalLine(row.fen, [row.pvUci[0], branch.move])[1].after.toSetup(),
                ),
                move: branch.answer,
            })),
        ];
        for (const decision of decisions) {
            const probe = receipt.searches.find((search: any) => search.id === decision.id);
            assert(probe, `Missing fresh decision ${decision.id}`);
            assert.equal(probe.fen, decision.fen);
            assert.equal(probe.searchMove, decision.move);
            assert.equal(probe.lines[0].pvUci[0], decision.move);
            assert(probe.lines[0].mate > 0);
            checkedIds.add(decision.id);
        }
    }
    expect(checkedIds.size).toBe(receipt.completed);
});

test.skipIf(!process.env.TACTICAL_BRANCH_MATE_REPORT)(
    "export independently replayable public and optional owner strategies",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const rows: { id: string; fen: string; pvUci: string[] }[] = [
            ...cases,
            {
                id: "castling-alternative",
                fen: "5k2/8/8/8/8/8/4R1R1/4K2R w K - 0 1",
                pvUci: ["e2e3"],
            },
            ...[false, true].map((reflected) => ({
                id: `alternative-mate:${reflected}`,
                fen: reflected
                    ? reflectMixedForkFen(branchQuietMateChoice.fen)
                    : branchQuietMateChoice.fen,
                pvUci: reflected
                    ? branchQuietMateChoice.pvUci.map(reflectMixedForkMove)
                    : branchQuietMateChoice.pvUci,
            })),
        ];
        if (process.env.TACTICAL_BRANCH_MATE_OWNER_REPLAY) {
            const replay = JSON.parse(
                readFileSync(process.env.TACTICAL_BRANCH_MATE_OWNER_REPLAY, "utf8"),
            );
            const row = replay.results.find(
                (row: any) => row.id === process.env.TACTICAL_BRANCH_MATE_OWNER_CASE,
            );
            assert(row, "Supply an exact private case ID");
            rows.push(
                ...[false, true].map((reflected) => ({
                    id: `owner:${reflected}`,
                    fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
                    pvUci: reflected
                        ? row.before[0].pvUci.map(reflectMixedForkMove)
                        : row.before[0].pvUci,
                })),
            );
            for (const extra of JSON.parse(
                process.env.TACTICAL_BRANCH_MATE_EXTRA_CASES ?? "[]",
            ) as { id: string; line: "source" | "played" }[]) {
                const found = replay.results.find((candidate: any) => candidate.id === extra.id);
                assert(found, "Missing requested private continuation");
                const line =
                    extra.line === "source"
                        ? found.sourceUci
                        : [found.playedMoveUci, ...found.after[0].pvUci];
                rows.push({ id: `${extra.id}:${extra.line}`, fen: found.fen, pvUci: line });
            }
        }
        const reportCases = rows.map((row) => ({
            id: row.id,
            ...inspect(row.fen, row.pvUci),
        }));
        const probes = reportCases.flatMap((row) => [
            { id: `${row.id}:root`, fen: row.fen, searchMove: row.pvUci[0] },
            ...(row.proof?.strategy?.replies ?? []).map((branch) => ({
                id: `${row.id}:answer:${branch.move}`,
                fen: makeFen(
                    replayTacticalLine(row.fen, [row.pvUci[0], branch.move])[1].after.toSetup(),
                ),
                searchMove: branch.answer,
            })),
        ]);
        const report = {
            scope: "Constructed controls and optional private root/reflection; not independent game counts.",
            samplePath: "benchmarks/tactical-relevance/quiet-mate-development.json",
            cases: reportCases,
            probes,
        };
        if (process.env.TACTICAL_MATE_STRATEGY_PYTHON) {
            const result = spawnSync(
                process.env.TACTICAL_MATE_STRATEGY_PYTHON,
                ["scripts/benchmarks/verify-mating-strategy.py"],
                {
                    input: JSON.stringify(report),
                    encoding: "utf8",
                    windowsHide: true,
                },
            );
            assert.deepEqual(
                { status: result.status, error: result.stderr },
                {
                    status: 0,
                    error: "",
                },
            );
            console.log(result.stdout);
        }
        writeFileSync(
            privateReportPath(process.env.TACTICAL_BRANCH_MATE_REPORT!),
            JSON.stringify(report, null, 2),
            { flag: "wx" },
        );
    },
);
