import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { proveCheckingMate, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { probeKingPawnEndgame } from "../tacticalMotifs/kpkBitbase";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    matingCheckEvasionCases,
    matingCheckEvasionFen,
    matingCheckEvasionLine,
} from "./fixtures/matingCheckEvasion";

const cases = matingCheckEvasionCases.flatMap((row) =>
    [false, true].map((reflected) => ({
        ...row,
        id: `${row.id}:${reflected}`,
        fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
        pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
    })),
);
const publicRecall = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/quiet-mate-development.json", "utf8"),
).cases.find((row: any) => row.id === "lichess:0QPvf");
const sourcePublicCases = [false, true].map((reflected) => ({
    id: `${publicRecall.id}:${reflected}`,
    scope: "reused public development",
    fen: reflected ? reflectMixedForkFen(publicRecall.startFen) : publicRecall.startFen,
    pvUci: reflected ? publicRecall.bestLine.map(reflectMixedForkMove) : publicRecall.bestLine,
}));
const alternatePublicLine = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/quiet-mate-stockfish-18.json", "utf8"),
).searches.find((row: any) => row.id === "lichess:0QPvf:root");
const publicCases = [
    ...sourcePublicCases,
    ...[false, true].map((reflected) => ({
        id: `lichess:0QPvf-engine:${reflected}`,
        scope: "reused public engine development",
        fen: reflected ? reflectMixedForkFen(alternatePublicLine.fen) : alternatePublicLine.fen,
        pvUci: reflected
            ? alternatePublicLine.lines[0].pvUci.map(reflectMixedForkMove)
            : alternatePublicLine.lines[0].pvUci,
    })),
];
test("the same rook attack is inspected with its independent engine nomination", () => {
    const result = inspect(alternatePublicLine.fen, alternatePublicLine.lines[0].pvUci);
    assert(result.proof, JSON.stringify(result.trace));
    expect(result.proof.maxMoves).toBe(4);
});

function inspect(fen: string, pvUci: string[]) {
    const steps = replayTacticalLine(fen, pvUci);
    expect(steps).toHaveLength(pvUci.length);
    const trace: string[] = [];
    const proof = proveCheckingMate(steps, 65536, true, (reason) => trace.push(reason));
    const probes = new Map<
        string,
        { fen: string; searchMove: string; certificateMateWithin: number }
    >();
    let evasions = 0,
        quietPreparations = 0;
    if (proof) {
        const { strategy, visits, ...ordinary } = proof;
        assert(strategy);
        assert(visits !== undefined && visits <= 65536);
        assert.deepEqual(proveCheckingMate(steps), ordinary);
        const walk = (node: typeof strategy, remaining: number, preparations: number) => {
            const board = Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
            const legal = [...board.allDests()].flatMap(([from, dests]) =>
                [...dests].flatMap((to) =>
                    board.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                        ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) =>
                              makeUci({ from, to, promotion }),
                          )
                        : [makeUci({ from, to })],
                ),
            );
            assert.deepEqual(node.replies.map((branch) => branch.move).sort(), legal.sort());
            if (!legal.length) {
                assert(board.isCheckmate());
                quietPreparations = Math.max(quietPreparations, preparations);
                return;
            }
            assert(remaining > 0);
            for (const branch of node.replies) {
                const afterReply = board.clone();
                afterReply.play(parseUci(branch.move)!);
                const answer = parseUci(branch.answer)!;
                assert(afterReply.isLegal(answer));
                const checked = afterReply.isCheck();
                const next = afterReply.clone();
                next.play(answer);
                if (checked && !next.isCheck()) evasions++;
                if (!checked && !next.isCheck() && !pvUci.includes(branch.answer))
                    assert(
                        branch.next.replies.length > 0 &&
                            branch.next.replies.every((reply) => reply.next.replies.length === 0),
                    );
                const probe = {
                    fen: makeFen(afterReply.toSetup()),
                    searchMove: branch.answer,
                    certificateMateWithin: remaining,
                };
                probes.set(`${probe.fen}:${probe.searchMove}`, probe);
                assert.equal(makeFen(next.toSetup()), branch.next.fen);
                walk(
                    branch.next,
                    remaining - 1,
                    preparations + Number(!checked && !next.isCheck()),
                );
            }
        };
        walk(strategy, proof.maxMoves - 1, 0);
        assert(quietPreparations <= 2);
    }
    return { fen, pvUci, proof, trace, evasions, quietPreparations, probes: [...probes.values()] };
}

