import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import {
    proveDefensiveDeflection,
    provePerpetualCheck,
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    defensiveDeflectionFen,
    defensiveDeflectionMove,
    defensiveDeflectionControls,
} from "./fixtures/defensiveDeflection";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

test.each([false, true])(
    "deflecting the perpetual rook's king guard has a zero-material purpose (%s)",
    (reflected) => {
        const fen = reflected
            ? reflectMixedForkFen(defensiveDeflectionFen)
            : defensiveDeflectionFen;
        const move = reflected
            ? reflectMixedForkMove(defensiveDeflectionMove)
            : defensiveDeflectionMove;
        const root = replayTacticalLine(fen, [move])[0];
        const proof = proveDefensiveDeflection(root);
        expect(proof).not.toBeNull();
        expect(proof!.branches.length).toBeGreaterThan(1);
        expect(Math.min(...proof!.branches.map((b) => b.gain))).toBe(0);
        expect(proof!.perpetual.cycle.length).toBeGreaterThan(0);
        for (const budget of [0, 1, -1, 0.5, NaN, Infinity])
            expect(proveDefensiveDeflection(root, budget)).toBeNull();
    },
);

test.each(defensiveDeflectionControls)("reject an unproved defensive offer: $id", (row) => {
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const move = reflected ? reflectMixedForkMove(row.move) : row.move;
        const root = replayTacticalLine(fen, [move])[0];
        expect(root).toBeDefined();
        expect(proveDefensiveDeflection(root)).toBeNull();
    }
});

test("a claimable fifty-move draw cannot be hidden by the subsequent capture", () => {
    for (const clock of [97, 98, 99, 100]) {
        const root = replayTacticalLine(defensiveDeflectionFen.replace(" 0 1", ` ${clock} 1`), [
            defensiveDeflectionMove,
        ])[0];
        expect(Boolean(proveDefensiveDeflection(root))).toBe(clock === 97);
    }
});

test("fresh engine decisions retain the defensive root and reject unrelated winning offers", () => {
    const receipt=JSON.parse(readFileSync("benchmarks/tactical-relevance/defensive-deflection-stockfish-18.json","utf8"));
    expect(receipt.completed).toBe(84);
    for(const row of receipt.searches.filter((r:any)=>r.id.endsWith(":held"))){
        const line=row.lines[0];
        const result=classifyPositionTacticalMotifs({fen:row.fen,pvUci:line.pvUci,rootCp:line.cp});
        expect({id:row.id,deflection:result.motifs.some(m=>m.id==="defensiveDeflection")})
            .toEqual({id:row.id,deflection:row.id.startsWith("rook-offer:")});
    }
    for(const row of receipt.searches.filter((r:any)=>r.id.startsWith("rook-offer:")&&r.id.includes(":capture:"))){
        expect(row.lines[0].cp>200||row.lines[0].mate>0).toBe(true);
    }
});

test.each([false, true])(
    "the live root explains the defence without inventing material or future arrows (%s)",
    (reflected) => {
        const fen = reflected
            ? reflectMixedForkFen(defensiveDeflectionFen)
            : defensiveDeflectionFen;
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const result = classifyPositionTacticalMotifs({
            fen,
            pvUci: [move(defensiveDeflectionMove)],
            rootCp: 600,
        });
        expect(result.motifs[0]).toMatchObject({ id: "defensiveDeflection", ply: 1, value: 0 });
        const geometry = tacticalBoardEvidence(
            fen,
            [move(defensiveDeflectionMove)],
            result.motifs[0],
        );
        const arrows = geometry!.arrows.map((a) => a.from + a.to);
        expect(arrows).toEqual([defensiveDeflectionMove, "f6g6", "g6h7"].map(move));
        expect(arrows).not.toContain(move("g8h7"));
        const continued = classifyPositionTacticalMotifs({
            fen,
            pvUci: [defensiveDeflectionMove, "g6f6", "g8h7"].map(move),
            rootCp: 600,
        });
        expect(continued.timeline?.find((m) => m.ply === 3)).toMatchObject({
            label: "Defensive Trade",
            value: undefined,
        });
        for (const rootCp of [undefined, 0, -600, 199, Infinity, NaN]) {
            expect(
                classifyPositionTacticalMotifs({
                    fen,
                    pvUci: [move(defensiveDeflectionMove)],
                    rootCp,
                }).motifs.some((m) => m.id === "defensiveDeflection"),
            ).toBe(false);
        }
    },
);

test.each([false, true])(
    "missed defensive themes require an actual perpetual, not just a different move (%s)",
    (reflected) => {
        const fen = reflected
            ? reflectMixedForkFen(defensiveDeflectionFen)
            : defensiveDeflectionFen;
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const best = [defensiveDeflectionMove, "g6f6", "g8h7"].map(move);
        const input = {
            fen,
            bestMoveUci: best[0],
            pvUci: best,
            refutationUci: ["h7g7", "g8h8", "g7h7", "h8g8", "h7g7"].map(move),
            cpBefore: reflected ? 600 : -600,
            cpAfter: 0,
            cpLoss: 600,
        };
        const missed = classifyMistakeReviewMotifs({ ...input, playedMoveUci: move("b2b1") });
        expect(missed.missedMotifs.some((m) => m.id === "defensiveDeflection")).toBe(true);
        const explanation = buildMistakeReviewTacticalExplanation(missed);
        expect(explanation?.primary).toMatchObject({
            id: "perpetualCheck",
            source: "allowed",
            comparison: "prevented",
        });
        expect(explanation?.primary.comparisonEvidence).toContain("not merely the immediate check");
        expect(explanation?.secondary).toMatchObject({
            id: "defensiveDeflection",
            source: "missed",
            value: 0,
        });
        const equivalent = classifyMistakeReviewMotifs({ ...input, playedMoveUci: move("f8a8") });
        expect(
            [...equivalent.missedMotifs, ...(equivalent.missedTimeline ?? [])].some(
                (m) => m.id === "defensiveDeflection",
            ),
        ).toBe(false);
        const played = classifyMistakeReviewMotifs({ ...input, playedMoveUci: best[0] });
        expect(played.missedMotifs).toEqual([]);
    },
);

