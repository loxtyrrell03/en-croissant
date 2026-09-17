import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    compareImmediateTacticalDefence,
    replayTacticalLine,
    proveTacticalAttackerCaptureDefence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { classifyProvedMistakeNature } from "../tacticalMotifs/mistakeNature";
import {
    mixedForkCaptureDefenceFen,
    mixedForkCaptureDefenceMoves as moves,
    mixedForkCaptureDefenceControls,
} from "./fixtures/mixedForkCaptureDefence";

function compare(fen: string, reflected = false, best = moves.best) {
    const board = reflected ? reflectMixedForkFen(fen) : fen;
    const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
    const actual = replayTacticalLine(board, [move(moves.played), move(moves.reply)]);
    expect(actual).toHaveLength(2);
    const motifs = classifyPositionTacticalMotifs({
        fen: makeFen(actual[0].after.toSetup()),
        pvUci: [move(moves.reply)],
    }).motifs;
    expect(motifs.some((m) => m.id === "fork")).toBe(true);
    const compared = compareImmediateTacticalDefence(
        board,
        move(best),
        move(moves.played),
        move(moves.reply),
        motifs,
    );
    return { board, move, actual, compared };
}

test.each([false, true])(
    "a safe king capture explains a prevented mixed-target fork (%s)",
    (reflected) => {
        const result = compare(mixedForkCaptureDefenceFen, reflected);
        expect(result.compared.find((m) => m.id === "fork")).toMatchObject({
            comparison: "prevented",
        });
        expect(result.compared.find((m) => m.id === "fork")?.comparisonEvidence).toContain(
            "captures the forking queen",
        );
    },
);

test.each(mixedForkCaptureDefenceControls)(
    "a capture is not automatically a safe fork defence: $id",
    (row) => {
        for (const reflected of [false, true]) {
            const result = compare(row.fen, reflected);
            expect(result.compared.find((m) => m.id === "fork")?.comparison).not.toBe("prevented");
        }
    },
);

test.each([false, true])(
    "mistake review retains the cause and credits the played capture (%s)",
    (reflected) => {
        const { board, move } = compare(mixedForkCaptureDefenceFen, reflected);
        const sign = reflected ? -1 : 1;
        const input = {
            fen: board,
            playedMoveUci: move(moves.played),
            bestMoveUci: move(moves.best),
            pvUci: [move(moves.best)],
            refutationUci: [move(moves.reply), move("h1f1"), move("g2e4")],
            cpBefore: 300 * sign,
            cpAfter: -300 * sign,
            cpLoss: 600,
        };
        const classification = classifyMistakeReviewMotifs(input);
        expect(buildMistakeReviewTacticalExplanation(classification)?.primary).toMatchObject({
            id: "fork",
            source: "allowed",
            comparison: "prevented",
            value: 200,
        });
        expect(classifyProvedMistakeNature(input)).toMatchObject({
            nature: "tactical",
            allowedNature: "tactical",
        });
    },
);

test("the defensive witness includes entry material and does not bypass its budget", () => {
    const alternative = replayTacticalLine(mixedForkCaptureDefenceFen, [
        moves.best,
        moves.reply,
    ])[1];
    expect(proveTacticalAttackerCaptureDefence(alternative)).toMatchObject({
        defence: "Kxg2",
        defenceUci: moves.defence,
        gain: 800,
    });
    for (const budget of [0, 1, -1, 0.5, NaN, Infinity])
        expect(proveTacticalAttackerCaptureDefence(alternative, budget)).toBeNull();
    for (const row of mixedForkCaptureDefenceControls.slice(0, 3)) {
        const step = replayTacticalLine(row.fen, [moves.best, moves.reply])[1];
        expect(step).toBeDefined();
        expect(proveTacticalAttackerCaptureDefence(step)).toBeNull();
    }
});

test.each(["e1f1", "d7h3"])(
    "ordinary king/queen guards also prevent the mixed fork: %s",
    (best) => {
        for (const reflected of [false, true]) {
            const { board, move } = compare(mixedForkCaptureDefenceFen, reflected);
            const actual = replayTacticalLine(board, [move(moves.played), move(moves.reply)]);
            const motifs = classifyPositionTacticalMotifs({
                fen: makeFen(actual[0].after.toSetup()),
                pvUci: [move(moves.reply)],
            }).motifs;
            const compared = compareImmediateTacticalDefence(
                board,
                move(best),
                move(moves.played),
                move(moves.reply),
                motifs,
            );
            expect(compared.find((m) => m.id === "fork")).toMatchObject({
                comparison: "prevented",
            });
        }
    },
);

test.each([false, true])(
    "a safe alternative capture cannot erase the played move's queen credit (%s)",
    (reflected) => {
        const fen = mixedForkCaptureDefenceControls.find(
            (row) => row.id === "played-choice-already-won-a-queen",
        )!.fen;
        const { board, move, actual, compared } = compare(fen, reflected, "d7h3");
        const alternate = replayTacticalLine(board, [move("d7h3"), move(moves.reply)])[1];
        expect(actual[0].capture).toBe(900);
        expect(proveTacticalAttackerCaptureDefence(alternate)).toMatchObject({
            defenceUci: move("h3g2"),
            gain: 800,
        });
        expect(compared.find((m) => m.id === "fork")?.comparison).not.toBe("prevented");
    },
);