test.each(cases)("mating check evasions retain all-defence proof: $id", (row) => {
    const result = inspect(row.fen, row.pvUci);
    expect(Boolean(result.proof)).toBe(row.positive);
    if (row.positive) {
        assert(result.evasions > 0);
        assert.equal(result.proof!.maxMoves, 7);
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            pvUci: row.pvUci,
            engineName: "Stockfish",
            depth: 16,
        });
        assert.equal(scan.motifs[0].id, "mateIn7");
        assert.equal(scan.motifs[0].ply, 1);
        assert.equal(scan.labels[0].text, "Forcing Mate");
        assert.match(scan.motifs[0].evidence ?? "", /within 7 moves/);
        assert.equal(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.pvUci }).motifs[0].id,
            "mateIn7",
        );
    }
});

test("missing mate nomination cannot borrow a prior cached full-line proof", () => {
    const full = replayTacticalLine(matingCheckEvasionFen, matingCheckEvasionLine);
    expect(proveCheckingMate(full)).not.toBeNull();
    expect(proveCheckingMate(full.slice(0, 1))).toBeNull();
    expect(proveCheckingMate(full, 1)).toBeNull();
});

test.each(publicCases)("a reused rook attack now proves mate through counterchecks: $id", (row) => {
    const result = inspect(row.fen, row.pvUci);
    expect(result.proof?.maxMoves).toBe(4);
    expect(result.evasions).toBeGreaterThan(0);
    expect(classifyPositionTacticalMotifs(row).motifs[0]).toMatchObject({
        id: "mateIn4",
        label: "Forcing Mate",
    });
});

test("exchanging queens misses the verified mate; actually playing the mate is not a mistake", () => {
    const exchanged = replayTacticalLine(matingCheckEvasionFen, ["e4a8"])[0].after;
    expect(
        [...exchanged.allDests()].flatMap(([from, dests]) =>
            [...dests].map((to) => makeUci({ from, to })),
        ),
    ).toEqual(["b8a8"]);
    const ending = replayTacticalLine(makeFen(exchanged.toSetup()), ["b8a8"])[0].after;
    expect(probeKingPawnEndgame(ending)).toMatchObject({ pawnSide: "white", win: false });
    const input = {
        fen: matingCheckEvasionFen,
        bestMoveUci: "e4e5",
        playedMoveUci: "e4a8",
        pvUci: matingCheckEvasionLine,
        refutationUci: ["b8a8"],
        cpLoss: 1000,
    };
    expect(classifyMistakeReviewMotifs(input).missedMotifs[0]).toMatchObject({
        id: "mateIn7",
        source: "missed",
    });
    expect(
        classifyMistakeReviewMotifs({ ...input, playedMoveUci: input.bestMoveUci }).missedMotifs,
    ).toEqual([]);
});

