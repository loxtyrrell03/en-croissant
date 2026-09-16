import { expect, test } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
    compareImmediateTacticalDefence,
    replayTacticalLine,
    proveCheckingForkCaptureDefence,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    checkingForkCaptureFen,
    checkingForkCaptureMoves,
    checkingForkCaptureControls,
} from "./fixtures/checkingForkCaptureDefence";

test.each([false, true])(
    "a legal safe capture explains how the better move stops a checking fork (%s)",
    (reflected) => {
        const fen = reflected
            ? reflectMixedForkFen(checkingForkCaptureFen)
            : checkingForkCaptureFen;
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const { played, best, reply } = checkingForkCaptureMoves;
        const actual = replayTacticalLine(fen, [move(played), move(reply)]);
        expect(actual).toHaveLength(2);
        const motifs = classifyPositionTacticalMotifs({
            fen: makeFen(actual[0].after.toSetup()),
            pvUci: [move(reply)],
        }).motifs;
        expect(motifs.some((m) => m.id === "fork")).toBe(true);
        const compared = compareImmediateTacticalDefence(
            fen,
            move(best),
            move(played),
            move(reply),
            motifs,
        );
        expect(compared.find((m) => m.id === "fork")).toMatchObject({ comparison: "prevented" });
        expect(compared.find((m) => m.id === "fork")?.comparisonEvidence).toMatch(
            /captures the forking knight/,
        );
    },
);

test.each(checkingForkCaptureControls)("a geometric capture is not a defence: $name", ({ fen }) => {
    for (const reflected of [false, true]) {
        const board = reflected ? reflectMixedForkFen(fen) : fen;
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const { played, best, reply } = checkingForkCaptureMoves;
        const actual = replayTacticalLine(board, [move(played), move(reply)]);
        expect(actual).toHaveLength(2);
        const motifs = classifyPositionTacticalMotifs({
            fen: makeFen(actual[0].after.toSetup()),
            pvUci: [move(reply)],
        }).motifs;
        expect(motifs.some((m) => m.id === "fork")).toBe(true);
        const alternative = replayTacticalLine(board, [move(best), move(reply)])[1];
        expect(proveCheckingForkCaptureDefence(alternative)).toBeNull();
        const result = compareImmediateTacticalDefence(
            board,
            move(best),
            move(played),
            move(reply),
            motifs,
        );
        expect(result.find((m) => m.id === "fork")?.comparison).not.toBe("prevented");
    }
});

test("bounded defensive witness debits the initially captured pawn and fails on exhausted budgets", () => {
    const { best, reply } = checkingForkCaptureMoves;
    const root = replayTacticalLine(checkingForkCaptureFen, [best, reply])[1];
    expect(proveCheckingForkCaptureDefence(root)).toMatchObject({
        defence: "Qxc7",
        defenceUci: "d6c7",
        gain: 220,
    });
    for (const budget of [0, -1, 1, 1.5, Infinity, NaN])
        expect(proveCheckingForkCaptureDefence(root, budget)).toBeNull();
    expect(
        proveCheckingForkCaptureDefence(replayTacticalLine(checkingForkCaptureFen, [best])[0]),
    ).toBeNull();
});

test("material taken by the player's choice cannot be blamed as a new net fork loss", () => {
    const fen = checkingForkCaptureFen.replace("3N4", "2QN4");
    const { played, best, reply } = checkingForkCaptureMoves;
    const actual = replayTacticalLine(fen, [played, reply]);
    expect(actual).toHaveLength(2);
    expect(actual[0].capture).toBe(900);
    const motifs = classifyPositionTacticalMotifs({
        fen: makeFen(actual[0].after.toSetup()),
        pvUci: [reply],
    }).motifs;
    expect(motifs.some((m) => m.id === "fork")).toBe(true);
    const result = compareImmediateTacticalDefence(fen, best, played, reply, motifs);
    expect(result.find((m) => m.id === "fork")?.comparison).not.toBe("prevented");
});

