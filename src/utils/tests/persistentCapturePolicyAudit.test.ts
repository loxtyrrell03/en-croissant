import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import { inspectPersistentPawnCapture } from "./fixtures/persistentPawnHistory";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";

const examples = [
    {
        id: "older-opportunity",
        fen: "6k1/8/8/4p3/8/8/6PP/4K1N1 w - - 0 1",
        history: ["g1f3", "g8h8"],
        capture: "f3e5",
        gain: 100,
    },
    {
        id: "unsettled-pawn-loss",
        fen: "6k1/8/8/1b2p3/P7/8/6PP/4K1N1 w - - 0 1",
        history: ["g1f3", "b5a4"],
        capture: "f3e5",
        gain: null,
    },
    {
        id: "settled-bishop-trade",
        fen: "6k1/8/8/1b2p3/B7/8/6PP/R3K1N1 w - - 0 1",
        history: ["g1f3", "b5a4", "a1a4", "g8h8"],
        capture: "f3e5",
        gain: 100,
    },
];

test.each([false, true])(
    "persistent opportunities retain exact exchange context: reflected=%s",
    (reflected) => {
        for (const row of examples) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const moves = reflected
                ? row.history.map(reflectMixedForkMove)
                : row.history;
            const capture = reflected
                ? reflectMixedForkMove(row.capture)
                : row.capture;
            const steps = replayTacticalLine(fen, [...moves, capture]);
            expect(steps).toHaveLength(moves.length + 1);
            expect(tacticalCaptureGain(steps.at(-1)!)).toBe(100);
            const result = inspectPersistentPawnCapture(steps.at(-1)!, {
                fen,
                moves,
            });
            expect({ id: row.id, gain: result?.gain ?? null }).toEqual({
                id: row.id,
                gain: row.gain,
            });
            expect(result === null || result.exchangeBalance === 0).toBe(true);
        }
    },
);

test("missing, stale, illegal, overlong and truncated histories do not establish a new pawn gain", () => {
    const row = examples[0];
    const steps = replayTacticalLine(row.fen, [...row.history, row.capture]);
    const root = steps.at(-1)!;
    for (const history of [
        null,
        { fen: row.fen, moves: [] },
        { fen: row.fen, moves: ["g1h3", "g8h8"] },
        { fen: row.fen, moves: ["g1g8"] },
        { fen: row.fen, moves: Array(17).fill("g1f3") },
        { fen: makeFen(steps[0].after.toSetup()), moves: ["g8h8"] },
    ])
        expect(inspectPersistentPawnCapture(root, history)).toBeNull();
});

test("delayed Petroff and Catalan pawn recoveries cannot use the persistent gain route", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    for (const moves of [
        ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5", "d7d6", "e5f3", "f6e4"],
        [
            "d2d4",
            "d7d5",
            "c2c4",
            "e7e6",
            "g1f3",
            "g8f6",
            "g2g3",
            "d5c4",
            "d1a4",
            "b8c6",
            "a4c4",
        ],
        [
            "d2d4",
            "d7d5",
            "c2c4",
            "e7e6",
            "g1f3",
            "g8f6",
            "g2g3",
            "d5c4",
            "f1g2",
            "b8c6",
            "d1a4",
            "c8d7",
            "a4c4",
        ],
    ]) {
        const steps = replayTacticalLine(fen, moves);
        expect(steps).toHaveLength(moves.length);
        expect(tacticalCaptureGain(steps.at(-1)!)).toBeGreaterThanOrEqual(100);
        expect(
            inspectPersistentPawnCapture(steps.at(-1)!, {
                fen,
                moves: moves.slice(0, -1),
            }),
        ).toBeNull();
    }
});

test("a closed-looking truncated window can still hide a gambit debt: do not ship this policy", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const moves = [
        "d2d4",
        "d7d5",
        "c2c4",
        "e7e6",
        "g1f3",
        "g8f6",
        "g2g3",
        "d5c4",
        "d1a4",
        "b8c6",
        "a4c4",
    ];
    const steps = replayTacticalLine(fen, moves);
    const root = steps.at(-1)!;
    expect(
        inspectPersistentPawnCapture(root, { fen, moves: moves.slice(0, -1) }),
    ).toBeNull();
    // This assertion records the experimental policy's concrete failure, not
    // the desired classifier result. Exact replay and a local availability
    // boundary do not prove that the supplied history contains the earlier debt.
    expect(
        inspectPersistentPawnCapture(root, {
            fen: makeFen(steps[7].after.toSetup()),
            moves: moves.slice(8, -1),
        })?.gain,
    ).toBe(100);
});

test.skipIf(
    !process.env.TACTICAL_CAPTURE_AUDIT_INPUTS ||
        !process.env.TACTICAL_PERSISTENT_HISTORY_REPORT,
)(
    "audit the experimental history policy against quiet pawn candidates in the full owner sample",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(
            process.env.TACTICAL_PERSISTENT_HISTORY_REPORT!,
        );
        expect(existsSync(output)).toBe(false);
        const inputs = JSON.parse(process.env.TACTICAL_CAPTURE_AUDIT_INPUTS!);
        const cases: any[] = [];
        for (const input of inputs) {
            const sample = JSON.parse(readFileSync(input.sample, "utf8"));
            const replay = JSON.parse(readFileSync(input.replay, "utf8"));
            expect(replay.sourceSha256).toBe(sample.sourceSha256);
            for (const game of sample.games) {
                const steps = replayTacticalLine(game.startFen, game.moves);
                expect(steps).toHaveLength(game.moves.length);
                for (const row of replay.results.filter(
                    (r: any) => r.game === game.id,
                )) {
                    const start = Math.max(0, row.ply - 16);
                    const history = {
                        fen: makeFen(steps[start].before.toSetup()),
                        moves: game.moves.slice(start, row.ply),
                    };
                    for (const candidate of row.before) {
                        const root = replayTacticalLine(
                            row.fen,
                            candidate.pvUci,
                        )[0];
                        if (root?.capture !== 100 || root.after.isCheck())
                            continue;
                        const policyCandidate = inspectPersistentPawnCapture(
                            root,
                            history,
                        );
                        const variation = row.scan.variations.find(
                            (v: any) => v.lineUci[0] === root.uci,
                        );
                        cases.push({
                            id: `${row.id}:${root.uci}`,
                            fen: row.fen,
                            history,
                            uci: root.uci,
                            policyCandidate,
                            inLiveScan: Boolean(variation),
                            existing: variation?.motifs ?? [],
                            candidate,
                        });
                    }
                }
            }
        }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Experimental history-aware policy candidates only; not production admission, accuracy labels or causal mistake explanations. No owner position is committed.",
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            JSON.stringify(
                cases
                    .filter(
                        (row) =>
                            row.policyCandidate &&
                            row.inLiveScan &&
                            !row.existing.length,
                    )
                    .map((row) => ({
                        id: row.id,
                        policyCandidate: row.policyCandidate,
                    })),
            ),
        );
    },
);