test.skipIf(
    !process.env.TACTICAL_MATE_EVASION_ENGINE_REPORT ||
        !process.env.TACTICAL_MATE_EVASION_STRATEGIES,
)("reconcile every fresh engine decision with its exact independently checked strategy", () => {
    const input = process.env.TACTICAL_MATE_EVASION_ENGINE_REPORT!;
    const paths: string[] = input.startsWith("[") ? JSON.parse(input) : [input];
    const reports = paths.map((path) => JSON.parse(readFileSync(path, "utf8")));
    const strategies = JSON.parse(
        readFileSync(process.env.TACTICAL_MATE_EVASION_STRATEGIES!, "utf8"),
    );
    expect(reports.length).toBeGreaterThan(0);
    for (const report of reports) {
        expect(report.requested).toBe(report.completed);
        expect(report.searches).toHaveLength(report.completed);
        expect(new Set(report.searches.map((row: any) => row.id)).size).toBe(report.completed);
    }
    // A later nominated line may reuse exact decisions under different case IDs.
    // Keep the full FEN, including clocks, and the held move as evidence identity.
    const byPosition = new Map(
        reports.flatMap((report) =>
            report.searches.map((row: any) => [`${row.fen}:${row.searchMove}`, row]),
        ),
    );
    for (const probe of strategies.probes) {
        const row: any = byPosition.get(`${probe.fen}:${probe.searchMove}`);
        expect(row).toMatchObject({ fen: probe.fen, searchMove: probe.searchMove });
        expect(row.lines[0].depth).toBe(16);
        expect(replayTacticalLine(row.fen, row.lines[0].pvUci)).toHaveLength(
            row.lines[0].pvUci.length,
        );
        if (probe.certificateMateWithin)
            assert(row.lines[0].mate > 0 && row.lines[0].mate <= probe.certificateMateWithin);
    }
    if (process.env.TACTICAL_MATE_EVASION_EXPORT_PUBLIC === "1") {
        const output =
            reports.length === 1
                ? "benchmarks/tactical-relevance/mating-check-evasion-stockfish-18.json"
                : "benchmarks/tactical-relevance/mating-check-evasion-supplement-stockfish-18.json";
        assert(!existsSync(output));
        const publicIds = new Set([...cases, ...publicCases].map((row) => row.id));
        const searches = reports
            .at(-1)!
            .searches.filter((row: any) => publicIds.has(row.id.replace(/:(root|answer:\d+)$/, "")))
            .map((row: any) => ({
                id: row.id,
                fen: row.fen,
                searchMove: row.searchMove,
                certificateMateWithin: row.certificateMateWithin,
                depth: row.lines[0].depth,
                cp: row.lines[0].cp,
                mate: row.lines[0].mate,
                pvUci: row.lines[0].pvUci,
            }));
        assert(searches.length > 0 && searches.every((row: any) => !row.id.startsWith("recall:")));
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Constructed and reused public development decisions. Not independent puzzle counts or an accuracy score.",
                    engine: "Stockfish 18, depth 16, held root moves",
                    searches,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
    }
});

test("public exact mating choices retain independently searched positive mate bounds", () => {
    const receipts = [
        "mating-check-evasion-stockfish-18.json",
        "mating-check-evasion-supplement-stockfish-18.json",
    ].flatMap(
        (name) =>
            JSON.parse(readFileSync(`benchmarks/tactical-relevance/${name}`, "utf8")).searches,
    );
    const byPosition = new Map(receipts.map((row: any) => [`${row.fen}:${row.searchMove}`, row]));
    for (const row of [...cases.filter((item) => item.positive), ...publicCases]) {
        const result = inspect(row.fen, row.pvUci);
        assert(result.proof);
        const decisions = [
            {
                fen: row.fen,
                searchMove: row.pvUci[0],
                certificateMateWithin: result.proof.maxMoves,
            },
            ...result.probes,
        ];
        for (const decision of decisions) {
            const searched: any = byPosition.get(`${decision.fen}:${decision.searchMove}`);
            assert(searched, `${row.id}: missing held search ${decision.searchMove}`);
            assert.equal(searched.depth, 16);
            assert.equal(searched.pvUci[0], decision.searchMove);
            assert(searched.mate > 0 && searched.mate <= decision.certificateMateWithin);
            assert.equal(
                replayTacticalLine(searched.fen, searched.pvUci).length,
                searched.pvUci.length,
            );
        }
    }
});

