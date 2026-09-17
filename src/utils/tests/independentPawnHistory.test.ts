import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { persistentPawnExchangeContext } from "../tacticalMotifs/gameHistory";
import {
    provePersistentPawnCapture,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { independentPawnHistoryInput } from "./fixtures/independentPawnHistory";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkMove } from "./fixtures/mixedTargetFork";

test("fresh engine continuations preserve the local pawn distinction without claiming a winning position", () => {
    const report = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/independent-pawn-stockfish-18.json", "utf8"),
    );
    expect(report.searches).toHaveLength(8);
    for (const reflected of [false, true])
        for (const reciprocal of [false, true]) {
            const input = independentPawnHistoryInput(reflected, reciprocal);
            const entry = report.searches.find(
                (row: any) => row.id === `constructed:${reflected}:${reciprocal}:held`,
            );
            expect(entry.fen).toBe(input.fen);
            expect(entry.searchMove).toBe(input.pvUci[0]);
            const line = entry.lines[0];
            expect(line.depth).toBe(16);
            expect(Math.sign(line.cp)).toBe(reciprocal ? 1 : -1);
            expect(replayTacticalLine(input.fen, line.pvUci)).toHaveLength(line.pvUci.length);
            const scan = buildLiveTacticalScan({
                ...input,
                pvUci: line.pvUci,
                variations: [line],
                depth: 16,
                engineName: "Stockfish 18",
            });
            expect(
                scan.motifs
                    .filter((m) => m.id === "hangingPiece")
                    .map(({ label, value }) => ({ label, value })),
            ).toEqual(reciprocal ? [] : [{ label: "Hanging Pawn", value: 100 }]);
        }
});

test.each([false, true])(
    "an untouched pawn does not inherit an unrelated lost queen: reflected=%s",
    (reflected) => {
        const input = independentPawnHistoryInput(reflected);
        const root = replayTacticalLine(input.fen, input.pvUci)[0];
        expect(tacticalCaptureGain(root)).toBe(100);
        expect(
            persistentPawnExchangeContext(input.tacticalHistory, input.fen, root.move)?.balance,
        ).toBe(0);
        expect(provePersistentPawnCapture(root, input.tacticalHistory)?.gain).toBe(100);
        const scan = buildLiveTacticalScan({
            ...input,
            variations: [{ pvUci: input.pvUci, cp: -700 }],
            depth: 16,
            engineName: "Constructed, synthetic selection score",
        });
        expect(scan.motifs[0]).toMatchObject({ label: "Hanging Pawn", value: 100, ply: 1 });
    },
);

test.each([false, true])(
    "an available pawn is not a missed pawn if it remains after the reply: reflected=%s",
    (reflected) => {
        const input = independentPawnHistoryInput(reflected);
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const result = classifyMistakeReviewMotifs({
            ...input,
            bestMoveUci: input.pvUci[0],
            playedMoveUci: move("h2h3"),
            refutationUci: [move("h7h6")],
            cpBefore: reflected ? 700 : -700,
            cpAfter: reflected ? 800 : -800,
            cpLoss: 100,
        });
        expect(result.missedMotifs).toEqual([]);
    },
);

test.each([false, true])(
    "the complete history and present capture safety are still required: reflected=%s",
    (reflected) => {
        const input = independentPawnHistoryInput(reflected);
        const root = replayTacticalLine(input.fen, input.pvUci)[0];
        const frames = replayTacticalLine(input.tacticalHistory.fen, input.tacticalHistory.moves);
        for (const history of [
            undefined,
            {
                fen: makeFen(frames[9].after.toSetup()),
                moves: input.tacticalHistory.moves.slice(10),
            },
        ]) {
            expect(provePersistentPawnCapture(root, history)).toBeNull();
            expect(
                classifyPositionTacticalMotifs({ ...input, tacticalHistory: history, rootCp: -700 })
                    .motifs,
            ).toEqual([]);
        }
        // ...d6 defends e5. History cannot certify a losing Nxe5.
        const repair = reflected ? reflectMixedForkMove("d7d6") : "d7d6";
        const prefix = input.tacticalHistory.moves.slice(0, -1);
        const beforeRepair = makeFen(
            replayTacticalLine(input.tacticalHistory.fen, prefix).at(-1)!.after.toSetup(),
        );
        const repaired = replayTacticalLine(beforeRepair, [repair, ...input.pvUci]);
        expect(repaired).toHaveLength(2);
        expect(tacticalCaptureGain(repaired[1])).toBeLessThan(90);
        expect(
            provePersistentPawnCapture(repaired[1], {
                fen: input.tacticalHistory.fen,
                moves: [...prefix, repair],
            }),
        ).toBeNull();
    },
);

