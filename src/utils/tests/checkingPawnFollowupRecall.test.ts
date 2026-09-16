import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import {
    proveCheckingPawnRetention,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    checkingPawnFollowupCases,
    checkingPawnFollowupLine,
} from "./fixtures/checkingPawnFollowup";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";

function reflectFen(fen: string) {
    const fields = reflectMixedForkFen(fen).split(" ");
    fields[2] = fields[2].replace(/[a-zA-Z]/g, (c) =>
        c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
    );
    if (fields[3] !== "-")
        fields[3] = reflectMixedForkMove(`a1${fields[3]}`).slice(2, 4);
    return fields.join(" ");
}

test.skipIf(!process.env.TACTICAL_PAWN_LIQUIDATION_AUDIT)(
    "inspect the contrary king-attack liquidation without presuming a material bound proves sound play",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const fen = "6rk/2p4p/1pb2p1q/8/8/3PQ3/P1P2PPP/R3R1K1 b - - 1 23";
        const probes = [
            { id: "attack:root", fen, searchMove: "g8g2" },
            { id: "attack:root-choice", fen },
            ...["g1f1", "g1h1"].flatMap((reply) => {
                const after = makeFen(
                    replayTacticalLine(fen, ["g8g2", reply])[1].after.toSetup(),
                );
                return [
                    {
                        id: `attack:${reply}:pawn`,
                        fen: after,
                        searchMove: "h6h2",
                    },
                    { id: `attack:${reply}:choice`, fen: after },
                    ...(!replayTacticalLine(after, ["h6h2"])[0].after.isEnd()
                        ? [
                              {
                                  id: `attack:${reply}:defence`,
                                  fen: makeFen(
                                      replayTacticalLine(after, [
                                          "h6h2",
                                      ])[0].after.toSetup(),
                                  ),
                              },
                          ]
                        : []),
                ];
            }),
        ];
        expect(probes).toHaveLength(7);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_PAWN_LIQUIDATION_AUDIT!),
            JSON.stringify(
                {
                    samplePath:
                        "benchmarks/tactical-relevance/rare-theme-development.json",
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.each([false, true])(
    "a connected pawn followup retains the checking gain: reflected=%s",
    (reflected) => {
        for (const row of checkingPawnFollowupCases) {
            const fen = reflected ? reflectFen(row.fen) : row.fen;
            const pvUci = reflected
                ? checkingPawnFollowupLine.map(reflectMixedForkMove)
                : checkingPawnFollowupLine;
            const steps = replayTacticalLine(fen, pvUci);
            expect(steps).toHaveLength(3);
            const trace: string[] = [];
            const proof = proveCheckingPawnRetention(steps, 8192, (reason) =>
                trace.push(reason),
            );
            assert.equal(
                !!proof,
                row.positive,
                `${row.id}: ${trace.join("; ")}`,
            );
            expect(proveCheckingPawnRetention(steps)).toEqual(proof);
            if (proof) {
                assert.equal(proof.gain, 100);
                assert(proof.visits <= 8192);
                // These fixtures have no promoting defences. Check actual legal
                // coverage and replay, not just an expected branch count.
                const replies = [...steps[0].after.allDests()].flatMap(
                    ([from, dests]) =>
                        [...dests].map((to) => makeUci({ from, to })),
                );
                assert.deepEqual(
                    proof.branches.map((branch) => branch.replyUci).sort(),
                    replies.sort(),
                );
                for (const branch of proof.branches) {
                    assert.equal(
                        replayTacticalLine(fen, [
                            pvUci[0],
                            branch.replyUci,
                            branch.answerUci,
                        ]).length,
                        3,
                    );
                    assert.equal(branch.gain, 200);
                }
                assert.equal(proof.defensiveDecisions?.length, 12);
            }
            const scan = buildLiveTacticalScan({
                fen,
                pvUci,
                depth: 16,
                engineName: "Constructed",
                variations: [{ pvUci, cp: 0, depth: 16 }],
            });
            expect(scan.motifs[0]?.label ?? null).toBe(
                row.positive ? "Hanging Pawn" : null,
            );
            expect(scan.arrows.map((arrow) => arrow.ply)).toEqual(
                row.positive ? [1] : [],
            );
            expect(
                scan.variations[0].timeline.map((motif) => motif.ply),
            ).toEqual(row.positive ? [1] : []);
        }
    },
);

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "pawn follow-up budget %s cannot borrow a cached proof",
    (limit) => {
        const steps = replayTacticalLine(
            checkingPawnFollowupCases[0].fen,
            checkingPawnFollowupLine,
        );
        expect(proveCheckingPawnRetention(steps)).not.toBeNull();
        expect(proveCheckingPawnRetention(steps, limit)).toBeNull();
    },
);

test("a missing or quiet follow-up does not borrow the pawn-capture certificate", () => {
    const fen = checkingPawnFollowupCases[0].fen;
    for (const pv of [
        checkingPawnFollowupLine.slice(0, 1),
        checkingPawnFollowupLine.slice(0, 2),
        ["c7c6", "e8f8", "c6c7"],
    ]) {
        expect(
            proveCheckingPawnRetention(replayTacticalLine(fen, pv)),
        ).toBeNull();
    }
});

test.each([false, true])(
    "a newly enabled pawn grab cannot replace the real quiet king attack: reflected=%s",
    (reflected) => {
        const original = "6rk/2p4p/1pb2p1q/8/8/3PQ3/P1P2PPP/R3R1K1 b - - 1 23";
        const fen = reflected ? reflectFen(original) : original;
        const pvUci = reflected
            ? ["g8g2", "g1f1", "h6h2"].map(reflectMixedForkMove)
            : ["g8g2", "g1f1", "h6h2"];
        const steps = replayTacticalLine(fen, pvUci);
        expect(steps).toHaveLength(3);
        const trace: string[] = [];
        expect(
            proveCheckingPawnRetention(steps, 8192, (reason) =>
                trace.push(reason),
            ),
        ).toBeNull();
        expect(
            trace.some((reason) => reason.startsWith("Prior follow-up gain -")),
        ).toBe(true);
        const scan = buildLiveTacticalScan({
            fen,
            pvUci,
            variations: [{ pvUci, cp: 330, depth: 16 }],
            depth: 16,
            engineName: "Contrary source nomination",
        });
        expect(
            scan.motifs.some(
                (motif) => motif.ply === 1 && motif.label === "Hanging Pawn",
            ),
        ).toBe(false);
    },
);

test("fresh engine decisions support the retained captures without declaring all withheld positions losing", () => {
    const receipt = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/pawn-followup-stockfish-18.json",
            "utf8",
        ),
    );
    expect(receipt.searches).toHaveLength(50);
    for (const row of receipt.searches) {
        expect(row.lines[0].depth).toBe(16);
        expect(row.lines[0].pvUci[0]).toBe(row.searchMove);
        if (row.id.startsWith("supported-pawn-followup:"))
            assert(row.lines[0].cp > 0 || row.lines[0].mate > 0);
        if (row.id.includes("held-followup")) {
            if (
                row.id.startsWith("mating-counterplay:") ||
                row.id.startsWith("unsupported-knight:")
            )
                assert.equal(row.lines[0].mate, -1);
            if (row.id.startsWith("capturable-checker:"))
                assert(row.lines[0].cp < 0);
            // Losing the bishop refutes the local material certificate even
            // though the constructed position remains winning overall.
            if (row.id.startsWith("off-square-bishop-loss:"))
                assert(row.lines[0].cp > 0);
        }
    }
});

