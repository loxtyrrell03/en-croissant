import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeSan } from "chessops/san";
import { makeFen } from "chessops/fen";
import { replayTacticalLine, proveQuietMatingAttack } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const sample = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/quiet-game-context-development.json", "utf8"),
);
const engine = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/quiet-game-context-stockfish-18.json", "utf8"),
);
const cases = sample.cases.map((row: any) => {
    const best = engine.searches.find((entry: any) => entry.id === `${row.id}:best`);
    const played = engine.searches.find((entry: any) => entry.id === `${row.id}:played`);
    const reply = engine.searches.find((entry: any) => entry.id === `${row.id}:reply`);
    const sign = row.fen.split(" ")[1] === "w" ? 1 : -1;
    const cpBefore = best.lines[0].cp,
        cpAfter = played.lines[0].cp;
    const review = classifyMistakeReviewMotifs({
        fen: row.fen,
        bestMoveUci: best.lines[0].pvUci[0],
        playedMoveUci: row.sourceUci[0],
        pvUci: best.lines[0].pvUci,
        refutationUci: reply.lines[0].pvUci,
        cpBefore: cpBefore === null ? null : cpBefore * sign,
        cpAfter: cpAfter === null ? null : cpAfter * sign,
        cpLoss: cpBefore !== null && cpAfter !== null ? Math.max(0, cpBefore - cpAfter) : undefined,
    });
    const input = {
        fen: row.fen,
        previousFen: row.previousFen,
        previousMoveUci: row.previousMoveUci,
        pvUci: best.lines[0].pvUci,
        variations: best.lines,
        depth: 16,
        engineName: "Stockfish 18",
    };
    const responseInput = {
        fen: reply.fen,
        previousFen: row.fen,
        previousMoveUci: row.sourceUci[0],
        pvUci: reply.lines[0].pvUci,
        variations: reply.lines,
        depth: 16,
        engineName: "Stockfish 18",
    };
    return {
        ...row,
        best,
        played,
        reply,
        sourceResult: classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: row.sourceUci,
            previousFen: row.previousFen,
            previousMoveUci: row.previousMoveUci,
        }),
        input,
        responseInput,
        scan: buildLiveTacticalScan(input),
        responseScan: buildLiveTacticalScan(responseInput),
        review,
        explanation: buildMistakeReviewTacticalExplanation(review),
    };
});

test("audit every fixed mixed-colour game board and actual response, without filtering out small moves", () => {
    expect(sample.games).toHaveLength(4);
    expect(sample.cases).toHaveLength(21);
    expect(engine.searches).toHaveLength(63);
    for (const row of cases) {
        expect(row.best.fen).toBe(row.fen);
        expect(row.played.fen).toBe(row.fen);
        expect(row.played.searchMove).toBe(row.sourceUci[0]);
        const actual = replayTacticalLine(row.fen, [row.sourceUci[0]]);
        expect(actual).toHaveLength(1);
        expect(row.reply.fen).toBe(makeFen(actual[0].after.toSetup()));
        for (const input of [row.best, row.played, row.reply])
            for (const line of input.lines)
                expect(replayTacticalLine(input.fen, line.pvUci)).toHaveLength(line.pvUci.length);
        const preceding = replayTacticalLine(row.previousFen, [row.previousMoveUci]);
        expect(preceding).toHaveLength(1);
        expect(makeFen(preceding[0].after.toSetup())).toBe(row.fen);
    }
    for (const game of sample.games) {
        const history = replayTacticalLine(game.startFen, game.moves);
        expect(history).toHaveLength(game.moves.length);
        for (const row of cases.filter((row: any) => row.sourceGameUrl === game.sourceGameUrl)) {
            const ply = Number(row.id.split(":ply")[1]);
            expect(makeFen(history[ply - 1].after.toSetup())).toBe(row.fen);
            expect(history[ply].uci).toBe(row.sourceUci[0]);
        }
    }
    if (process.env.TACTICAL_QUIET_GAME_REPORT)
        writeFileSync(
            process.env.TACTICAL_QUIET_GAME_REPORT,
            JSON.stringify(
                {
                    scope: "Exact fixed game contexts, best/actual move and actual after-move scan. Diagnostic classification output, not 21 accurate judgements.",
                    cases,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
});

test.each([
    "context:TRKE6TxS:ply7",
    "context:TRKE6TxS:ply22",
    "context:TRKE6TxS:ply41",
    "context:Gectvn7R:ply7",
    "context:Gectvn7R:ply22",
    "context:Gectvn7R:ply100",
    "context:ZFgq8VzD:ply7",
    "context:ZFgq8VzD:ply22",
    "context:ZFgq8VzD:ply41",
    "context:C9q6jvtW:ply7",
    "context:C9q6jvtW:ply22",
    "context:C9q6jvtW:ply60",
    "context:C9q6jvtW:ply81",
    "context:C9q6jvtW:ply100",
])("routine exchanges, development and ending technique are not root tactics: %s", (id) => {
    const row = cases.find((row: any) => row.id === id)!;
    expect(row.sourceResult.motifs).toEqual([]);
    expect(row.scan.motifs).toEqual([]);
    expect(row.explanation).toBeNull();
});

test("the knight mating attack is genuine even though the whole position is near equal", () => {
    const row = cases.find((row: any) => row.id === "context:ZFgq8VzD:ply60")!;
    expect(row.responseInput.pvUci[0]).toBe("f4g6");
    expect(row.responseScan.motifs[0]).toMatchObject({ id: "forcingAttack", label: "Mating Attack", value: 100, ply: 1 });
    expect(row.explanation.primary).toMatchObject({ comparison: "persists", source: "allowed" });
    expect(row.explanation.title).toBe("Tactical danger in the position");
    expect(row.best.lines[0].pvUci[0]).toBe(row.sourceUci[0]);
    const root = replayTacticalLine(row.responseInput.fen, ["f4g6"])[0];
    const proof = proveQuietMatingAttack(root)!;
    expect(proof).toMatchObject({ threatSan: "Ng7#", gain: 100 });
    const replies = [...root.after.allDests()].flatMap(([from, destinations]) =>
        [...destinations].map(to => makeSan(root.after, { from, to })));
    expect(proof.branches.map(branch => branch.reply).sort()).toEqual(replies.sort());
    expect(proof.branches).toHaveLength(18);
    expect(proof.branches).toContainEqual(expect.objectContaining({ reply: "e5", gain: 100, line: ["Nxh4+"] }));
});

test("the actual recapture is not noise and its better capture is not sufficient causal evidence", () => {
    const row = cases.find((row: any) => row.id === "context:C9q6jvtW:ply41")!;
    expect(row.sourceResult.motifs).toEqual([]);
    expect(row.scan.motifs[0]).toMatchObject({ id: "hangingPiece", value: 330 });
    expect(row.review.missedMotifs[0]).toMatchObject({ alternativeCapture: true, value: 330 });
    expect(row.explanation.title).toBe("Capture in the better line");
});