test.skipIf(!process.env.TACTICAL_MIXED_FORK_CAUSE_PUBLIC_PROBES)(
    "emit constructed mixed-fork cause and contrary engine decisions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const path = privateReportPath(process.env.TACTICAL_MIXED_FORK_CAUSE_PUBLIC_PROBES!);
        expect(existsSync(path)).toBe(false);
        const cases = [
            { id: "safe-capture", fen: mixedForkCaptureDefenceFen },
            ...mixedForkCaptureDefenceControls,
            {
                id: "played-choice-safe-queen-guard",
                fen: mixedForkCaptureDefenceControls.find(
                    (row) => row.id === "played-choice-already-won-a-queen",
                )!.fen,
                best: "d7h3",
                defence: "h3g2",
            },
        ].map((row) => ({ best: moves.best, defence: moves.defence, ...row }));
        const probes = cases.flatMap((row) =>
            [false, true].flatMap((reflected) => {
                const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
                const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
                const alternative = replayTacticalLine(fen, [move(row.best), move(moves.reply)]);
                const actual = replayTacticalLine(fen, [move(moves.played), move(moves.reply)]);
                expect(alternative).toHaveLength(2);
                expect(actual).toHaveLength(2);
                const after = makeFen(alternative[1].after.toSetup());
                const rows = [
                    { id: "best", fen },
                    { id: "played", fen, searchMove: move(moves.played) },
                    { id: "better-choice", fen, searchMove: move(row.best) },
                    {
                        id: "actual-fork",
                        fen: makeFen(actual[0].after.toSetup()),
                        searchMove: move(moves.reply),
                    },
                    { id: "alternative-best", fen: makeFen(alternative[0].after.toSetup()) },
                    {
                        id: "alternative-fork",
                        fen: makeFen(alternative[0].after.toSetup()),
                        searchMove: move(moves.reply),
                    },
                ];
                // A protected queen can already have mated. The held preceding
                // search records that outcome; there is no engine move to request
                // from the terminal board itself.
                if (!alternative[1].after.isEnd()) rows.push({ id: "capture-best", fen: after });
                if (replayTacticalLine(after, [move(row.defence)]).length)
                    rows.push({ id: "capture-held", fen: after, searchMove: move(row.defence) });
                return rows.map((probe) => ({
                    ...probe,
                    id: `${row.id}:${reflected}:${probe.id}`,
                }));
            }),
        );
        writeFileSync(
            path,
            JSON.stringify(
                { samplePath: "benchmarks/tactical-relevance/broader-game-context.json", probes },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(
    !process.env.TACTICAL_MIXED_FORK_CAUSE_OWNER || !process.env.TACTICAL_MIXED_FORK_CAUSE_REPORT,
)("audit the real mixed-fork cause and emit independent engine decisions", async () => {
    const { privateReportPath } =
        await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const path = privateReportPath(process.env.TACTICAL_MIXED_FORK_CAUSE_REPORT!);
    expect(existsSync(path)).toBe(false);
    const input = JSON.parse(readFileSync(process.env.TACTICAL_MIXED_FORK_CAUSE_OWNER!, "utf8"));
    const row = input.results.find((r: any) => r.id === "recall:174476976620:ply28");
    expect(row).toBeDefined();
    const actual = replayTacticalLine(row.fen, [row.playedMoveUci, row.after[0].pvUci[0]]);
    const alternative = replayTacticalLine(row.fen, [
        row.before[0].pvUci[0],
        row.after[0].pvUci[0],
    ]);
    const afterFen = makeFen(alternative[1].after.toSetup());
    const proof = proveTacticalAttackerCaptureDefence(alternative[1]);
    expect(proof).not.toBeNull();
    const motifs = classifyPositionTacticalMotifs({
        fen: makeFen(actual[0].after.toSetup()),
        pvUci: row.after[0].pvUci,
    }).motifs;
    const compared = compareImmediateTacticalDefence(
        row.fen,
        row.before[0].pvUci[0],
        row.playedMoveUci,
        row.after[0].pvUci[0],
        motifs,
    );
    const probes = [
        { id: "owner-best", fen: row.fen },
        { id: "owner-played", fen: row.fen, searchMove: row.playedMoveUci },
        { id: "owner-castle", fen: row.fen, searchMove: row.before[0].pvUci[0] },
        { id: "owner-after-played", fen: makeFen(actual[0].after.toSetup()) },
        {
            id: "owner-fork",
            fen: makeFen(actual[0].after.toSetup()),
            searchMove: row.after[0].pvUci[0],
        },
        { id: "owner-after-castle", fen: makeFen(alternative[0].after.toSetup()) },
        {
            id: "owner-counterfactual-fork",
            fen: makeFen(alternative[0].after.toSetup()),
            searchMove: row.after[0].pvUci[0],
        },
        { id: "owner-capture-best", fen: afterFen },
        { id: "owner-capture-held", fen: afterFen, searchMove: moves.defence },
        ...proof!.decisions.map((decision, index) => ({
            id: `owner-defence:${index}`,
            fen: decision.fen,
            searchMove: decision.moveUci,
        })),
    ];
    writeFileSync(
        path,
        JSON.stringify(
            { samplePath: process.env.TACTICAL_MIXED_FORK_CAUSE_OWNER, compared, proof, probes },
            null,
            2,
        ),
        { flag: "wx" },
    );
    expect(compared.find((m) => m.id === "fork")).toMatchObject({ comparison: "prevented" });
});