test.skipIf(!process.env.TACTICAL_FORK_GUARD_OWNER)(
    "the owner mistake gains its missing fork cause without changing the tactic",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_FORK_GUARD_OWNER!, "utf8"));
        const row = report.results.find((r: any) => r.id === "recall:172294705390:ply17");
        expect(row).toBeDefined();
        const result = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: row.playedMoveUci,
            bestMoveUci: row.before[0].pvUci[0],
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            previousFen: row.previousFen,
            previousMoveUci: row.previousMoveUci,
            tacticalHistory: row.tacticalHistory,
            cpBefore: -row.before[0].cp,
            cpAfter: row.after[0].cp,
            cpLoss: row.before[0].cp + row.after[0].cp,
        });
        const explanation = buildMistakeReviewTacticalExplanation(result)!;
        expect(explanation.primary).toMatchObject({
            id: "fork",
            source: "allowed",
            comparison: "prevented",
        });
        expect(explanation.text).toContain("Qxc7");
        expect(explanation.title).toBe("Why the move was tactically bad");
    },
);

test.skipIf(!process.env.TACTICAL_FORK_GUARD_OWNER || !process.env.TACTICAL_FORK_GUARD_PROBES)(
    "export real and contrary defensive witnesses for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_FORK_GUARD_PROBES!);
        expect(existsSync(output)).toBe(false);
        const report = JSON.parse(readFileSync(process.env.TACTICAL_FORK_GUARD_OWNER!, "utf8"));
        const row = report.results.find((r: any) => r.id === "recall:172294705390:ply17");
        const cases = [
            { id: "owner-queen-guard", fen: row.fen },
            { id: "constructed-queen-guard", fen: checkingForkCaptureFen },
            ...checkingForkCaptureControls.map((c, i) => ({ id: `contrary-${i}`, fen: c.fen })),
        ];
        const probes: any[] = [],
            witnesses: any[] = [];
        const { best, played, reply } = checkingForkCaptureMoves;
        for (const c of cases) {
            probes.push(
                { id: `${c.id}:best`, fen: c.fen },
                { id: `${c.id}:played`, fen: c.fen, searchMove: played },
                { id: `${c.id}:guard`, fen: c.fen, searchMove: best },
            );
            for (const first of [played, best]) {
                const pair = replayTacticalLine(c.fen, [first, reply]);
                expect(pair).toHaveLength(2);
                probes.push({
                    id: `${c.id}:${first}:fork`,
                    fen: makeFen(pair[0].after.toSetup()),
                    searchMove: reply,
                });
                const proof = proveCheckingForkCaptureDefence(pair[1]);
                witnesses.push({ id: c.id, first, proof });
                if (first === best) {
                    const response = replayTacticalLine(makeFen(pair[1].after.toSetup()), ["d6c7"]);
                    if (response.length !== 1) throw new Error("Illegal defensive capture in probe");
                    probes.push({
                        id: `${c.id}:take-forker`,
                        fen: makeFen(pair[1].after.toSetup()),
                        searchMove: "d6c7",
                    });
                }
                if (c.id === "owner-queen-guard" && first === played)
                    for (const [from, dests] of pair[1].after.allDests())
                        for (const to of dests) {
                            const pos = pair[1].after.clone();
                            pos.play({ from, to });
                            probes.push({
                                id: `${c.id}:actual-defence-${makeUci({ from, to })}`,
                                fen: makeFen(pos.toSetup()),
                            });
                        }
                for (const [i, decision] of (proof?.decisions ?? []).entries())
                    probes.push({
                        id: `${c.id}:${first}:safety-${i}`,
                        fen: decision.fen,
                        searchMove: decision.moveUci,
                    });
            }
        }
        writeFileSync(
            output,
            JSON.stringify(
                { samplePath: process.env.TACTICAL_FORK_GUARD_OWNER, probes, witnesses },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
