import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";
import {
    proveCheckingMaterialAttack,
    proveQuietDoubleThreat,
    replayTacticalLine,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

// Deliberately judged as positions, not by agreement with puzzle tags. The
// quiet controls matter as much as the combinations. Run explicitly with
// TACTICAL_JUDGEMENT_ENGINE set to a local UCI engine; no engine starts in CI.
const cases = [
    {
        name: "Initial position",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        why: "Development; no immediate tactical win.",
    },
    {
        name: "Quiet Italian",
        fen: "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
        why: "Normal development; f7 pressure is not a winning capture.",
    },
    {
        name: "Ruy Lopez pressure",
        fen: "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
        why: "The c6 knight's pin is positional pressure, not a won piece.",
    },
    {
        name: "Hanging queen",
        fen: "r5k1/5ppp/8/8/Q7/8/5PPP/6K1 b - - 0 1",
        why: "Rxa4 wins a loose queen immediately; any later mate is secondary.",
    },
    {
        name: "Protected f7 fork",
        fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
        why: "Nxf7 forks queen and rook; Bxf7+ is a sound secondary capture.",
    },
    {
        name: "Back rank mate",
        fen: "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
        why: "Re8#; the back rank is the direct reason.",
    },
    {
        name: "Deflection combination",
        fen: "3r2k1/p4ppp/1p6/2pr2q1/4R3/1P2PQ2/P5PP/3R2K1 w - - 0 23",
        why: "Rxd5 Qxd5 Re8+ deflects the d8 rook, then Qxd5 wins the queen.",
    },
    {
        name: "Branch-dependent mating pattern",
        fen: "rr6/p3p2k/3pNpp1/1pp5/2q1P3/5R2/P2Q2PP/6K1 w - - 0 27",
        why: "Qh6+ forces mate, but Kxh6 Rh3# and Kg8 Qg7# have different patterns. Only the selected branch may name Anastasia's mate.",
    },
    {
        name: "King and pawn quiet",
        fen: "8/5k2/5p2/8/8/5P2/5K2/8 w - - 0 1",
        why: "Drawn pawn ending; no invented zugzwang or tactical king move.",
    },
];

test.skipIf(!process.env.TACTICAL_JUDGEMENT_ENGINE || !process.env.TACTICAL_DEFENDER_REPORT)(
    "inspect real defender-removal defences",
    async () => {
        const examples = [
            {
                fen: "3r1rk1/1b2n1p1/pb2P2p/1p1n1p2/2p1BN1B/5N1P/P4PP1/3RR1K1 w - - 0 26",
                root: "e4d5",
                replies: ["b6f2", "g7g5", "f8f6"],
            },
            {
                fen: "r4rk1/pp3ppp/7q/3Np1NP/3n1P2/3P2b1/PPPQ2B1/R4K1R b - - 2 23",
                root: "g3f4",
                replies: ["d5f4", "d5f6", "d5e7", "g5h3", "g5e4"],
            },
        ];
        const report = [];
        for (const example of examples)
            for (const reply of example.replies) {
                const pos = Chess.fromSetup(parseFen(example.fen).unwrap()).unwrap();
                pos.play(parseUci(example.root)!);
                pos.play(parseUci(reply)!);
                const lines = [
                    ...(
                        await analyse(
                            process.env.TACTICAL_JUDGEMENT_ENGINE!,
                            makeFen(pos.toSetup()),
                        )
                    ).values(),
                ];
                const started = performance.now();
                const classification = classifyPositionTacticalMotifs({
                    fen: example.fen,
                    pvUci: [example.root, reply, ...lines[0].pvUci],
                });
                report.push({
                    fen: example.fen,
                    root: example.root,
                    reply,
                    lines,
                    classification,
                    classificationMs: performance.now() - started,
                    judgement:
                        example.root === "e4d5"
                            ? "Removing Nd5's defence of Ne7 is primary, with the simultaneous bishop attack and rook behind Ne7 explaining alternative defences."
                            : "Diagnostic only: Bxf4 is still unresolved by the bounded proof. Fresh engine lines reveal intermediate checks and a 90 cp nominal exchange gain; no correct-classification assertion is made.",
                });
            }
        writeFileSync(process.env.TACTICAL_DEFENDER_REPORT!, JSON.stringify(report, null, 2));
        for (const item of report.filter((item) => item.root === "e4d5"))
            expect(item.classification.motifs[0]?.id).toBe("capturingDefender");
    },
    180000,
);

test.skipIf(
    !process.env.TACTICAL_JUDGEMENT_ENGINE || !process.env.TACTICAL_EXCHANGE_DISCOVERY_REPORT,
)(
    "inspect the overloaded-queen discovery and defensive branches",
    async () => {
        const fen = "2kr1br1/pp1n1p2/2p2p1p/q6b/2BNN3/P2Q3P/1PP2PP1/R3R1K1 b - - 0 15";
        const prefixes = [
            [],
            ["d7e5", "d3c3"],
            ["d7e5", "d3f1"],
            ["d7e5", "d3b3"],
            ["d7e5", "d3e2"],
            ["d7e5", "d3c3", "a5c3", "e4d6"],
        ];
        const report = [];
        for (const prefix of prefixes) {
            const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
            for (const uci of prefix) {
                const move = parseUci(uci)!;
                expect({ uci, legal: pos.isLegal(move) }).toEqual({ uci, legal: true });
                pos.play(move);
            }
            const lines = [
                ...(
                    await analyse(process.env.TACTICAL_JUDGEMENT_ENGINE!, makeFen(pos.toSetup()))
                ).values(),
            ];
            const started = performance.now();
            const classification = classifyPositionTacticalMotifs({
                fen,
                pvUci: [...prefix, ...lines[0].pvUci],
            });
            report.push({
                fen,
                prefix,
                lines,
                classification,
                classificationMs: performance.now() - started,
            });
        }
        writeFileSync(
            process.env.TACTICAL_EXCHANGE_DISCOVERY_REPORT!,
            JSON.stringify(report, null, 2),
        );
        for (const entry of report) {
            expect(entry.classification.motifs[0]).toMatchObject({
                id: "discoveredAttack",
                ply: 1,
            });
            expect(entry.classification.motifs[0].evidence).toContain("Qc3, Qxc3");
        }
    },
    180000,
);

test.skipIf(!process.env.TACTICAL_JUDGEMENT_ENGINE || !process.env.TACTICAL_PIN_PREPARATION_REPORT)(
    "inspect clearance into a quiet pin and alternative king defences",
    async () => {
        const fen = "2rr2k1/1p3pp1/4p3/p2pP1N1/1n1q4/1Q1B4/1P3P1P/5RK1 w - - 0 22";
        const prefixes = [
            [],
            ["d3h7", "g8f8"],
            ["d3h7", "g8h8"],
            ["d3h7", "g8f8", "b3f3"],
            ["d3h7", "g8h8", "b3h3"],
        ];
        const report = [];
        for (const prefix of prefixes) {
            const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
            for (const uci of prefix) {
                const move = parseUci(uci)!;
                expect({ uci, legal: pos.isLegal(move) }).toEqual({ uci, legal: true });
                pos.play(move);
            }
            const lines = [
                ...(
                    await analyse(process.env.TACTICAL_JUDGEMENT_ENGINE!, makeFen(pos.toSetup()))
                ).values(),
            ];
            const classification = classifyPositionTacticalMotifs({
                fen,
                pvUci: [...prefix, ...lines[0].pvUci],
            });
            report.push({ fen, prefix, lines, classification });
        }
        writeFileSync(
            process.env.TACTICAL_PIN_PREPARATION_REPORT!,
            JSON.stringify(report, null, 2),
        );
        for (const entry of report)
            expect(entry.classification.motifs[0]).toMatchObject({ id: "clearance", ply: 1 });
    },
    180000,
);

test.skipIf(!process.env.TACTICAL_JUDGEMENT_ENGINE || !process.env.TACTICAL_CHECKING_MATE_REPORT)(
    "check a real mating drive against its omitted replies and a queen-capturing control",
    async () => {
        const fen = "5r2/bpp2q1k/p2pR1p1/3P4/1PP3QP/P7/1B4P1/7K b - - 3 32";
        const source = ["f7f1", "h1h2", "f1g1", "h2h3", "g1h1", "h3g3", "a7f2"];
        const inputs = [
            { fen, prefix: [] as string[], root: "f7f1" },
            { fen, prefix: ["f7f1", "h1h2", "f1g1", "h2g3"], root: undefined },
            { fen: fen.replace("7K", "2R4K"), prefix: [] as string[], root: "f7f1" },
        ];
        const report = [];
        for (const item of inputs) {
            const pos = Chess.fromSetup(parseFen(item.fen).unwrap()).unwrap();
            for (const uci of item.prefix) {
                const move = parseUci(uci)!;
                expect(pos.isLegal(move)).toBe(true);
                pos.play(move);
            }
            const lines = [
                ...(
                    await analyse(
                        process.env.TACTICAL_JUDGEMENT_ENGINE!,
                        makeFen(pos.toSetup()),
                        item.root,
                    )
                ).values(),
            ];
            const started = performance.now();
            const classification = classifyPositionTacticalMotifs({
                fen: item.fen,
                pvUci: [...item.prefix, ...lines[0].pvUci],
            });
            const sourceClassification = classifyPositionTacticalMotifs({
                fen: item.fen,
                pvUci: source,
            });
            report.push({
                ...item,
                lines,
                classification,
                sourceClassification,
                classificationMs: performance.now() - started,
            });
        }
        writeFileSync(process.env.TACTICAL_CHECKING_MATE_REPORT!, JSON.stringify(report, null, 2));
        expect(report[0].lines[0].mate).toBe(4);
        expect(report[0].classification.motifs[0]).toMatchObject({ id: "mateIn4", ply: 1 });
        expect(report[1].classification.motifs[0]).toMatchObject({ id: "mateIn4", ply: 1 });
        // The omitted Rxf1 defence actually reverses the mating attack.
        expect(report[2].lines[0].mate).toBeLessThan(0);
        expect(report[2].sourceClassification.motifs.filter((m) => /mate/i.test(m.id))).toEqual([]);
    },
    180000,
);

test.skipIf(
    !process.env.TACTICAL_JUDGEMENT_ENGINE || !process.env.TACTICAL_FORK_PREPARATION_REPORT,
)(
    "inspect real fork preparations and their defensive alternatives",
    async () => {
        const inputs = [
            {
                id: "fJrhT",
                fen: "8/7R/5kp1/2R2p2/5n2/7P/1r6/5K2 b - - 1 45",
                roots: ["b2b1", "f4d3"],
                prefixes: [["b2b1", "c5c1"]],
            },
            {
                id: "NGZzo",
                fen: "r5k1/5p2/Br2p1p1/1PNpPb1q/3P4/4P1Q1/5K1P/6R1 w - - 0 33",
                roots: ["c5d7"],
                prefixes: [["c5d7", "b6b7"]],
            },
            {
                id: "opGD7",
                fen: "7k/1ppQ3p/p2b2p1/3p4/8/2P2q1P/PP2R3/3K4 b - - 3 40",
                roots: ["f3f1"],
                prefixes: [
                    ["f3f1", "d1c2"],
                    ["f3f1", "e2e1"],
                ],
            },
        ];
        const report = [];
        for (const item of inputs) {
            for (const { root, prefix } of [
                ...item.roots.map((root) => ({ root, prefix: [] as string[] })),
                ...item.prefixes.map((prefix) => ({ root: undefined, prefix })),
            ]) {
                const pos = Chess.fromSetup(parseFen(item.fen).unwrap()).unwrap();
                for (const uci of prefix) {
                    const move = parseUci(uci)!;
                    expect(pos.isLegal(move)).toBe(true);
                    pos.play(move);
                }
                const lines = [
                    ...(
                        await analyse(
                            process.env.TACTICAL_JUDGEMENT_ENGINE!,
                            makeFen(pos.toSetup()),
                            root,
                        )
                    ).values(),
                ];
                const classification = classifyPositionTacticalMotifs({
                    fen: item.fen,
                    pvUci: [...prefix, ...lines[0].pvUci],
                });
                report.push({
                    id: item.id,
                    fen: item.fen,
                    root,
                    prefix,
                    lines,
                    classification,
                    doubleThreatProof:
                        item.id === "NGZzo"
                            ? proveQuietDoubleThreat(replayTacticalLine(item.fen, ["c5d7"])[0])
                            : undefined,
                    checkingAttackProof:
                        item.id === "opGD7"
                            ? proveCheckingMaterialAttack(
                                  replayTacticalLine(item.fen, [...prefix, ...lines[0].pvUci]),
                              )
                            : undefined,
                });
            }
        }
        writeFileSync(
            process.env.TACTICAL_FORK_PREPARATION_REPORT!,
            JSON.stringify(report, null, 2),
        );
        const checking = report.find((item) => item.id === "fJrhT" && item.root === "b2b1")!;
        const immediate = report.find((item) => item.id === "fJrhT" && item.root === "f4d3")!;
        expect(checking.lines[0].cp!).toBeGreaterThan(immediate.lines[0].cp! + 300);
        expect(checking.classification.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
        expect(
            report.find((item) => item.id === "fJrhT" && item.prefix.length)?.classification
                .motifs[0],
        ).toMatchObject({ id: "forkPreparation", ply: 1 });
        for (const item of report.filter((item) => item.id === "NGZzo"))
            expect(item.classification.motifs[0]).toMatchObject({ id: "doubleThreat", ply: 1 });
        for (const item of report.filter((item) => item.id === "opGD7"))
            expect(item.classification.motifs[0]).toMatchObject({ id: "forcingAttack", ply: 1 });
    },
    180000,
);

test.skipIf(!process.env.TACTICAL_JUDGEMENT_ENGINE || !process.env.TACTICAL_FORK_SEVERITY_REPORT)(
    "compare defended and undefended fork payoffs with fresh engine replies",
    async () => {
        const fen = "3qk2r/p1ppppb1/8/4N3/2B5/8/5PPP/6RK b k - 0 1";
        const engine = process.env.TACTICAL_JUDGEMENT_ENGINE!;
        const report = [];
        for (const move of ["a7a6", "g7h6", "e8g8", "g7f8"]) {
            const root = [...(await analyse(engine, fen, move)).values()];
            const step = replayTacticalLine(fen, [move])[0];
            const replies = [...(await analyse(engine, makeFen(step.after.toSetup()))).values()];
            report.push({ move, san: step.san, root, replies });
        }
        const kept = report[0],
            moved = report[1];
        const classification = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: kept.move,
            playedMoveUci: moved.move,
            pvUci: [kept.move, ...kept.replies[0].pvUci],
            refutationUci: moved.replies[0].pvUci,
        });
        writeFileSync(
            process.env.TACTICAL_FORK_SEVERITY_REPORT!,
            JSON.stringify(
                {
                    scope: "Constructed legal f7 comparison, not a claim a6 is globally best. O-O is searched separately as the complete defence. Fresh depth-16 roots and replies are independent of the hand-written witness.",
                    fen,
                    report,
                    classification,
                    explanation: buildMistakeReviewTacticalExplanation(classification),
                },
                null,
                2,
            ),
        );
        expect(report).toHaveLength(4);
        expect(kept.root[0].cp!).toBeGreaterThan(moved.root[0].cp!);
        expect(classification.allowedMotifs[0]).toMatchObject({
            id: "fork",
            comparison: "reduced",
        });
        const mate = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: "a7a6",
            playedMoveUci: "g7f8",
            pvUci: [kept.move, ...kept.replies[0].pvUci],
            refutationUci: report[3].replies[0].pvUci,
        });
        expect(mate.allowedMotifs[0]).toMatchObject({ id: "mateIn1", comparison: "prevented" });
    },
    180000,
);

