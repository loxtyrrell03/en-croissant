import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import {
    proveCheckingPawnRetention,
    replayTacticalLine,
    compareImmediateTacticalDefence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

import {
    checkingPawnRetentionFen as retainedFen,
    checkingPawnLiabilityFen as liabilityFen,
    checkingPawnRetentionCases,
} from "./fixtures/checkingPawnRetention";

test.each([false, true])(
    "checking pawn retention covers every evasion: reflected=%s",
    (reflected) => {
        const fen = reflected ? reflectMixedForkFen(retainedFen) : retainedFen;
        const move = reflected ? reflectMixedForkMove("c7c6") : "c7c6";
        const step = replayTacticalLine(fen, [move])[0];
        const nominated = reflected
            ? ["c7c6", "e8f8", "b1a3"].map(reflectMixedForkMove)
            : ["c7c6", "e8f8", "b1a3"];
        const proof = proveCheckingPawnRetention(replayTacticalLine(fen, nominated));
        expect(proof?.gain).toBe(100);
        expect(proof?.branches.length).toBe(
            [...step.after.allDests()].reduce((n, [, tos]) => n + tos.size(), 0),
        );
        for (const branch of proof!.branches) {
            expect(replayTacticalLine(fen, [move, branch.replyUci, branch.answerUci])).toHaveLength(
                3,
            );
            expect(branch.gain).toBeGreaterThan(100);
        }
        const line = [move, proof!.branches[0].replyUci, proof!.branches[0].answerUci];
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line, rootCp: 0 });
        expect(result.motifs[0]).toMatchObject({
            id: "hangingPiece",
            label: "Hanging Pawn",
            ply: 1,
            value: 100,
        });
        expect(result.motifs.some((m) => m.id === "intermezzo")).toBe(false);
        const scan = buildLiveTacticalScan({
            fen,
            pvUci: line,
            variations: [{ pvUci: line, cp: 0, depth: 16 }],
            depth: 16,
            engineName: "Constructed",
        });
        expect(scan.arrows.map((a) => a.ply)).toEqual([1]);
        expect(scan.variations[0].timeline.map((m) => m.ply)).toEqual([1]);
    },
);

test("short or non-capture continuations cannot borrow a longer certificate", () => {
    const input = { fen: retainedFen, pvUci: ["c7c6", "e8f8", "b1a3"] };
    expect(classifyPositionTacticalMotifs({ ...input, rootCp: 0 }).motifs[0]?.label).toBe(
        "Hanging Pawn",
    );
    expect(classifyPositionTacticalMotifs(input).motifs).toEqual([]);
    expect(classifyPositionTacticalMotifs({ ...input, rootCp: 0, pvUci: ["c7c6"] }).motifs).toEqual(
        [],
    );
    expect(
        classifyPositionTacticalMotifs({ ...input, rootCp: 0, pvUci: ["c7c6", "e8f8", "c6c7"] })
            .motifs,
    ).toEqual([]);
});

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "the owner's checking capture is recovered without blaming the preceding equal trade",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        const row = report.results.find(
            (r: any) => r.game === report.results[0].game && r.ply === 36,
        );
        const scan = buildLiveTacticalScan({
            ...row,
            ...row.before[0],
            variations: row.before,
            engineName: "Frozen Stockfish",
        });
        expect(scan.motifs[0]).toMatchObject({
            id: "hangingPiece",
            label: "Hanging Pawn",
            value: 100,
        });
        expect(scan.arrows.map((a) => a.ply)).toEqual([1]);
        const proof = proveCheckingPawnRetention(replayTacticalLine(row.fen, row.before[0].pvUci));
        expect(proof?.branches).toHaveLength(3);
        const previous = report.results.find((r: any) => r.game === row.game && r.ply === 35);
        const cause = compareImmediateTacticalDefence(
            previous.fen,
            previous.before[0].pvUci[0],
            previous.playedMoveUci,
            row.before[0].pvUci[0],
            scan.motifs,
        );
        expect(cause[0].comparison).toBeUndefined();
        expect(cause[0].comparisonEvidence).toContain("also gains material");
        const review = classifyMistakeReviewMotifs({
            ...row,
            bestMoveUci: row.before[0].pvUci[0],
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            cpBefore: row.before[0].cp,
            cpAfter: -row.after[0].cp,
            cpLoss: row.before[0].cp + row.after[0].cp,
        });
        expect(buildMistakeReviewTacticalExplanation(review)).toMatchObject({
            primary: { label: "Material Gain", source: "allowed", value: 230 },
            secondary: { label: "Hanging Pawn", source: "missed", value: 100 },
        });
    },
);

