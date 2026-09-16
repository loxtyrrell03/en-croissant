import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import {
    proveImmediateFork,
    proveExchangeForPawnFork,
    replayTacticalLine,
    tacticalExchangeGain,
    tacticalCaptureGain,
    winningRecaptureEvidence,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    forkLocalValueCases,
    forkLocalValueFen,
    forkLocalValueLine,
    forkLocalValueLongLine,
    forkLocalValuePrefixFen,
    forkLocalValuePrefixLine,
    forkMateLiabilityFen,
} from "./fixtures/forkLocalValue";

test.each([false, true])(
    "winning recaptures debit off-square rook compensation: reflected=%s",
    (reflected) => {
        const original = "r5k1/8/3q4/3B3R/8/8/8/R5K1 b - - 0 1";
        for (const [board, expected] of [
            [original, null],
            [original.replace("r5k1", "6k1"), 570],
        ] as const) {
            const fen = reflected ? reflectMixedForkFen(board) : board;
            const moves = ["d6d5", "h5d5"];
            const replay = replayTacticalLine(
                fen,
                reflected ? moves.map(reflectMixedForkMove) : moves,
            );
            expect(replay).toHaveLength(2);
            const motif = {
                id: "hangingPiece",
                label: "Hanging Piece",
                source: "available",
                confidence: "high",
                relevance: "secondary",
                ply: 2,
                moveUci: replay[1].uci,
                value: 900,
                evidence: "",
            } as const;
            const result = winningRecaptureEvidence(replay, 1, motif);
            expect(tacticalCaptureGain(replay[1])).toBe(expected === null ? 400 : 900);
            expect(result && { label: result.label, value: result.value }).toEqual(expected === null ? null : { label: "Winning Recapture", value: expected });
        }
    },
);

test.each([false, true])(
    "a fork cannot fund its gain with a capture allowing mate: reflected=%s",
    (reflected) => {
        const fen = (value: string) => (reflected ? reflectMixedForkFen(value) : value);
        const moves = (line: string[]) => (reflected ? line.map(reflectMixedForkMove) : line);
        const refutation = replayTacticalLine(
            fen(forkMateLiabilityFen),
            moves(["g6h6", "h5g4", "h6c6", "e8e1"]),
        );
        expect(refutation).toHaveLength(4);
        expect(refutation[3].after.isCheckmate()).toBe(true);
        expect(proveImmediateFork(refutation[0])).toBeNull();
        expect(
            classifyPositionTacticalMotifs({
                fen: fen(forkMateLiabilityFen),
                pvUci: moves(["g6h6"]),
            }).motifs.some((m) => m.id === "fork"),
        ).toBe(false);
        for (const [safe, gain] of [
            [forkMateLiabilityFen.replace("4r3", "8"), 320],
            [forkMateLiabilityFen.replace("PPP2q1P", "PPP4P"), 420],
        ] as const) {
            const step = replayTacticalLine(fen(safe), moves(["g6h6"]))[0];
            expect(proveImmediateFork(step)?.gain).toBe(gain);
        }
    },
);

test.each([false, true])(
    "ordinary fork gain is local, not a later pawn or earlier queen: reflected=%s",
    (reflected) => {
        const fen = (value: string) => (reflected ? reflectMixedForkFen(value) : value);
        const moves = (value: string[]) => (reflected ? value.map(reflectMixedForkMove) : value);
        for (const [board, line, ply] of [
            [forkLocalValueFen, forkLocalValueLine.slice(0, 1), 1],
            [forkLocalValueFen, forkLocalValueLine, 1],
            [forkLocalValueFen, forkLocalValueLongLine, 1],
            [forkLocalValuePrefixFen, forkLocalValuePrefixLine, 3],
        ] as const) {
            const input = { fen: fen(board), pvUci: moves([...line]) };
            expect(replayTacticalLine(input.fen, input.pvUci)).toHaveLength(line.length);
            const source = classifyPositionTacticalMotifs(input);
            expect(source.motifs.find((m) => m.id === "fork" && m.ply === ply)).toMatchObject({
                value: 320,
            });
            const proof = proveImmediateFork(replayTacticalLine(input.fen, input.pvUci)[ply - 1]);
            expect(proof?.gain).toBe(320);
            expect(proof?.branches.length).toBeGreaterThan(0);
        }
        for (const line of [
            forkLocalValueLine.slice(0, 1),
            forkLocalValueLine,
            forkLocalValueLongLine,
        ])
            expect(
                buildLiveTacticalScan({
                    fen: fen(forkLocalValueFen),
                    pvUci: moves(line),
                    engineName: "Constructed control",
                    depth: 16,
                }).motifs[0],
            ).toMatchObject({ id: "fork", value: 320 });
    },
);