async function analyse(engine: string, fen: string, searchMove?: string) {
    const child = spawn(engine, [], { windowsHide: true, stdio: "pipe" });
    const lines = new Map<
        number,
        {
            multipv: number;
            depth: number;
            pvUci: string[];
            pvSan: string[];
            cp: number | null;
            mate: number | null;
        }
    >();
    return new Promise<typeof lines>((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error("UCI judgement timed out"));
        }, 20000);
        let pending = "";
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.stdout.on("data", (chunk) => {
            pending += String(chunk);
            const rows = pending.split(/\r?\n/);
            pending = rows.pop() ?? "";
            for (const row of rows) {
                if (row === "uciok")
                    child.stdin.write(
                        "setoption name Threads value 1\nsetoption name Hash value 32\nsetoption name MultiPV value 3\nisready\n",
                    );
                if (row === "readyok")
                    child.stdin.write(
                        `position fen ${fen}\ngo depth 16${searchMove ? ` searchmoves ${searchMove}` : ""}\n`,
                    );
                const match = row.match(
                    /info depth (\d+).* multipv (\d+).* score (cp|mate) (-?\d+).* pv (.+)/,
                );
                if (match) {
                    const pvUci = match[5].trim().split(/\s+/);
                    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
                    const pvSan = pvUci.map((uci) => {
                        const move = parseUci(uci)!;
                        if (!pos.isLegal(move)) throw new Error(`Illegal PV ${uci}`);
                        const san = makeSan(pos, move);
                        pos.play(move);
                        return san;
                    });
                    lines.set(Number(match[2]), {
                        depth: Number(match[1]),
                        multipv: Number(match[2]),
                        pvUci,
                        pvSan,
                        cp: match[3] === "cp" ? Number(match[4]) : null,
                        mate: match[3] === "mate" ? Number(match[4]) : null,
                    });
                }
                if (row.startsWith("bestmove ")) {
                    child.stdin.end("quit\n");
                }
            }
        });
        child.on("exit", (code) => {
            clearTimeout(timer);
            if (code === 0 && lines.size) resolve(lines);
            else reject(new Error(`UCI exited ${code}`));
        });
        child.stdin.write("uci\n");
    });
}