test.skipIf(!process.env.TACTICAL_INDEPENDENT_PAWN_PROBES)(
    "export constructed independent and reciprocal pawn decisions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const probes = [false, true].flatMap((reflected) =>
            [false, true].flatMap((reciprocal) => {
                const input = independentPawnHistoryInput(reflected, reciprocal);
                const id = `constructed:${reflected}:${reciprocal}`;
                return [
                    { id: `${id}:best`, fen: input.fen },
                    { id: `${id}:held`, fen: input.fen, searchMove: input.pvUci[0] },
                ];
            }),
        );
        expect(probes).toHaveLength(8);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_INDEPENDENT_PAWN_PROBES!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_INDEPENDENT_PAWN_OWNER,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(!process.env.TACTICAL_INDEPENDENT_PAWN_OWNER)(
    "the owner Nxc7 is an available opportunity, not a missed or newly allowed tactic",
    () => {
        const source = JSON.parse(
            readFileSync(process.env.TACTICAL_INDEPENDENT_PAWN_OWNER!, "utf8"),
        );
        const row = source.results.find((row: any) => row.id === "recall:172462921812:ply42");
        expect(row.scan.motifs[0]).toMatchObject({
            label: "Hanging Pawn",
            value: 100,
            moveUci: "d5c7",
        });
        expect(row.classification.missedMotifs).toEqual([]);
        const preceding = source.results.find((row: any) => row.id === "recall:172462921812:ply41");
        expect(preceding.classification.allowedMotifs[0]).toMatchObject({
            label: "Hanging Pawn",
            moveUci: "d5c7",
            comparison: "persists",
        });
        const settled = source.results.find((row: any) => row.id === "recall:174477406194:ply47");
        expect(settled.scan.motifs[0]).toMatchObject({ label: "Hanging Pawn", moveUci: "g4f2" });
    },
);

test.each([false, true])(
    "winning a queen cannot finance a reciprocal pawn headline: reflected=%s",
    (reflected) => {
        const input = independentPawnHistoryInput(reflected, true);
        const root = replayTacticalLine(input.fen, input.pvUci)[0];
        expect(tacticalCaptureGain(root)).toBe(100);
        expect(
            persistentPawnExchangeContext(input.tacticalHistory, input.fen, root.move)?.balance,
        ).toBe(-100);
        expect(provePersistentPawnCapture(root, input.tacticalHistory)).toBeNull();
        const scan = buildLiveTacticalScan({
            ...input,
            variations: [{ pvUci: input.pvUci, cp: 700 }],
            depth: 16,
            engineName: "Constructed, synthetic selection score",
        });
        expect(scan.motifs).toEqual([]);
    },
);

test.each([false, true])(
    "a bishop-for-pawn exchange cannot pay a separate pawn debt: priorPawnLoss=%s",
    (priorPawnLoss) => {
        const moves =
            `e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 ${priorPawnLoss ? "f3e5" : "a2a3"} a7a6 b5a6 b7a6 h2h3`.split(
                " ",
            );
        const history = replayTacticalLine(INITIAL_FEN, moves);
        expect(history).toHaveLength(moves.length);
        const fen = makeFen(history.at(-1)!.after.toSetup());
        const root = replayTacticalLine(fen, ["f6e4"])[0];
        expect(
            persistentPawnExchangeContext({ fen: INITIAL_FEN, moves }, fen, root.move)?.balance,
        ).toBe(priorPawnLoss ? -100 : 0);
        expect(tacticalCaptureGain(root)).toBe(100);
        const proof = provePersistentPawnCapture(root, { fen: INITIAL_FEN, moves });
        expect(proof?.gain ?? null).toBe(priorPawnLoss ? null : 100);
    },
);

test.skipIf(!process.env.TACTICAL_INDEPENDENT_PAWN_CHANGED_PROBES)(
    "export all changed owner decisions for fresh engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_INDEPENDENT_PAWN_OWNER!, "utf8"),
        );
        const ids = new Set(report.changed.map((row: any) => row.id));
        const probes = report.results
            .filter((row: any) => ids.has(row.id))
            .flatMap((row: any) => [
                { id: `${row.id}:best`, fen: row.fen },
                ...row.before.map((line: any) => ({
                    id: `${row.id}:held-${line.pvUci[0]}`,
                    fen: row.fen,
                    searchMove: line.pvUci[0],
                })),
                { id: `${row.id}:played`, fen: row.fen, searchMove: row.playedMoveUci },
            ]);
        expect(probes.length).toBeGreaterThan(0);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_INDEPENDENT_PAWN_CHANGED_PROBES!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_INDEPENDENT_PAWN_OWNER,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