test.skipIf(!process.env.TACTICAL_MATE_EVASION_REPORT)(
    "audit constructed and selected private mating strategies independently",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_MATE_EVASION_REPORT!);
        expect(existsSync(output)).toBe(false);
        const reportCases: any[] = [
            ...cases.map((row) => ({
                ...row,
                ...inspect(row.fen, row.pvUci),
                scope: "constructed",
            })),
            ...publicCases.map((row) => ({ ...row, ...inspect(row.fen, row.pvUci) })),
        ];
        if (process.env.TACTICAL_MATE_EVASION_INPUT) {
            const input = JSON.parse(readFileSync(process.env.TACTICAL_MATE_EVASION_INPUT, "utf8"));
            const ids: string[] = JSON.parse(process.env.TACTICAL_MATE_EVASION_IDS ?? "[]");
            assert(ids.length > 0);
            const rows = input.results.filter((row: any) => ids.includes(row.id));
            assert.equal(rows.length, ids.length);
            for (const row of rows)
                for (const reflected of [false, true]) {
                    let fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
                    const pvUci = reflected
                        ? row.before[0].pvUci.map(reflectMixedForkMove)
                        : row.before[0].pvUci;
                    const tacticalHistory = !reflected
                        ? row.tacticalHistory
                        : {
                              fen: reflectMixedForkFen(row.tacticalHistory.fen),
                              moves: row.tacticalHistory.moves.map(reflectMixedForkMove),
                          };
                    const reached = replayTacticalLine(tacticalHistory.fen, tacticalHistory.moves);
                    assert.equal(reached.length, tacticalHistory.moves.length);
                    const actualFen = makeFen(reached.at(-1)!.after.toSetup());
                    // A black-started reflection increments the fullmove counter on
                    // different plies. Preserve the true replayed clock and history.
                    assert.deepEqual(actualFen.split(" ").slice(0, 5), fen.split(" ").slice(0, 5));
                    fen = actualFen;
                    const result = inspect(fen, pvUci);
                    assert(result.proof);
                    reportCases.push({
                        id: `${row.id}:${reflected}`,
                        scope: "owner development",
                        tacticalHistory,
                        ...result,
                    });
                }
        }
        let independent: unknown = null;
        if (process.env.TACTICAL_MATE_STRATEGY_PYTHON) {
            const checked = spawnSync(
                process.env.TACTICAL_MATE_STRATEGY_PYTHON,
                ["scripts/benchmarks/verify-mating-strategy.py"],
                {
                    input: JSON.stringify({ cases: reportCases }),
                    encoding: "utf8",
                    windowsHide: true,
                },
            );
            assert.equal(checked.status, 0, checked.stderr);
            independent = JSON.parse(checked.stdout);
        }
        const probes = reportCases.flatMap((row) => [
            { id: `${row.id}:root`, fen: row.fen, searchMove: row.pvUci[0] },
            ...row.probes.map((probe: any, index: number) => ({
                ...probe,
                id: `${row.id}:answer:${index}`,
            })),
        ]);
        if (
            process.env.TACTICAL_MATE_EVASION_REUSE_ENGINE &&
            process.env.TACTICAL_MATE_EVASION_SUPPLEMENT
        ) {
            const earlier = JSON.parse(
                readFileSync(process.env.TACTICAL_MATE_EVASION_REUSE_ENGINE, "utf8"),
            );
            assert.equal(earlier.completed, earlier.requested);
            const completed = new Set(
                earlier.searches.map((row: any) => `${row.fen}:${row.searchMove}`),
            );
            const missing = [
                ...new Map(
                    probes
                        .filter((probe) => !completed.has(`${probe.fen}:${probe.searchMove}`))
                        .map((probe) => [`${probe.fen}:${probe.searchMove}`, probe]),
                ).values(),
            ];
            const supplement = privateReportPath(process.env.TACTICAL_MATE_EVASION_SUPPLEMENT);
            assert(!existsSync(supplement));
            writeFileSync(
                supplement,
                JSON.stringify(
                    {
                        samplePath:
                            process.env.TACTICAL_MATE_EVASION_INPUT ??
                            "benchmarks/tactical-relevance/quiet-mate-development.json",
                        probes: missing,
                    },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    samplePath:
                        process.env.TACTICAL_MATE_EVASION_INPUT ??
                        "benchmarks/tactical-relevance/quiet-mate-development.json",
                    scope: "Development strategies and contrary controls, not an accuracy estimate.",
                    cases: reportCases,
                    independent,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
    120000,
);