test.skipIf(!process.env.TACTICAL_DEFENSIVE_PROBES)(
    "emit constructed defensive decisions for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_DEFENSIVE_PROBES!);
        expect(existsSync(output)).toBe(false);
        const cases = [
            { id: "rook-offer", fen: defensiveDeflectionFen, move: defensiveDeflectionMove },
            ...defensiveDeflectionControls,
        ];
        const probes = cases.flatMap((row) =>
            [false, true].flatMap((reflected) => {
                const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
                const move = reflected ? reflectMixedForkMove(row.move) : row.move;
                const root = replayTacticalLine(fen, [move])[0];
                expect(root).toBeDefined();
                const pass = root.before.clone();
                pass.turn = root.after.turn;
                pass.epSquare = undefined;
                const result: { id: string; fen: string; searchMove?: string }[] = [
                    { id: "best", fen },
                    { id: "held", fen, searchMove: move },
                    { id: "pass", fen: makeFen(pass.toSetup()) },
                ];
                for (const [from, tos] of root.after.allDests())
                    for (const to of tos) {
                        const reply = { from, to };
                        if (!root.after.isLegal(reply)) continue;
                        const after = root.after.clone();
                        after.play(reply);
                        if (after.isEnd()) continue;
                        result.push({
                            id: `after:${makeUci(reply)}`,
                            fen: makeFen(after.toSetup()),
                        });
                        for (const branch of proveDefensiveDeflection(root)?.branches ?? []) {
                            if (branch.replyUci === makeUci(reply))
                                result.push({
                                    id: `capture:${makeUci(reply)}`,
                                    fen: branch.fen,
                                    searchMove: branch.captureUci,
                                });
                        }
                    }
                return result.map((probe) => ({
                    ...probe,
                    id: `${row.id}:${reflected}:${probe.id}`,
                }));
            }),
        );
        writeFileSync(
            output,
            JSON.stringify(
                { samplePath: "benchmarks/tactical-relevance/broader-game-context.json", probes },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(!process.env.TACTICAL_DEFENSIVE_OWNER || !process.env.TACTICAL_DEFENSIVE_REPORT)(
    "audit the owner defensive deflection and its checking threat",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const path = privateReportPath(process.env.TACTICAL_DEFENSIVE_REPORT!);
        expect(existsSync(path)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_DEFENSIVE_OWNER!, "utf8"));
        const row = input.results.find((r: any) => r.id === "recall:174477406194:ply83");
        expect(row).toBeDefined();
        const root = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
        const pass = root.before.clone();
        pass.turn = root.after.turn;
        pass.epSquare = undefined;
        const passFen = makeFen(pass.toSetup());
        const checks = [...pass.allDests()].flatMap(([from, tos]) =>
            [...tos].flatMap((to) => {
                const move = { from, to };
                if (!pass.isLegal(move)) return [];
                const steps = replayTacticalLine(passFen, [makeUci(move)]);
                if (!steps[0].after.isCheck()) return [];
                return [
                    { move: steps[0].san, uci: steps[0].uci, proof: provePerpetualCheck(steps) },
                ];
            }),
        );
        const replies = [...root.after.allDests()].flatMap(([from, tos]) =>
            [...tos].map((to) => {
                const steps = replayTacticalLine(row.fen, [
                    root.uci,
                    makeUci({ from, to }),
                    "g8h7",
                ]);
                expect(steps).toHaveLength(3);
                return {
                    reply: steps[1].san,
                    replyUci: steps[1].uci,
                    capture: steps[2].san,
                    immediateExchange: tacticalExchangeGain(steps[2].before, steps[2].move),
                    entryLoss: steps[1].capture,
                    after: makeFen(steps[2].after.toSetup()),
                };
            }),
        );
        const proof = proveDefensiveDeflection(root)!;
        const probes = [
            { id: "owner-best", fen: row.fen },
            { id: "owner-deflection", fen: row.fen, searchMove: root.uci },
            { id: "owner-pass", fen: passFen },
            { id: "owner-played", fen: row.fen, searchMove: row.playedMoveUci },
            { id: "owner-other-defence", fen: row.fen, searchMove: "f8a8" },
            ...proof.branches.flatMap((branch) => [
                { id: `owner-branch:${branch.replyUci}`, fen: branch.fen },
                {
                    id: `owner-capture:${branch.replyUci}`,
                    fen: branch.fen,
                    searchMove: branch.captureUci,
                },
            ]),
        ];
        writeFileSync(
            path,
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_DEFENSIVE_OWNER,
                    probes,
                    fen: row.fen,
                    passFen,
                    root: root.san,
                    checks,
                    replies,
                    before: row.before,
                    after: row.after,
                    classification: row.classification,
                    explanation: row.explanation,
                    defensiveProof: proveDefensiveDeflection(root),
                    current: classifyPositionTacticalMotifs({
                        fen: row.fen,
                        pvUci: row.before[0].pvUci,
                        rootCp: row.before[0].cp,
                    }),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        expect(checks.some((c) => c.proof)).toBe(true);
        expect(proveDefensiveDeflection(root)).not.toBeNull();
        expect(
            classifyPositionTacticalMotifs({
                fen: row.fen,
                pvUci: [root.uci],
                rootCp: row.before[0].cp,
            }).motifs[0]?.id,
        ).toBe("defensiveDeflection");
    },
);
