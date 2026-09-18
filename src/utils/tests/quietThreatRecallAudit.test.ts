import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import { observeDefensibleMateThreat, proveQuietMatingAttack, replayTacticalLine, tacticalCaptureGain } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

test.skipIf(!process.env.TACTICAL_QUIET_THREAT_INPUT || !process.env.TACTICAL_QUIET_THREAT_REPORT)(
    "inspect selected quiet mating threats and every legal defensive reply",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_QUIET_THREAT_REPORT!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_QUIET_THREAT_INPUT!, "utf8"));
        const probes: { id: string; fen: string; searchMove?: string; depth: number }[] = [];
        const cases = input.cases.map((row: { id: string; fen: string; move: string; rootCp?: number; line?: string[] }) => {
            const root = replayTacticalLine(row.fen, [row.move])[0];
            expect(root).toBeDefined();
            const attempts = [8192, 32768].map(budget => {
                const failures: string[] = [];
                const proof = proveQuietMatingAttack(root, budget, reason => failures.push(reason));
                return { budget, proof, failures };
            });
            const replies = [...root.after.allDests()].flatMap(([from, dests]) => [...dests].flatMap(to =>
                (root.after.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                    ? ["queen", "rook", "bishop", "knight"] as const : [undefined])
                    .map(promotion => ({ from, to, promotion }))));
            const branches = replies.map(move => {
                expect(root.after.isLegal(move)).toBe(true);
                const next = root.after.clone(); next.play(move);
                const fen = makeFen(next.toSetup());
                probes.push({ id: `${row.id}:reply:${makeUci(move)}`, fen, depth: 18 });
                return { reply: makeSan(root.after, move), move: makeUci(move), fen };
            });
            probes.push({ id: `${row.id}:best`, fen: row.fen, depth: 18 },
                { id: `${row.id}:held`, fen: row.fen, searchMove: row.move, depth: 18 });
            return { ...row, attempts, branches, observation: observeDefensibleMateThreat(root),
                result: classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] }),
                scoredResult: classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.line ?? [row.move], rootCp: row.rootCp }) };
        });
        const continuations = (input.continuations ?? []).map((line: { id: string; fen: string; moves: string[] }) => {
            const replay = replayTacticalLine(line.fen, line.moves);
            expect(replay).toHaveLength(line.moves.length);
            return { ...line, steps: replay.map(step => ({ move: step.uci, san: step.san,
                fen: makeFen(step.before.toSetup()), gain: step.capture ? tacticalCaptureGain(step) : null })) };
        });
        writeFileSync(output, JSON.stringify({ scope: "Private quiet-threat diagnostic, not tactical accuracy or a complete proof.", cases, probes, continuations }, null, 2), { flag: "wx" });
        console.log(cases.map((row: any) => ({ id: row.id, attempts: row.attempts.map((a: any) =>
            ({ budget: a.budget, gain: a.proof?.gain, failures: a.failures })), replies: row.branches.length })));
    },
    120000,
);