test.skipIf(!process.env.TACTICAL_PAWN_FOLLOWUP_OWNER_REPLAY)(
    "the owner's alternative has a root lesson without borrowing its later trap or blaming an equivalent capture",
    () => {
        const report = JSON.parse(
            readFileSync(
                process.env.TACTICAL_PAWN_FOLLOWUP_OWNER_REPLAY!,
                "utf8",
            ),
        );
        const row = report.results.find(
            (item: any) =>
                item.game === report.results[0].game && item.ply === 28,
        );
        expect(row.before[1].pvUci[0]).toBe("f3e5");
        const scan = buildLiveTacticalScan({
            ...row,
            ...row.before[0],
            variations: row.before,
            engineName: "Frozen Stockfish",
        });
        expect(scan.motifs).toEqual([]); // Bc4+'s quiet preparation is still unproved.
        expect(scan.variations[1].motifs[0]).toMatchObject({
            label: "Hanging Pawn",
            value: 100,
            ply: 1,
            moveUci: "f3e5",
        });
        expect(scan.variations[1].motifs[1]).toMatchObject({
            id: "trappedPiece",
            ply: 9,
            relevance: "secondary",
        });
        expect(
            scan.variations[1].arrows.map((arrow) => arrow.from + arrow.to),
        ).toEqual(["f3e5"]);
        expect(scan.variations[2].motifs[0]).toMatchObject({
            label: "Hanging Pawn",
            moveUci: "d8c7",
        });
        const input = {
            ...row,
            bestMoveUci: row.before[0].pvUci[0],
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            cpBefore: row.before[0].cp,
            cpAfter: -row.after[0].cp,
            cpLoss: Math.max(0, row.before[0].cp + row.after[0].cp),
            bestCandidates: row.before.map((line: any) => ({
                ...line,
                fen: row.fen,
            })),
            refutationCandidates: row.after.map((line: any) => ({
                ...line,
                fen: row.afterFen,
            })),
        };
        const review = classifyMistakeReviewMotifs(input);
        expect(review.missedMotifs).toEqual([]);
        expect(buildMistakeReviewTacticalExplanation(review)).toBeNull();
        // Even nominating Nxe5+ as the best move must credit the played Nxc7 pawn.
        const alternative = classifyMistakeReviewMotifs({
            ...input,
            bestMoveUci: "f3e5",
            pvUci: row.before[1].pvUci,
            cpBefore: row.before[1].cp,
            cpLoss: Math.max(0, row.before[1].cp + row.after[0].cp),
        });
        expect(alternative.missedMotifs[0]).toMatchObject({
            alternativeCapture: true,
            value: 100,
        });
        expect(
            buildMistakeReviewTacticalExplanation(alternative),
        ).toMatchObject({ title: "Capture in the better line" });
        expect(
            buildMistakeReviewTacticalExplanation(alternative)?.text,
        ).toContain("comparable");
        for (const reflected of [false, true]) {
            const proof = proveCheckingPawnRetention(
                replayTacticalLine(
                    reflected ? reflectFen(row.fen) : row.fen,
                    reflected
                        ? row.before[1].pvUci.map(reflectMixedForkMove)
                        : row.before[1].pvUci,
                ),
            );
            expect(proof?.gain).toBe(100);
            expect(proof?.branches).toHaveLength(2);
        }
    },
);