test("a legal king capture of an unprotected queen still refutes the fork", () => {
    const input = { fen: forkLocalValueFen.replace("4k3/7p/8/8", "8/7p/8/k7"), pvUci: ["d1a4"] };
    const step = replayTacticalLine(input.fen, input.pvUci)[0];
    expect(step).toBeTruthy();
    expect(step.after.isLegal({ from: 32, to: 24 })).toBe(true);
    expect(proveImmediateFork(step)).toBeNull();
});

test("the real double-check fork cannot fund its bound by hanging its queen", () => {
    const fen = "4r1k1/6p1/7p/ppnNq1P1/4r3/1QP1P3/PP6/2K2N1R w - - 3 33";
    const step = replayTacticalLine(fen, ["d5f6"])[0];
    expect(proveImmediateFork(step)).toBeNull();
    expect(proveExchangeForPawnFork(step)).toBeNull();
    const safe = replayTacticalLine(fen.replace("ppnN", "pp1N"), ["d5f6"])[0];
    expect(proveImmediateFork(safe)?.gain).toBe(180);
});

test.each([false, true])(
    "a promotion fork counts its own promotion, not unrelated PV material: reflected=%s",
    (reflected) => {
        const original = "K7/1P1q3p/k7/8/8/6P1/7P/8 w - - 0 54";
        const fen = reflected ? reflectMixedForkFen(original) : original;
        const line = ["b7b8n", "a6b5", "b8d7"];
        const pvUci = reflected ? line.map(reflectMixedForkMove) : line;
        expect(proveImmediateFork(replayTacticalLine(fen, pvUci)[0])?.gain).toBe(1120);
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci: pvUci.slice(0, 1) }).motifs[0],
        ).toMatchObject({ id: "fork", value: 1120 });
    },
);

test.each([false, true])(
    "fork exchanges include root captures and a promoting defensive interposition: reflected=%s",
    (reflected) => {
        const reflectFen = (fen: string) => (reflected ? reflectMixedForkFen(fen) : fen);
        const reflectMove = (move: string) => (reflected ? reflectMixedForkMove(move) : move);
        const board = "q6k/8/8/1B6/8/8/2K5/4R3 w - - 0 1";
        const step = replayTacticalLine(reflectFen(board), [reflectMove("e1e8")])[0];
        const proof = proveImmediateFork(step)!;
        expect(proof.gain).toBe(400);
        expect(proof.branches.find((branch) => branch.replyUci === reflectMove("a8e8"))?.gain).toBe(
            400,
        );
        const capturing = board.replace("q6k", "q3n2k");
        expect(
            proveImmediateFork(replayTacticalLine(reflectFen(capturing), [reflectMove("e1e8")])[0])
                ?.gain,
        ).toBe(720);
        const promoting = "4R3/2K5/8/8/1B6/8/5p2/q6k w - - 0 1";
        const promotedSteps = replayTacticalLine(reflectFen(promoting), [
            reflectMove("e8e1"),
            reflectMove("f2f1q"),
        ]);
        expect(promotedSteps).toHaveLength(2);
        // Rxf1 Qxf1 gives back the promoted queen but takes the rook: the
        // promotion's exchange-adjusted gain is 400, not its nominal 800.
        expect(tacticalExchangeGain(promotedSteps[1].before, promotedSteps[1].move)).toBe(400);
        expect(proveImmediateFork(promotedSteps[0])).toBeNull();
    },
);

test.skipIf(!process.env.TACTICAL_DISJOINT_REPLAY)(
    "real reached forks retain their gain across source prefixes and suffixes",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_DISJOINT_REPLAY!, "utf8"));
        const game = [...new Set(report.results.map((row: any) => row.game))][2];
        for (const ply of [16, 18]) {
            const row = report.results.find((row: any) => row.game === game && row.ply === ply);
            const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
            const fork = result.motifs.find((m) => m.id === "fork" && m.ply! > 1)!;
            expect(fork).toBeTruthy();
            const steps = replayTacticalLine(row.fen, row.sourceUci);
            const reached = makeFen(steps[fork.ply! - 1].before.toSetup());
            for (const suffix of [row.sourceUci.slice(fork.ply! - 1), [fork.moveUci!]]) {
                const isolated = classifyPositionTacticalMotifs({ fen: reached, pvUci: suffix });
                expect(isolated.motifs.find((m) => m.id === "fork")?.value).toBe(fork.value);
            }
            expect(fork.value).toBe(320);
        }
    },
);