test.each([false, true])(
    "an exposed bishop prevents the retention certificate: reflected=%s",
    (reflected) => {
        const fen = reflected ? reflectMixedForkFen(liabilityFen) : liabilityFen;
        const move = reflected ? reflectMixedForkMove("c7c6") : "c7c6";
        const nominated = reflected
            ? ["c7c6", "e8f8", "b1a3"].map(reflectMixedForkMove)
            : ["c7c6", "e8f8", "b1a3"];
        expect(proveCheckingPawnRetention(replayTacticalLine(fen, nominated))).toBeNull();
        expect(classifyPositionTacticalMotifs({ fen, pvUci: [move] }).motifs).toEqual([]);
    },
);

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "checking capture budget %s cannot borrow cached success",
    (limit) => {
        const step = replayTacticalLine(retainedFen, ["c7c6", "e8f8", "b1a3"]);
        expect(proveCheckingPawnRetention(step)).not.toBeNull();
        expect(proveCheckingPawnRetention(step, limit)).toBeNull();
    },
);

test("a neutral queen liquidation cannot certify the real mating attack's pawn capture", () => {
    const fen = "6rk/2p4p/1pb2p1q/8/8/3PQ3/P1P2PPP/R3R1K1 b - - 1 23";
    expect(
        proveCheckingPawnRetention(replayTacticalLine(fen, ["g8g2", "g1f1", "h6e3"])),
    ).toBeNull();
    expect(
        proveCheckingPawnRetention(replayTacticalLine(fen, ["g8g2", "g1f1", "h6h2"])),
    ).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: ["g8g2", "g1f1", "g2g5"], rootCp: 330 })
            .motifs,
    ).toEqual([]);
});

test("a pawn captured by the played choice is credited before alleging an allowed pawn loss", () => {
    const before = "4k3/2Q5/2p5/8/8/bP6/2q5/1N4K1 b - - 0 1";
    const motifs = classifyPositionTacticalMotifs({
        fen: makeFen(replayTacticalLine(before, ["c2b3"])[0].after.toSetup()),
        pvUci: ["c7c6", "e8f8", "b1a3"],
        rootCp: 0,
    }).motifs;
    expect(motifs[0]?.label).toBe("Hanging Pawn");
    const compared = compareImmediateTacticalDefence(before, "c2c5", "c2b3", "c7c6", motifs);
    expect(compared[0].comparison).toBeUndefined();
    expect(compared[0].comparisonEvidence).toContain("also gains material");
});

test.skipIf(!process.env.TACTICAL_CHECKING_PAWN_RETENTION_REPORT)(
    "inspect every previously sampled checking pawn capture and every retained answer",
    () => {
        const sample = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/checking-pawn-development.json", "utf8"),
        );
        const engine = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/checking-pawn-stockfish-18.json", "utf8"),
        );
        const searches = engine.groups.flatMap((group: any) => group.searches);
        const candidates = [
            ...sample.cases,
            ...checkingPawnRetentionCases.map((row) => ({ ...row, searchMove: row.pvUci[0] })),
        ];
        const cases = candidates.map((row: any) => {
            const move = row.searchMove;
            const step = replayTacticalLine(row.fen, [move])[0];
            expect({ id: row.id, legal: Boolean(step) }).toEqual({ id: row.id, legal: true });
            const line = row.pvUci
                ? { pvUci: row.pvUci, cp: 0 }
                : searches.find((search: any) => search.id === row.id).lines[0];
            const proof = proveCheckingPawnRetention(replayTacticalLine(row.fen, line.pvUci));
            return {
                ...row,
                moveUci: move,
                proof,
                result: classifyPositionTacticalMotifs({
                    fen: row.fen,
                    pvUci: line.pvUci,
                    rootCp: line.cp,
                }),
                replies: [...step.after.allDests()].flatMap(([from, tos]) =>
                    [...tos].map((to) => makeUci({ from, to })),
                ),
                afterFen: makeFen(step.after.toSetup()),
            };
        });
        writeFileSync(
            process.env.TACTICAL_CHECKING_PAWN_RETENTION_REPORT!,
            JSON.stringify({ cases }, null, 2),
            { flag: "wx" },
        );
    },
    30000,
);