test.skipIf(!process.env.TACTICAL_PAWN_FOLLOWUP_AUDIT)(
    "inspect owner and public pawn-followup nominations and proof branches",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const rows = checkingPawnFollowupCases.map((row) => ({
            ...row,
            pvUci: checkingPawnFollowupLine,
        }));
        if (process.env.TACTICAL_RECALL_REPLAY) {
            const report = JSON.parse(
                readFileSync(process.env.TACTICAL_RECALL_REPLAY, "utf8"),
            );
            const row = report.results.find(
                (item: any) =>
                    item.game === report.results[0].game && item.ply === 28,
            );
            rows.push({
                id: "owner-knight-check",
                fen: row.fen,
                positive: true,
                pvUci: row.before[1].pvUci,
            });
        }
        const cases = rows.flatMap((row) =>
            [false, true].map((reflected) => {
                const fen = reflected ? reflectFen(row.fen) : row.fen;
                const pvUci = reflected
                    ? row.pvUci.map(reflectMixedForkMove)
                    : row.pvUci;
                const steps = replayTacticalLine(fen, pvUci);
                expect(steps).toHaveLength(pvUci.length);
                const trace: string[] = [];
                const proof = proveCheckingPawnRetention(
                    steps,
                    8192,
                    (reason) => trace.push(reason),
                );
                return {
                    ...row,
                    id: `${row.id}:${reflected}`,
                    fen,
                    pvUci,
                    proof,
                    trace,
                };
            }),
        );
        const probes = cases.flatMap((row) => [
            { id: `${row.id}:root`, fen: row.fen, searchMove: row.pvUci[0] },
            ...(row.proof?.branches.map((branch, index) => ({
                id: `${row.id}:branch:${index}`,
                fen: makeFen(
                    replayTacticalLine(row.fen, [
                        row.pvUci[0],
                        branch.replyUci,
                    ])[1].after.toSetup(),
                ),
                searchMove: branch.answerUci,
            })) ?? []),
            ...(row.proof?.defensiveDecisions?.map((decision, index) => ({
                id: `${row.id}:safety:${index}`,
                fen: decision.fen,
                searchMove: decision.moveUci,
            })) ?? []),
            ...(!row.positive
                ? [
                      {
                          id: `${row.id}:held-followup`,
                          fen: makeFen(
                              replayTacticalLine(
                                  row.fen,
                                  row.pvUci.slice(0, 2),
                              )[1].after.toSetup(),
                          ),
                          searchMove: row.pvUci[2],
                      },
                  ]
                : []),
        ]);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_PAWN_FOLLOWUP_AUDIT!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_RECALL_REPLAY,
                    cases,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(!process.env.TACTICAL_PAWN_FOLLOWUP_EXPORT)(
    "export only constructed public engine decisions, never owner data",
    () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_PAWN_FOLLOWUP_EXPORT!, "utf8"),
        );
        const ids = new Set(
            checkingPawnFollowupCases.flatMap((row) =>
                [false, true].map((reflected) => `${row.id}:${reflected}:`),
            ),
        );
        const searches = report.searches
            .filter((row: any) => [...ids].some((id) => row.id.startsWith(id)))
            .map(({ id, fen, searchMove, lines }: any) => ({
                id,
                fen,
                searchMove,
                lines,
            }));
        expect(searches.length).toBe(50);
        writeFileSync(
            "benchmarks/tactical-relevance/pawn-followup-stockfish-18.json",
            JSON.stringify(
                {
                    scope: "Constructed controls and all selected retention answers, including countercheck replies. Depth-16 Stockfish 18 whole-position evaluations are not local material bounds or an accuracy score. Both colours are constructed variants, not separate real games.",
                    searches,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