test.skipIf(!process.env.TACTICAL_FORK_VALUE_PROBES || !process.env.TACTICAL_DISJOINT_REPLAY)(
    "prepare private independent engine checks of local fork bounds",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_FORK_VALUE_PROBES!);
        expect(existsSync(output)).toBe(false);
        const report = JSON.parse(readFileSync(process.env.TACTICAL_DISJOINT_REPLAY!, "utf8"));
        const games = [...new Set(report.results.map((row: any) => row.game))];
        const roots = forkLocalValueCases
            .filter((row) => row.gain !== null && row.id !== "later-pawn")
            .map((row) => ({ id: row.id, fen: row.fen, move: row.pvUci[0] }));
        for (const ply of [16, 18]) {
            const row = report.results.find((row: any) => row.game === games[2] && row.ply === ply);
            const steps = replayTacticalLine(row.fen, row.sourceUci);
            const step = steps.find((step) => step.uci === "d1a4")!;
            roots.push({
                id: `owner-prefix-${ply}`,
                fen: makeFen(step.before.toSetup()),
                move: step.uci,
            });
        }
        const unsafe = report.results.find((row: any) => row.game === games[0] && row.ply === 54);
        roots.push({ id: "owner-known-mating-liability", fen: unsafe.fen, move: "g6h6" });
        const rare = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/rare-theme-development.json", "utf8"),
        ).cases.find((row: any) => row.id === "lichess:tA2XR");
        roots.push({ id: "real-double-check-fork", fen: rare.startFen, move: rare.bestLine[0] });
        const probes: any[] = [],
            certificates: any[] = [];
        for (const root of roots) {
            const step = replayTacticalLine(root.fen, [root.move])[0];
            const proof = proveImmediateFork(step)!;
            expect(Boolean(proof)).toBe(
                !["owner-known-mating-liability", "real-double-check-fork"].includes(root.id),
            );
            certificates.push({ ...root, proof });
            probes.push({ id: `${root.id}:root`, fen: root.fen, searchMove: root.move });
            for (const branch of proof?.branches ?? []) {
                probes.push({
                    id: `${root.id}:${branch.replyUci}`,
                    fen: root.fen,
                    moves: [root.move, branch.replyUci],
                    ...(branch.captureUci ? { searchMove: branch.captureUci } : {}),
                });
            }
        }
        const promotion = forkLocalValueCases.find((row) => row.id === "promotion-interposition")!;
        const exchangeKnight = "3qk2r/8/8/4N3/2BP4/8/PPP2PPP/R4RK1 w k - 0 1";
        const opening = "rnbq1bnr/pppp1kpp/5P2/8/8/2N5/PP2QPPP/R1B1KBNR w KQ - 1 8";
        probes.push(
            { id: "exchange-fork:root", fen: exchangeKnight, searchMove: "e5f7" },
            {
                id: "exchange-fork:other-minor",
                fen: exchangeKnight,
                moves: ["e5f7", "d8d4", "f7h8"],
                searchMove: "d4c4",
            },
            {
                id: "exchange-fork:forker",
                fen: exchangeKnight,
                moves: ["e5f7", "d8d4", "f7h8"],
                searchMove: "d4h8",
            },
            {
                id: "real-double-check-fork:unsafe-rook",
                fen: rare.startFen,
                moves: ["d5f6", "g8h8"],
                searchMove: "f6e4",
            },
            {
                id: "real-double-check-fork:quiet-queen-tempo",
                fen: rare.startFen,
                moves: ["d5f6", "g8h8"],
                searchMove: "b3f7",
            },
            {
                id: "real-double-check-fork:no-queen-liability",
                fen: rare.startFen.replace("ppnN", "pp1N"),
                searchMove: "d5f6",
            },
            { id: "opening-check:root", fen: opening, searchMove: "e2h5" },
            {
                id: "opening-check:conditional-queen-recapture",
                fen: opening,
                moves: ["e2h5", "g7g6", "f1c4", "d7d5", "c4d5", "d8d5"],
                searchMove: "h5d5",
            },
            {
                id: "opening-check:equal-exchange-pawn-reply",
                fen: opening,
                moves: ["e2h5", "g7g6", "f1c4", "d7d5", "h5d5", "d8d5", "c4d5"],
                searchMove: "f7f6",
            },
            {
                id: "owner-known-mating-liability:payoff",
                fen: unsafe.fen,
                moves: ["g6h6", "h5g4"],
                searchMove: "h6c6",
                mateWithin: -1,
            },
            {
                id: "constructed-mating-liability:root",
                fen: forkMateLiabilityFen,
                searchMove: "g6h6",
            },
            {
                id: "constructed-mating-liability:payoff",
                fen: forkMateLiabilityFen,
                moves: ["g6h6", "h5g4"],
                searchMove: "h6c6",
            },
            {
                id: "constructed-no-mating-guard:root",
                fen: forkMateLiabilityFen.replace("PPP2q1P", "PPP4P"),
                searchMove: "g6h6",
            },
            { id: "promotion-interposition:held-root", fen: promotion.fen, searchMove: "e8e1" },
            {
                id: "promotion-interposition:defence",
                fen: promotion.fen,
                moves: ["e8e1"],
                searchMove: "f2f1q",
            },
        );
        writeFileSync(
            output,
            JSON.stringify(
                { samplePath: process.env.TACTICAL_DISJOINT_REPLAY, certificates, probes },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