describe("expert tactical judgement with fresh engine lines", () => {
    const engine = process.env.TACTICAL_JUDGEMENT_ENGINE ?? "";
    test.skipIf(!engine || !process.env.TACTICAL_ORDINARY_GAME_REPORT)(
        "audit an output-blind longitudinal sample of ordinary games",
        async () => {
            const fixture = JSON.parse(
                readFileSync(
                    "benchmarks/tactical-relevance/ordinary-games-development.json",
                    "utf8",
                ),
            ) as { games: { id: string; startFen: string; moves: string[] }[] };
            const report = [];
            const cache = new Map<string, Awaited<ReturnType<typeof analyse>>>();
            const search = async (fen: string) => {
                if (!cache.has(fen)) cache.set(fen, await analyse(engine, fen));
                return [...cache.get(fen)!.values()].sort((a, b) => a.multipv - b.multipv);
            };
            for (const game of fixture.games) {
                const steps = replayTacticalLine(game.startFen, game.moves);
                expect(steps).toHaveLength(game.moves.length);
                for (let index = 7; index < Math.min(60, steps.length); index += 5) {
                    const step = steps[index];
                    if (step.after.isEnd()) continue;
                    const beforeFen = makeFen(step.before.toSetup()),
                        fen = makeFen(step.after.toSetup());
                    const before = await search(beforeFen),
                        after = await search(fen);
                    const started = performance.now();
                    const scan = buildLiveTacticalScan({
                        fen,
                        ...after[0],
                        variations: after,
                        engineName: "Stockfish 18",
                        previousFen: beforeFen,
                        previousMoveUci: step.uci,
                    });
                    const scanMs = performance.now() - started;
                    const mistakeStarted = performance.now();
                    const score = (entry: (typeof before)[number]) =>
                        entry.cp ?? Math.sign(entry.mate ?? 0) * 10000;
                    const sign = step.before.turn === "white" ? 1 : -1;
                    const cpLoss = Math.max(0, score(before[0]) + score(after[0]));
                    const classification = classifyMistakeReviewMotifs({
                        fen: beforeFen,
                        playedMoveUci: step.uci,
                        bestMoveUci: before[0].pvUci[0],
                        pvUci: before[0].pvUci,
                        refutationUci: after[0].pvUci,
                        cpBefore: score(before[0]) * sign,
                        cpAfter: -score(after[0]) * sign,
                        cpLoss,
                    });
                    report.push({
                        id: `${game.id}:ply${index + 1}`,
                        ply: index + 1,
                        played: step.san,
                        history: steps.slice(0, index + 1).map((s) => s.san),
                        beforeFen,
                        fen,
                        before,
                        after,
                        cpLoss,
                        scan: {
                            motifs: scan.motifs,
                            labels: scan.labels,
                            variations: scan.variations,
                        },
                        classification,
                        explanation: buildMistakeReviewTacticalExplanation(classification),
                        scanMs,
                        mistakeMs: performance.now() - mistakeStarted,
                    });
                }
            }
            expect(report.length).toBeGreaterThan(10);
            // Keep the previously complete fixture available to regression
            // readers until the replacement audit has fully finished.
            writeFileSync(
                process.env.TACTICAL_ORDINARY_GAME_REPORT!,
                JSON.stringify(report, null, 2),
            );
        },
        240000,
    );
    test.skipIf(!engine || !process.env.TACTICAL_EXPANSION_ENGINE_REPORT)(
        "audit selected findings from the tag-blind expansion",
        async () => {
            const fixture = JSON.parse(
                readFileSync("benchmarks/tactical-relevance/expanded-development.json", "utf8"),
            ) as {
                cases: Array<{
                    id: string;
                    startFen: string;
                    bestLine: string[];
                    sourceGameUrl: string;
                }>;
            };
            const selected = [
                "GIB50",
                "vztmO",
                "wh6Ac",
                "fVRuW",
                "JaKHo",
                "ouIHI",
                "CSh8J",
                "eOCp9",
                "MJZcU",
                "Z5arb",
            ];
            const report = [];
            for (const id of selected) {
                const item = fixture.cases.find((item) => item.id === `lichess:${id}`)!;
                const unrestricted = [...(await analyse(engine, item.startFen)).values()];
                const candidate = [
                    ...(await analyse(engine, item.startFen, item.bestLine[0])).values(),
                ][0];
                const started = performance.now();
                const classification = classifyPositionTacticalMotifs({
                    fen: item.startFen,
                    ...candidate,
                    rootCp: candidate.cp,
                });
                report.push({
                    ...item,
                    unrestricted,
                    candidate,
                    classification,
                    classificationMs: performance.now() - started,
                });
            }
            writeFileSync(
                process.env.TACTICAL_EXPANSION_ENGINE_REPORT!,
                JSON.stringify(report, null, 2),
            );
            for (const id of ["GIB50", "vztmO", "wh6Ac"])
                expect(
                    report.find((item) => item.id === `lichess:${id}`)?.classification.motifs[0]
                        ?.id,
                ).toBe("mateIn1");
            expect(
                report.find((item) => item.id === "lichess:CSh8J")?.classification.motifs[0],
            ).toMatchObject({ id: "fork", ply: 1, value: 320 });
            expect(
                report
                    .find((item) => item.id === "lichess:JaKHo")
                    ?.classification.motifs.map((m) => m.id),
            ).not.toContain("intermezzo");
            // Other entries are diagnostic. Successful engine searches do not
            // imply correct or complete classification of those combinations.
        },
        180000,
    );
    test.skipIf(!engine || !existsSync(engine))(
        "judge trapped-piece lessons against defensive resources",
        async () => {
            const examples = [
                {
                    name: "Trapped rook behind the bishop",
                    fen: "4k2r/3nbppp/8/4p3/4P3/4Q3/PBq2PPP/RN2K2R b KQk - 0 17",
                    move: "c2b2",
                    expected: "trappedPiece",
                    why: "The extra rook win is more important than the initial bishop capture. Qc3 and Qd4 need explicit refutations, not an assertion that the rook cannot be defended.",
                },
                {
                    name: "Knight removed: rook has an escape",
                    fen: "4k2r/3nbppp/8/4p3/4P3/4Q3/PBq2PPP/R3K2R b KQk - 0 17",
                    move: "c2b2",
                    expected: "hangingPiece",
                    why: "Winning the bishop remains real, but an open first rank permits a safe rook move.",
                },
                {
                    name: "Immediate queen win outranks the additional rook",
                    fen: "4k2r/3nbppp/8/4p3/4P3/8/PQq2PPP/RN2K2R b KQk - 0 17",
                    move: "c2b2",
                    expected: "hangingPiece",
                    why: "The 900 cp queen capture is the primary lesson; the further trapped rook is secondary.",
                },
                {
                    name: "No bishop to punish the rook defender",
                    fen: "4k2r/3n1ppp/8/4p3/4P3/4Q3/PBq2PPP/RN2K2R b KQk - 0 17",
                    move: "c2b2",
                    expected: "hangingPiece",
                    why: "Qc3 defends Ra1 and no Bb4 pin is available. Do not invent a trap from the rook's lack of flight squares.",
                },
                {
                    name: "Actual Qc3 defence meets the pin",
                    fen: "4k2r/3nbppp/8/4p3/4P3/2Q5/Pq3PPP/RN2K2R b KQk - 1 18",
                    move: "e7b4",
                    expected: "pin",
                    why: "Bb4 pins the queen defending Ra1 to Ke1; every legal answer still concedes the queen or rook.",
                },
            ];
            const report = [];
            for (const item of examples) {
                const unrestricted = [...(await analyse(engine, item.fen)).values()];
                const candidate = [...(await analyse(engine, item.fen, item.move)).values()][0];
                const started = performance.now();
                const classification = classifyPositionTacticalMotifs({
                    fen: item.fen,
                    ...candidate,
                    rootCp: candidate.cp,
                });
                const classificationMs = performance.now() - started;
                const scan = buildLiveTacticalScan({
                    fen: item.fen,
                    ...unrestricted[0],
                    engineName: "Stockfish",
                    variations: unrestricted,
                });
                report.push({
                    ...item,
                    unrestricted,
                    candidate,
                    classification,
                    classificationMs,
                    positionHeadline: scan.motifs,
                    positionCandidates: scan.variations.map((v) => ({
                        moves: v.lineSan,
                        motifs: v.motifs,
                        timeline: v.timeline,
                    })),
                });
            }
            if (process.env.TACTICAL_TRAP_REPORT)
                writeFileSync(process.env.TACTICAL_TRAP_REPORT, JSON.stringify(report, null, 2));
            for (const item of report)
                expect({
                    name: item.name,
                    primary: item.classification.motifs[0]?.id ?? null,
                }).toEqual({ name: item.name, primary: item.expected });
        },
        180000,
    );
    test.skipIf(!engine || !existsSync(engine))(
        "audit real development puzzles with fresh engine choices",
        async () => {
            const fixture: {
                cases: Array<{
                    id: string;
                    startFen: string;
                    bestLine: string[];
                    sourceGameUrl: string;
                }>;
            } = JSON.parse(
                readFileSync("benchmarks/tactical-relevance/real-puzzle-development.json", "utf8"),
            );
            const report = [];
            for (const item of fixture.cases) {
                const unrestricted = [...(await analyse(engine, item.startFen)).values()];
                const candidate = [
                    ...(await analyse(engine, item.startFen, item.bestLine[0])).values(),
                ][0];
                const started = performance.now();
                const classification = classifyPositionTacticalMotifs({
                    fen: item.startFen,
                    ...candidate,
                    rootCp: candidate.cp,
                });
                const classificationMs = performance.now() - started;
                const scan = buildLiveTacticalScan({
                    fen: item.startFen,
                    ...unrestricted[0],
                    engineName: "Stockfish",
                    variations: unrestricted,
                });
                report.push({
                    ...item,
                    unrestricted,
                    candidate,
                    classification,
                    classificationMs,
                    positionHeadline: scan.motifs,
                    positionCandidates: scan.variations.map((v) => ({
                        moves: v.lineSan,
                        motifs: v.motifs,
                        timeline: v.timeline,
                    })),
                });
            }
            if (process.env.TACTICAL_REAL_ENGINE_REPORT)
                writeFileSync(
                    process.env.TACTICAL_REAL_ENGINE_REPORT,
                    JSON.stringify(report, null, 2),
                );
            expect(report).toHaveLength(12);
            // Only the adjudicated improvements are acceptance assertions.
            // Other entries retain explicit open findings in the fixture/report.
            for (const [id, primary] of [
                ["1DoTa", "fork"],
                ["1GRFo", "interference"],
                ["48ION", "interference"],
                ["6mAvx", "trappedPiece"],
                ["8mguL", "trappedPiece"],
                ["2QybO", "discoveredAttack"],
                ["2Gc77", "capturingDefender"],
                ["4RNK5", "tacticalPreparation"],
                ["2SvDe", "intermezzo"],
                ["9THyd", "intermezzo"],
            ]) {
                const item = report.find((entry) => entry.id === `lichess:${id}`)!;
                expect(item.positionHeadline[0]?.id).toBe(primary);
                expect(item.classification.motifs[0]?.id).toBe(primary);
            }
            for (const id of ["2SvDe", "8DHuj", "9THyd"]) {
                const item = report.find((entry) => entry.id === `lichess:${id}`)!;
                expect(item.positionHeadline.map((m) => m.id)).not.toContain("clearance");
                expect(item.classification.motifs.map((m) => m.id)).not.toContain("clearance");
            }
        },
        180000,
    );
    test.skipIf(!engine || !existsSync(engine))(
        "judge interference against captures and quiet escapes",
        async () => {
            const examples = [
                {
                    name: "Checking pawn blocks a real queen defender",
                    fen: "3k4/1r5q/3PP3/8/8/8/8/K6Q w - - 0 1",
                    expected: "interference",
                    primary: "interference",
                    why: "e7+ cuts Rb7-Qh7. King moves lose the queen; Rxe7 dxe7 Qxe7 still loses rook for two pawns. The d6 pawn makes taking the blocker costly. This is a drawing resource from a material deficit, not proof of a winning position.",
                },
                {
                    name: "Undefended blocker can simply be captured",
                    fen: "3k4/1r5q/4P3/8/8/8/8/K6Q w - - 0 1",
                    expected: null,
                    primary: null,
                    why: "A cooperative Kc8 Qxh7 line is misleading: Rxe7 safely removes the pawn and restores the queen's protection.",
                },
                {
                    name: "Quiet block permits the queen to escape",
                    fen: "2k5/1r5q/3PP3/8/8/8/8/K6Q w - - 0 1",
                    expected: null,
                    primary: "interference",
                    why: "e7 without check loses to Qg7+ and Qb2 mate. The different move d7+ is a genuine drawing interference: Rxd7 exd7+ wins rook for two pawns.",
                },
                {
                    name: "Pinned rook was not a legal queen defender",
                    fen: "1k6/1r5q/3PP3/8/8/8/8/KR5Q w - - 0 1",
                    expected: null,
                    primary: "pin",
                    why: "Rb7 is already pinned to Kb8 by Rb1. Cutting its horizontal ray does not cause the queen's vulnerability. Qxh7 exploits that pin; the queen's incidental defence of the rook is not the cause.",
                },
            ];
            const report = [];
            for (const item of examples) {
                const unrestricted = [...(await analyse(engine, item.fen)).values()];
                const candidate = [...(await analyse(engine, item.fen, "e6e7")).values()][0];
                const started = performance.now();
                const classification = classifyPositionTacticalMotifs({
                    fen: item.fen,
                    ...candidate,
                    rootCp: candidate.cp,
                });
                const classificationMs = performance.now() - started;
                const scan = buildLiveTacticalScan({
                    fen: item.fen,
                    ...unrestricted[0],
                    engineName: "Stockfish",
                    variations: unrestricted,
                });
                report.push({
                    ...item,
                    unrestricted,
                    candidate,
                    classification,
                    classificationMs,
                    positionHeadline: scan.motifs,
                    positionCandidates: scan.variations.map((v) => ({
                        moves: v.lineSan,
                        motifs: v.motifs,
                        timeline: v.timeline,
                    })),
                });
            }
            if (process.env.TACTICAL_INTERFERENCE_REPORT)
                writeFileSync(
                    process.env.TACTICAL_INTERFERENCE_REPORT,
                    JSON.stringify(report, null, 2),
                );
            for (const item of report) {
                expect({
                    name: item.name,
                    interference:
                        item.classification.motifs.find((m) => m.id === "interference")?.id ?? null,
                }).toEqual({ name: item.name, interference: item.expected });
                expect({ name: item.name, primary: item.positionHeadline[0]?.id ?? null }).toEqual({
                    name: item.name,
                    primary: item.primary,
                });
            }
        },
        180000,
    );
    test.skipIf(!engine || !existsSync(engine))(
        "judge discovered threats against engine-selected defences",
        async () => {
            const examples = [
                {
                    name: "Checking bishop uncovers a queen attack",
                    fen: "4q1k1/5ppp/8/8/4B3/8/5PPP/4R1K1 w - - 0 1",
                    move: "e4h7",
                    expected: "discoveredAttack",
                    positionPrimary: "discoveredAttack",
                    why: "Bxh7+ buys a tempo to expose Re1 against Qe8; even Kxh7 concedes more than the bishop.",
                },
                {
                    name: "Quiet version allows Qxe1 mate",
                    fen: "4q1k1/5ppp/8/8/4B3/8/5PPP/4R1K1 w - - 0 1",
                    move: "e4f3",
                    expected: null,
                    positionPrimary: "discoveredAttack",
                    why: "Vacating the file without check lets the queen capture the rook with mate; geometry alone is not a tactic.",
                },
                {
                    name: "Discovered check wins the queen",
                    fen: "5q1k/7p/8/4R3/8/8/1B3PPP/6K1 w - - 0 1",
                    move: "e5f5",
                    expected: "discoveredCheck",
                    positionPrimary: "discoveredCheck",
                    why: "Rf5 uncovers Bb2 against Kh8 and attacks Qf8; king moves and queen interpositions both concede material.",
                },
                {
                    name: "Forced interposition opens the rook-bishop battery",
                    fen: "5q1k/5p1p/8/4R3/8/8/1B3PPP/6K1 w - - 0 1",
                    move: "e5f5",
                    expected: "discoveredCheck",
                    positionPrimary: "discoveredCheck",
                    why: "The proposed negative control is actually winning: f6 Rxf6 Qxf6 Bxf6 exchanges rook for queen and pawn. The pawn's forced block is itself a tactical target.",
                },
                {
                    name: "Discovered check without a material target",
                    fen: "7k/7p/7r/4R3/8/8/1B3PPP/6K1 w - - 0 1",
                    move: "e5f5",
                    expected: null,
                    positionPrimary: "doubleCheck",
                    why: "Rf5 uncovers check, but neither piece attacks the rook on h6. A check alone is not a winning combination.",
                },
                {
                    name: "Double check delivers mate",
                    fen: "3rkr2/5p2/8/8/8/8/4B3/4R1K1 w - - 0 1",
                    move: "e2b5",
                    expected: "doubleCheck",
                    positionPrimary: "doubleCheck",
                    why: "Bb5 uncovers Re1 and itself checks along b5-e8; no king escape exists.",
                },
            ];
            const report = [];
            for (const item of examples) {
                const unrestricted = [...(await analyse(engine, item.fen)).values()];
                const candidate = [...(await analyse(engine, item.fen, item.move)).values()][0];
                const start = performance.now();
                const classification = classifyPositionTacticalMotifs({
                    fen: item.fen,
                    ...candidate,
                    rootCp: candidate.cp,
                });
                const classificationMs = performance.now() - start;
                const scan = buildLiveTacticalScan({
                    fen: item.fen,
                    ...unrestricted[0],
                    engineName: "Stockfish",
                    variations: unrestricted,
                });
                report.push({
                    ...item,
                    unrestricted,
                    candidate,
                    classification,
                    classificationMs,
                    positionHeadline: scan.motifs,
                    positionCandidates: scan.variations.map((v) => ({
                        moves: v.lineSan,
                        motifs: v.motifs,
                        timeline: v.timeline,
                    })),
                });
            }
            if (process.env.TACTICAL_DISCOVERED_REPORT)
                writeFileSync(
                    process.env.TACTICAL_DISCOVERED_REPORT,
                    JSON.stringify(report, null, 2),
                );
            for (const item of report) {
                expect({
                    name: item.name,
                    primary: item.classification.motifs[0]?.id ?? null,
                }).toEqual({ name: item.name, primary: item.expected });
                expect({
                    name: item.name,
                    headline: item.positionHeadline.map((m) => m.id),
                }).toEqual({ name: item.name, headline: [item.positionPrimary] });
            }
        },
        180000,
    );
    test.skipIf(!engine || !existsSync(engine))(
        "judge material mechanisms against engine defences",
        async () => {
            const examples = [
                {
                    name: "Draw the rook away from its queen",
                    fen: "3r2k1/p4ppp/1p6/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24",
                    move: "e4e8",
                    expected: "deflection",
                },
                {
                    name: "King escape declines the deflection bait",
                    fen: "3r2k1/p4pp1/1p5p/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24",
                    move: "e4e8",
                    expected: null,
                },
                {
                    name: "The alleged deflected defender was already pinned",
                    fen: "R2r2k1/p4ppp/1p6/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24",
                    move: "e4e8",
                    expected: "mateIn2",
                },
                {
                    name: "Exploit an absolute pin",
                    fen: "4k3/4n3/8/3P4/2B5/8/8/4R1K1 w - - 0 1",
                    move: "d5d6",
                    expected: "pin",
                },
                {
                    name: "Rook captures the pinning attacker's pawn",
                    fen: "4k3/4n3/r7/3P4/2B5/8/8/4R1K1 w - - 0 1",
                    move: "d5d6",
                    expected: null,
                },
                {
                    name: "King-queen skewer",
                    fen: "8/7q/8/5k2/2B5/8/8/6K1 w - - 0 1",
                    move: "c4d3",
                    expected: "skewer",
                },
                {
                    name: "Pawn interposes against the skewer",
                    fen: "8/7q/8/4pk2/2B5/8/8/6K1 w - - 0 1",
                    move: "c4d3",
                    expected: null,
                },
                {
                    name: "Remove the queen's defender with check",
                    fen: "8/6k1/5n2/3qP1P1/8/8/8/3R2K1 w - - 0 1",
                    move: "e5f6",
                    expected: "capturingDefender",
                },
            ];
            const report = [];
            for (const item of examples) {
                const unrestricted = [...(await analyse(engine, item.fen)).values()];
                const candidate = [...(await analyse(engine, item.fen, item.move)).values()][0];
                const start = performance.now();
                const classification = classifyPositionTacticalMotifs({
                    fen: item.fen,
                    ...candidate,
                });
                report.push({
                    ...item,
                    unrestricted,
                    candidate,
                    classification,
                    classificationMs: performance.now() - start,
                });
                expect(classification.motifs[0]?.id ?? null).toBe(item.expected);
                for (const motif of classification.motifs.filter(
                    (m) => m.id === "promotion" || m.id === "underPromotion",
                )) {
                    expect(motif.moveUci).toMatch(/[qrbn]$/);
                }
            }
            if (process.env.TACTICAL_MATERIAL_REPORT)
                writeFileSync(
                    process.env.TACTICAL_MATERIAL_REPORT,
                    JSON.stringify(report, null, 2),
                );
        },
        180000,
    );
    test.skipIf(!engine || !existsSync(engine))(
        "inspect quiet mating preparations",
        async () => {
            const report = [];
            const examples = [
                {
                    fen: "7k/7p/5KR1/7Q/8/8/8/8 w - - 0 1",
                    primary: "mateThreat",
                    why: "The quiet queen move forces mate next turn against either pawn push; do not reject it for lacking a check or capture.",
                },
                {
                    fen: "7k/7p/5Kp1/7Q/8/8/8/8 w - - 0 1",
                    primary: "mateIn3",
                    why: "The selected quiet queen move forces mate within three, with Kxg6 needed against the longest defence. The local tree, not the single mating PV, establishes this.",
                },
            ];
            for (const item of examples) {
                const { fen } = item;
                const lines = [...(await analyse(engine, fen)).values()].sort(
                    (a, b) => a.multipv - b.multipv,
                );
                const start = performance.now();
                const scan = buildLiveTacticalScan({
                    fen,
                    ...lines[0],
                    engineName: "Stockfish",
                    variations: lines,
                });
                report.push({
                    ...item,
                    lines,
                    headline: scan.motifs,
                    timeline: scan.variations.map((v) => ({
                        moves: v.lineSan,
                        motifs: v.timeline,
                    })),
                    classificationMs: performance.now() - start,
                });
                expect(scan.motifs.map((m) => m.id)).toEqual([item.primary]);
            }
            const fen = examples[1].fen;
            const forced = [...(await analyse(engine, fen, "h5h6")).values()];
            report.push({
                fen,
                why: "Candidate-search limitation: unrestricted depth-16 MultiPV omitted the faster Qh6 mate. A separately restricted search confirms it; this is not classifier evidence that the other mates fail.",
                forced,
            });
            expect(forced[0].mate).toBe(2);
            expect(
                buildLiveTacticalScan({ fen, ...forced[0], engineName: "Stockfish" }).motifs[0].id,
            ).toBe("mateThreat");
            if (process.env.TACTICAL_QUIET_REPORT)
                writeFileSync(process.env.TACTICAL_QUIET_REPORT, JSON.stringify(report, null, 2));
        },
        60000,
    );
    test.skipIf(!engine || !existsSync(engine))(
        "inspect primary causes and quiet controls",
        async () => {
            const report = [];
            const expected = [
                [],
                [],
                [],
                ["hangingPiece"],
                ["fork"],
                ["backRankMate"],
                ["deflection"],
                ["mateIn2"],
                [],
            ];
            for (const item of cases) {
                const lines = [...(await analyse(engine, item.fen)).values()].sort(
                    (a, b) => a.multipv - b.multipv,
                );
                const start = performance.now();
                const scan = buildLiveTacticalScan({
                    fen: item.fen,
                    ...lines[0],
                    engineName: "Stockfish",
                    variations: lines,
                });
                const classificationMs = performance.now() - start;
                report.push({
                    position: item.name,
                    fen: item.fen,
                    judgement: item.why,
                    expected: expected[report.length],
                    classificationMs,
                    headline: scan.motifs.map((m) => `${m.id}@${m.ply}`),
                    candidates: lines,
                    lines: scan.variations.map((v) => ({
                        multipv: v.multipv,
                        moves: v.lineSan.join(" "),
                        motifs: v.motifs.map((m) => `${m.id}@${m.ply}`),
                        timeline: v.timeline.map((m) => `${m.actor}:${m.id}@${m.ply}`),
                    })),
                });
                expect({ position: item.name, motifs: scan.motifs.map((m) => m.id) }).toEqual({
                    position: item.name,
                    motifs: expected[report.length - 1],
                });
            }
            if (process.env.TACTICAL_JUDGEMENT_REPORT)
                writeFileSync(
                    process.env.TACTICAL_JUDGEMENT_REPORT,
                    JSON.stringify(report, null, 2),
                );
            const f7 = report.find((entry) => entry.position === "Protected f7 fork")!;
            expect(f7.lines.find((entry) => entry.moves.startsWith("Nxf7 "))?.timeline).toEqual([
                "white:fork@1",
                "white:attackingF2F7@1",
                "white:hangingPiece@3",
                "black:hangingPiece@4",
            ]);
            expect(f7.lines.find((entry) => entry.moves.startsWith("Bxf7+ "))?.timeline).toEqual([
                "white:attackingF2F7@1",
            ]);
            console.log(JSON.stringify(report));
        },
        180000,
    );

    test.skipIf(!engine || !existsSync(engine))(
        "judge actual before/after mistake causes",
        async () => {
            const examples = [
                {
                    name: "The real Kf1 best defence does not cause the existing mate",
                    fen: "4r3/pp3k1p/2n3p1/5n2/N4P2/8/PP2rKPP/R6R w - - 1 27",
                    played: "f2f1",
                    source: "allowed",
                    primary: "mateIn3",
                    comparison: "persists",
                    why: "The engine's best move is the played Kf1. Its before and after searches choose different mating replies, but both reach the same position. Retain Ncd4's forced mate as existing danger, not an accusation against the best defence.",
                },
                {
                    name: "The real Bh3 mistake misses Qxc6+'s mate, not just the knight",
                    fen: "r1q1kb1r/p1p2ppp/1pnpp3/6B1/Q2P2nP/2N2NP1/PPP1PP2/2KR1B1R w kq - 3 12",
                    played: "f1h3",
                    source: "missed",
                    primary: "mateIn3",
                    why: "Qxc6+ starts a verified forced mate in three. The loose knight is a smaller immediate gain, not the primary missed outcome and not a capture worth the mate score.",
                },
                {
                    name: "Pushed too early instead of removing the promotion-path defender (MJZcU)",
                    fen: "3R4/5k2/6p1/p7/3pNr2/2p2P1P/P5PK/8 b - - 3 41",
                    played: "c3c2",
                    source: "missed",
                    primary: "promotionCombination",
                    why: "Rxe4 removes the knight controlling d2. After fxe4 the connected passed pawns overcome the rook, including its checking defences. Pushing c2 first allows the rook and knight to stop the pawns. This is a counterfactual candidate move in a real puzzle position, not a claim about the source game's played move.",
                },
                {
                    name: "Left the queen behind the discovered checking capture",
                    fen: "4q1k1/p4ppp/8/8/4B3/8/5PPP/4R1K1 b - - 0 1",
                    played: "a7a6",
                    source: "allowed",
                    primary: "discoveredAttack",
                    why: "Bxh7+ opens the e-file against the queen. The comparison should explain how the engine's better defensive move changes that battery or its target.",
                },
                {
                    name: "A different reply wins the same queen after the better move",
                    fen: "5q1k/7p/8/4R3/8/8/1B3PPP/6K1 b - - 0 1",
                    played: "h7h6",
                    source: "allowed",
                    primary: "pin",
                    comparison: "persists",
                    why: "h6 permits Re8+ and a pin of Qf8. But even best Kg7 permits Rf5+ and a discovered check winning that same queen for a rook. The queen loss is existing danger, not an explanation of the small score difference.",
                },
                {
                    name: "Ignored double-check mate instead of making a king escape",
                    fen: "3rkr2/5p2/p7/8/8/8/4B3/4R1K1 b - - 0 1",
                    played: "a6a5",
                    source: "allowed",
                    primary: "doubleCheck",
                    why: "Bb5# checks with both bishop and rook. Moving a back-rank rook may supply an escape; a double-check mechanism must receive the same causal mate comparison as a named mate pattern.",
                },
                {
                    name: "Failed to unpin the knight",
                    fen: "4k2r/4n2p/8/3P4/8/8/8/4R1K1 b k - 0 1",
                    played: "h7h6",
                    source: "allowed",
                    primary: "pin",
                    why: "A king move can unpin the knight while retaining its defence. h6 leaves d6 available; the comparison must find the best move's actual defensive resource.",
                },
                {
                    name: "Allowed a king-queen skewer instead of preserving the queen",
                    fen: "8/p6q/8/5k2/2B5/8/8/6K1 b - - 0 1",
                    played: "a7a6",
                    source: "allowed",
                    primary: "skewer",
                    why: "The irrelevant pawn move allows Bd3+ and Bxh7. The better move should remove the skewer or use a forcing check; a discovered forced mate could instead be the primary missed lesson.",
                },
                {
                    name: "Allowed checking defender removal and lost the queen",
                    fen: "8/p5k1/5n2/3qP1P1/8/8/8/3R2K1 b - - 0 1",
                    played: "a7a6",
                    source: "allowed",
                    primary: "capturingDefender",
                    why: "exf6+ removes the knight defending the queen, then Rxd5 wins it. The large allowed loss should outrank a smaller missed capture when that is the engine's better option.",
                },
                {
                    name: "Missed quiet mate while leaving the queen attacked",
                    fen: "7k/7p/5Kp1/7Q/8/8/8/8 w - - 0 1",
                    played: "f6e5",
                    source: "missed",
                    primary: "mateIn3",
                    why: "Ke5 leaves the queen en prise, but the most valuable missed opportunity is the quiet forced mating preparation selected by the engine. Its all-defences proof is stronger evidence than the single PV's final mate tag.",
                },
                {
                    name: "Missed the quiet rook preparation for mate or a queen skewer",
                    fen: "8/4k3/7R/p3p2R/8/P6p/KP6/4q3 w - - 2 49",
                    played: "h5h3",
                    source: "missed",
                    primary: "tacticalPreparation",
                    why: "Rb6 threatens Rh7+ and a mating or queen-winning continuation. Black can change the route, so the headline must describe a verified threat rather than a globally forced skewer. Rxh3 misses that stronger preparation.",
                },
                {
                    name: "Recaptured the rook before taking the queen with check",
                    fen: "2k1r2R/ppp5/4p3/5nb1/3Pb3/2P5/PP1QNP2/2KR4 b - - 0 24",
                    played: "e8h8",
                    source: "missed",
                    primary: "intermezzo",
                    why: "Bxd2+ wins the queen with tempo and retains Rxh8. Recapturing the rook first lets the queen escape or take the bishop; move order explains the missed extra gain.",
                },
                {
                    name: "Recaptured the bishop before taking the knight with check",
                    fen: "1r1q1rk1/R3nppp/3pb3/1p1Np3/4P2P/2P1b3/1P3PP1/3QKB1R w K - 0 18",
                    played: "f2e3",
                    source: "missed",
                    primary: "intermezzo",
                    why: "Nxe7+ wins an extra knight before fxe3. Qxe7 is met by Rxe7, so recapturing the checker does not refute the lesson.",
                },
                {
                    name: "Allowed a checking queen capture before the rook recapture",
                    fen: "2k1r2r/ppp5/4p3/5nb1/3Pb3/2P5/PP1QNP1R/2KR4 w - - 0 24",
                    played: "h2h8",
                    source: "allowed",
                    primary: "intermezzo",
                    why: "Rxh8 assumes an immediate rook recapture, but Black inserts Bxd2+ and then recaptures. The checking move order is the main tactical cause of this mistake.",
                },
                {
                    name: "Allowed an intermediate knight capture before the bishop recapture",
                    fen: "1r1q1rk1/R3nppp/3pb3/1p1Np1b1/4P2P/2P1N3/1P3PP1/3QKB1R b K - 0 17",
                    played: "g5e3",
                    source: "allowed",
                    primary: "intermezzo",
                    why: "Bxe3 invites fxe3, but White can insert Nxe7+ first. The checking capture and retained bishop capture explain the tactical damage.",
                },
                {
                    name: "b6 permits the f7 fork",
                    fen: "rnbqk2r/ppppbppp/5n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R b KQkq - 0 4",
                    played: "b7b6",
                    source: "allowed",
                    primary: "fork",
                    why: "Black should deal with f7; the quiet b6 move permits a protected queen-rook fork.",
                },
                {
                    name: "The real Ke8 mistake allows a mating attack with quiet preparation",
                    fen: "rnbq1bnr/pppp1k1p/5Pp1/3Q4/8/2N5/PP3PPP/R1B1KBNR b KQ - 1 9",
                    played: "f7e8",
                    source: "allowed",
                    primary: "mateIn7",
                    why: "f7+ starts a forced mating attack, including promotion and Bc4 development. The smaller checking-fork preparation is not the main consequence of Ke8; Kxf6 removes the checking pawn.",
                },
                {
                    name: "The real Rc5 mistake permits a checking fork preparation",
                    fen: "8/7R/5kp1/4Rp2/5n2/7P/1r6/5K2 w - - 0 45",
                    played: "e5c5",
                    source: "allowed",
                    primary: "forkPreparation",
                    why: "Rb1+ forces Kf2 into Nd3+'s fork or wins the interposing rook after Rc1. Re1 would instead be a protected block when the rook stays on e5.",
                },
                {
                    name: "The real g6 mistake permits Nd7's double threat",
                    fen: "r5k1/5pp1/Br2p3/1PNpPb1q/3P4/4P1Q1/5K1P/6R1 b - - 6 32",
                    played: "g7g6",
                    source: "allowed",
                    primary: "doubleThreat",
                    why: "Nd7 attacks Rb6 and threatens Nf6+ against king and queen. Different defences allow different material wins; the root move is not itself a fork.",
                },
                {
                    name: "The real Re2 mistake allows a forcing checking attack",
                    fen: "7k/1ppQ3p/p2b2p1/3p4/8/2P2q1P/PP6/3KR3 w - - 2 40",
                    played: "e1e2",
                    source: "allowed",
                    primary: "forcingAttack",
                    why: "Qf1+ forces a material win after Kd2, while Kc2 and Re1 allow mating continuations. The pin later in one branch cannot explain every defensive choice.",
                },
                {
                    name: "Be7 hangs the bishop while also missing the checking attack",
                    fen: "7k/1ppQ3p/p2b2p1/3p4/8/2P2q1P/PP2R3/3K4 b - - 3 40",
                    played: "d6e7",
                    source: "allowed",
                    primary: "hangingPiece",
                    why: "Be7 simply hangs the bishop to Qxe7. That immediate concrete loss deserves the headline; the missed Qf1+ attack remains independently classified, not discarded.",
                    missed: "forcingAttack",
                },
                {
                    name: "An irrelevant pawn move misses the forcing checking attack",
                    fen: "7k/1ppQ3p/p2b2p1/3p4/8/2P2q1P/PP2R3/3K4 b - - 3 40",
                    played: "a6a5",
                    source: "missed",
                    primary: "forcingAttack",
                    why: "Qf1+ starts the forcing attack while a5 lets White neutralize it with Qg4; unlike Be7, a5 does not simply hang a bishop.",
                },
                {
                    name: "A quiet king move misses Nd7's double threat",
                    fen: "r5k1/5p2/Br2p1p1/1PNpPb1q/3P4/4P1Q1/5K1P/6R1 w - - 0 33",
                    played: "f2e1",
                    source: "missed",
                    primary: "doubleThreat",
                    why: "White can win material with Nd7's rook attack and separate checking-fork threat. Ke1 instead gives Black time to resolve the danger.",
                },
                {
                    name: "Playing Nd3 too early misses the checking preparation",
                    fen: "8/7R/5kp1/2R2p2/5n2/7P/1r6/5K2 b - - 1 45",
                    played: "f4d3",
                    source: "missed",
                    primary: "forkPreparation",
                    why: "Rb1+ must first drive the king onto a checking-fork square. Immediate Nd3 permits Rc4 and only draws in the fresh engine search.",
                },
                {
                    name: "Retreating the bishop misses the checking clearance",
                    fen: "2rr2k1/1p3pp1/4p3/p2pP1N1/1n1q4/1Q1B4/1P3P1P/5RK1 w - - 0 22",
                    played: "d3b1",
                    source: "missed",
                    primary: "clearance",
                    why: "Bh7+ clears the queen's third-rank route with tempo; Kf8 permits Qf3's pin, while Kh8 permits Qh3's forcing attack. Bb1 gives Black time for a checking queen move.",
                },
                {
                    name: "The real Qxd4 mistake allows the checking clearance",
                    fen: "2rr2k1/1p3pp1/1q2p3/p2pP1N1/1n1P4/1Q1B4/1P3P1P/5RK1 b - - 0 21",
                    played: "b6d4",
                    source: "allowed",
                    primary: "clearance",
                    why: "Taking on d4 places the queen on the future fork square and allows Bh7+ followed by the cleared queen route. The two king replies have different forcing continuations.",
                },
                {
                    name: "Developing the bishop misses the overloaded-queen discovery",
                    fen: "2kr1br1/pp1n1p2/2p2p1p/q6b/2BNN3/P2Q3P/1PP2PP1/R3R1K1 b - - 0 15",
                    played: "f8e7",
                    source: "missed",
                    primary: "discoveredAttack",
                    why: "Ne5 opens Rd8 against Nd4 and overloads Qd3's defence of the two minor pieces. Be7 misses the combination.",
                },
                {
                    name: "The real Nxd4 mistake allows the overloaded-queen discovery",
                    fen: "2kr1br1/pp1n1p2/2p2p1p/q6b/2BpN3/P2Q1N1P/1PP2PP1/R3R1K1 w - - 0 15",
                    played: "f3d4",
                    source: "allowed",
                    primary: "discoveredAttack",
                    why: "Nxd4 places a knight on the rook's blocked file; Ne5 reveals that attack while attacking the queen and bishop, and Qc3 is met by Qxc3.",
                },
                {
                    name: "Taking a pawn misses the promotion-backed knight fork",
                    fen: "8/2P5/1n3k2/p7/P7/4NKp1/8/8 w - - 5 65",
                    played: "f3g3",
                    source: "missed",
                    primary: "fork",
                    why: "Nd5+ wins Nb6 after a king move or promotes after Nxd5. Kxg3 takes only a pawn and lets the knight blockade c8.",
                },
                {
                    name: "Moving onto f6 allows the promotion-backed fork",
                    fen: "8/2P5/1n4k1/p7/P7/4NKp1/8/8 b - - 4 64",
                    played: "g6f6",
                    source: "allowed",
                    primary: "fork",
                    why: "Kf6 steps onto Nd5+'s king/knight fork. The knight cannot take on d5 without abandoning c8 and allowing promotion.",
                },
                {
                    name: "Missed queen while the knight is already attacked",
                    fen: "6k1/8/7p/6N1/4q3/3P4/8/K7 w - - 0 1",
                    played: "a1b1",
                    source: "missed",
                    primary: "hangingPiece",
                    why: "Nxe4 both wins the queen and saves the attacked knight. Kb1 misses that immediate gain; the later checks and pawn promotion in the refutation should not replace this simple lesson.",
                },
                {
                    name: "Failed to create a back-rank escape",
                    fen: "6k1/1p3ppp/8/8/8/8/5PPP/4R1K1 b - - 0 1",
                    played: "b7b6",
                    source: "allowed",
                    primary: "backRankMate",
                    why: "A king-side pawn move gives the king an escape from Re8+; b6 allows Re8#. The game is already materially lost, so the lesson is preventing immediate mate.",
                },
            ];
            const report = [];
            for (const example of examples) {
                const before = [...(await analyse(engine, example.fen)).values()].sort(
                    (a, b) => a.multipv - b.multipv,
                );
                const pos = Chess.fromSetup(parseFen(example.fen).unwrap()).unwrap();
                const played = parseUci(example.played)!;
                expect(pos.isLegal(played)).toBe(true);
                const rootSign = pos.turn === "white" ? 1 : -1;
                pos.play(played);
                const after = [...(await analyse(engine, makeFen(pos.toSetup()))).values()].sort(
                    (a, b) => a.multipv - b.multipv,
                );
                const best = before[0],
                    refutation = after[0];
                const beforeScore = best.cp ?? Math.sign(best.mate ?? 0) * 10000;
                const afterScore = refutation.cp ?? Math.sign(refutation.mate ?? 0) * 10000;
                const start = performance.now();
                const classification = classifyMistakeReviewMotifs({
                    fen: example.fen,
                    bestMoveUci: best.pvUci[0],
                    playedMoveUci: example.played,
                    pvUci: best.pvUci,
                    pvSan: best.pvSan,
                    refutationUci: refutation.pvUci,
                    refutationSan: refutation.pvSan,
                    cpBefore: beforeScore * rootSign,
                    cpAfter: -afterScore * rootSign,
                    cpLoss: Math.max(0, beforeScore + afterScore),
                });
                const explanation = buildMistakeReviewTacticalExplanation(classification);
                report.push({
                    ...example,
                    before,
                    after,
                    classification,
                    explanation,
                    classificationMs: performance.now() - start,
                });
                if (process.env.TACTICAL_CAUSAL_REPORT)
                    writeFileSync(
                        process.env.TACTICAL_CAUSAL_REPORT,
                        JSON.stringify(report, null, 2),
                    );
            }
            for (const item of report) {
                expect({
                    primary: item.explanation?.primary.id,
                    source: item.explanation?.source,
                }).toEqual({
                    primary: item.primary,
                    source: item.source,
                });
            }
            for (const item of report.filter((entry) => "comparison" in entry))
                expect(item.explanation?.primary.comparison).toBe(item.comparison);
            for (const item of report.filter((entry) => "missed" in entry))
                expect(item.classification.missedMotifs[0]?.id).toBe(item.missed);
        },
        180000,
    );
});
