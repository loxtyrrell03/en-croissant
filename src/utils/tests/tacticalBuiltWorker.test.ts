import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test, vi } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    buildLiveTacticalScan,
    type LiveTacticalScanInput,
    type LiveTacticalVariationInput,
} from "../tacticalMotifs/liveTactics";
import {
    TACTICAL_CLASSIFICATION_TIMEOUT_MS,
    TACTICAL_WORKER_STARTUP_TIMEOUT_MS,
    classifyLiveTacticsInWorker,
    type TacticalWorkerMessage,
} from "../tacticalMotifs/liveTacticsWorker";

/** Execute the actual Vite artifact with only a browser message bridge. No DOM,
 * Tauri, localStorage or source transpiler is supplied to the worker. */
async function runBuiltWorker(path: string, input: LiveTacticalScanInput) {
    const start = performance.now();
    const bridges: BrowserWorker[] = [];
    class BrowserWorker {
        startedAt: number | null = null;
        termination?: Promise<number>;
        onmessage: ((event: { data: TacticalWorkerMessage }) => void) | null = null;
        onerror: ((event: { message: string }) => void) | null = null;
        onmessageerror: (() => void) | null = null;
        thread = new NodeWorker(
            `
    const { parentPort } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = data => parentPort.postMessage(data);
    import(${JSON.stringify(pathToFileURL(resolve(path)).href)}).then(() => {
      parentPort.on('message', data => globalThis.onmessage({ data }));
    });
  `,
            { eval: true },
        );
        constructor(url: URL, options: WorkerOptions) {
            bridges.push(this);
            expect(url.pathname).toMatch(/liveTactics\.worker\.ts$/);
            expect(options.type).toBe("module");
            this.thread.on("error", (error) => this.onerror?.({ message: error.message }));
            this.thread.on("message", (data: TacticalWorkerMessage) => {
                if ("type" in data && data.type === "started") this.startedAt = performance.now();
                this.onmessage?.({ data });
            });
        }
        postMessage(data: LiveTacticalScanInput) {
            this.thread.postMessage(data);
        }
        terminate() {
            this.termination = this.thread.terminate();
        }
    }
    vi.stubGlobal("Worker", BrowserWorker);
    try {
        const scan = await classifyLiveTacticsInWorker(input, new AbortController().signal);
        const bridge = bridges[0];
        const end = performance.now();
        expect(bridge.startedAt).not.toBeNull();
        expect(bridge.termination).toBeDefined();
        await bridge.termination;
        return {
            scan,
            elapsedMs: end - start,
            startupMs: bridge.startedAt! - start,
            classificationMs: end - bridge.startedAt!,
        };
    } finally {
        vi.unstubAllGlobals();
    }
}

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)(
    "cold production workers retain real-position results within the UI deadline",
    async () => {
        const ordinary = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/ordinary-games-stockfish-18.json", "utf8"),
        ) as {
            id: string;
            fen: string;
            beforeFen: string;
            played: string;
            after: LiveTacticalVariationInput[];
        }[];
        ordinary.push(
            ...JSON.parse(
                readFileSync(
                    "benchmarks/tactical-relevance/ordinary-adjacent-stockfish-18.json",
                    "utf8",
                ),
            ),
        );
        const expanded = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/expanded-development.json", "utf8"),
        ).cases as {
            id: string;
            startFen: string;
            bestLine: string[];
        }[];
        const cases = [
            {
                id: "constructed:capture-to-discovered-check",
                input: {
                    fen: "6r1/1p6/6k1/4R3/4Nr2/8/7P/6K1 b - - 0 1",
                    pvUci: ["f4e4", "e5e4", "g6f5", "g1f2", "f5e4"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:checking-skewer-with-defended-block",
                input: {
                    fen: "4r1rk/4q2p/8/8/8/3BN3/1PP5/R1K5 b - - 0 1",
                    pvUci: ["g8g1", "d3f1", "g1f1", "e3f1", "e7e1"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:shared-mating-route",
                input: {
                    fen: "4r1rk/4q2p/5n1Q/8/3n4/3B3R/3K4/8 w - - 0 1",
                    pvUci: ["h6f6", "e7f6", "h3h7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:countercapture-and-delayed-fork",
                input: {
                    fen: "8/4r1p1/p2k4/1bN5/5K2/5P2/6P1/1R6 w - - 0 1",
                    pvUci: ["c5a6", "g7g5", "f4g3", "b5a6", "b1b6", "d6d7", "b6a6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:pawn-square-clearance-fork",
                input: {
                    fen: "4k3/7r/8/8/6pN/4r1P1/5RPK/8 b - - 0 1",
                    pvUci: ["h7h4", "g3h4", "g4g3", "h2g1", "g3f2", "g1f2"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:immediate-alternative-after-cycle",
                input: {
                    fen: "6k1/2r2Npp/2q1P3/3n4/8/6Q1/5PPP/3R1RK1 w - - 0 1",
                    pvUci: ["f7h6", "g8h8", "h6f7", "h8g8", "d1d5", "c6d5", "g3c7"],
                    variations: [
                        {
                            multipv: 1,
                            cp: 420,
                            pvUci: ["f7h6", "g8h8", "h6f7", "h8g8", "d1d5", "c6d5", "g3c7"],
                        },
                        { multipv: 2, cp: 413, pvUci: ["d1d5", "c6d5", "g3c7"] },
                    ],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:combined-defender-removal",
                input: {
                    fen: "6k1/2r2ppp/2q5/3n4/8/6Q1/5PPP/3R1RK1 w - - 0 1",
                    pvUci: ["d1d5", "c6d5", "g3c7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "regression:connected-pin-entry",
                input: {
                    fen: "2r2rk1/pp4pp/1n3p2/3p4/3qp1N1/6Q1/P1P3PP/1N2R2K w - - 4 21",
                    pvUci: ["g4h6"],
                    engineName: "Regression",
                    depth: 16,
                },
            },
            {
                id: "constructed:incidental-pin-check-cycle",
                input: {
                    fen: "6k1/5Npp/8/8/8/2r3Q1/8/6K1 w - - 0 1",
                    pvUci: ["f7h6", "g8h8", "h6f7", "h8g8", "g3c3", "g7g6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:exchange-deflection",
                input: {
                    fen: "4r1k1/3q1pbp/6p1/3Q4/8/5P2/P5PP/R2R2K1 b - - 0 1",
                    pvUci: ["e8e1", "d1e1", "d7d5"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mating-king-acceptance",
                input: {
                    fen: "5r1k/7p/4B3/4NpP1/8/3Q3R/8/6K1 w - - 0 1",
                    pvUci: ["h3h7", "h8h7", "d3h3", "h7g7", "h3h6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:discovery-backed-fork",
                input: {
                    fen: "3r1nk1/2q3p1/2nppb1p/8/2P1PPQ1/2N5/1B4PP/5R1K w - - 0 1",
                    pvUci: ["c3d5", "e6d5", "b2f6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mating-capture",
                input: {
                    fen: "4b2k/7p/5q2/8/8/6R1/8/4R1K1 w - - 0 1",
                    pvUci: ["e1e8", "f6f8", "e8f8"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:two-minors-for-rook",
                input: {
                    fen: "2k5/1pq5/6Q1/P1n5/8/Rb6/5PPP/6K1 w - - 0 1",
                    pvUci: ["a3b3", "c5b3", "g6e6", "c8b8", "e6b3"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mate-backed-fork",
                input: {
                    fen: "3qkb1r/5p1b/4p1pp/4N3/2B5/6N1/4QPPP/6K1 w k - 0 1",
                    pvUci: ["e5f7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:perpetual-check",
                input: {
                    fen: "r6k/5Q1p/6p1/8/q7/8/8/5R1K w - - 0 1",
                    pvUci: ["f7f6", "h8g8", "f6f7", "g8h8", "f7f6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:reinforced-pin",
                input: {
                    fen: "1r5k/6pp/8/3b4/8/2Q2R2/8/7K b - - 0 1",
                    pvUci: ["b8f8"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:blocking-defender-deflection",
                input: {
                    fen: "3q3k/8/8/3B4/7n/5P2/3R4/7K b - - 0 1",
                    pvUci: ["h4f3", "d5f3", "d8d2"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:quiet-capture-fork-preparation",
                input: {
                    fen: "8/p7/7k/4p3/2n5/2B5/5Q1P/6K1 w - - 0 1",
                    pvUci: ["c3e5", "c4e5", "f2f4", "h6h7", "f4e5"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            ...[
                {
                    id: "constructed:accepted-fork-sacrifice",
                    fen: "8/8/6k1/5qpr/4N3/8/8/K6Q w - - 0 1",
                    offer: "h1h5",
                    acceptance: "g6h5",
                },
                {
                    id: "constructed:accepted-mating-sacrifice",
                    fen: "5rnk/6pp/4Q2N/8/8/8/8/K7 w - - 0 1",
                    offer: "e6g8",
                    acceptance: "f8g8",
                },
            ].map((item) => ({
                id: item.id,
                input: {
                    fen: makeFen(replayTacticalLine(item.fen, [item.offer])[0].after.toSetup()),
                    previousFen: item.fen,
                    previousMoveUci: item.offer,
                    pvUci: [item.acceptance],
                    engineName: "Constructed",
                    depth: 16,
                },
            })),
            {
                id: "constructed:capturing-fork-preparation",
                input: {
                    fen: "8/8/6k1/5qpr/4N3/8/8/K6Q w - - 0 1",
                    pvUci: ["h1h5", "g6h5", "e4g3"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mating-deflection-declined",
                input: {
                    fen: "8/3Q4/6pp/5n1k/2B1N1pq/8/3B4/6K1 w - - 0 1",
                    pvUci: ["d7f5", "h4g5", "d2g5"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:fork-backed-by-checking-recapture",
                input: {
                    fen: "3r2qk/6pr/5p1P/8/4N3/2B5/5PPP/5RK1 w - - 0 1",
                    pvUci: ["e4f6", "g7f6", "c3f6", "h7g7", "f6g7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:defender-removing-fork-preparation",
                input: {
                    fen: "8/5pkp/6p1/2p5/2Rp4/3Q4/1q4PP/6BK w - - 0 1",
                    pvUci: ["c4d4", "c5d4", "g1d4"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:queen-capture-over-incidental-pin",
                input: {
                    fen: "8/4R1pk/5q2/8/8/8/1B6/6K1 w - - 0 1",
                    pvUci: ["b2f6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:exchange-for-discovery-attraction",
                input: {
                    fen: "6k1/8/1qp5/5b2/Q1P1n3/2N5/1P3PP1/6K1 w - - 0 1",
                    pvUci: ["c3e4", "f5e4", "c4c5", "b6c5", "a4e4"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:quiet-mating-deflection-exchange",
                input: {
                    fen: "4r2k/5rp1/6qp/3PB3/4Q2n/3R4/6PP/4R1K1 b - - 0 1",
                    pvUci: ["e8e5", "e4h4", "e5e1", "h4e1", "g6d3"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mate-independent-of-fork-victim",
                input: {
                    fen: "1n5k/7p/5q2/8/8/6R1/8/4R1K1 w - - 0 1",
                    pvUci: ["e1e8", "f6f8", "e8f8"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:knight-exchange-for-pawn",
                input: {
                    fen: "3qk2r/8/8/4N3/2BP4/8/PPP2PPP/R4RK1 w k - 0 1",
                    pvUci: ["e5f7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:bishop-exchange-for-pawn",
                input: {
                    fen: "4k2r/8/8/6B1/6N1/2q4P/PPP2P2/R4RK1 w k - 0 1",
                    pvUci: ["g5f6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "ordinary-3:protected-discovery-payoff",
                input: {
                    fen: "rn3r1k/ppp1pq1p/3pNp2/5p2/3P4/1BN1P3/PPP2PPP/2KR3R w - - 6 14",
                    pvUci: ["e6c7", "f7g7", "c7a8"],
                    engineName: "Stockfish 18 audited continuation",
                    depth: 16,
                },
            },
            {
                id: "screenshot:f7-alternatives",
                input: {
                    fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
                    pvUci: ["e5f7", "d8e8", "f7h8"],
                    engineName: "Regression",
                    depth: 16,
                    variations: [
                        { multipv: 1, pvUci: ["e5f7", "d8e8", "f7h8"], cp: 460 },
                        { multipv: 2, pvUci: ["c4f7", "e8f8", "f7b3"], cp: 350 },
                    ],
                },
            },
            ...ordinary.map((row) => ({
                id: row.id,
                input: {
                    fen: row.fen,
                    ...row.after[0],
                    depth: row.after[0].depth ?? 16,
                    variations: row.after,
                    engineName: "Stockfish 18",
                    previousFen: row.beforeFen,
                    previousMoveUci: makeUci(
                        parseSan(
                            Chess.fromSetup(parseFen(row.beforeFen).unwrap()).unwrap(),
                            row.played,
                        )!,
                    ),
                },
            })),
            ...expanded.map((row) => ({
                id: row.id,
                input: {
                    fen: row.startFen,
                    pvUci: row.bestLine,
                    engineName: "Source line",
                    depth: 16,
                },
            })),
        ];
        const report = [];
        for (const item of cases) {
            // A fresh worker never inherits the in-process proof caches.
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, item.input);
            const expected = buildLiveTacticalScan(item.input);
            expect({ id: item.id, scan: result.scan }).toEqual({ id: item.id, scan: expected });
            expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
            report.push({
                id: item.id,
                elapsedMs: result.elapsedMs,
                startupMs: result.startupMs,
                classificationMs: result.classificationMs,
                primary: result.scan.motifs.map((m) => m.id),
                matchesSource: true,
            });
        }
        expect(report).toHaveLength(113);
        if (process.env.TACTICAL_WORKER_REPORT)
            writeFileSync(
                process.env.TACTICAL_WORKER_REPORT,
                JSON.stringify(
                    {
                        scope: "Actual application worker controller with cold production JS worker import, classification and structured transfer on this Node host. Separate startup and computation deadlines; excludes engine search and does not prove WebView or physical UI latency.",
                        deadlineMs: TACTICAL_CLASSIFICATION_TIMEOUT_MS,
                        startupDeadlineMs: TACTICAL_WORKER_STARTUP_TIMEOUT_MS,
                        cases: report,
                    },
                    null,
                    2,
                ),
            );
    },
    120000,
);

test.skipIf(
    !process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_PRIVATE_MATING_OVERLAP_REPORT,
)("the real reached checking skewer survives the built worker boundary", async () => {
    const report = JSON.parse(
        readFileSync(process.env.TACTICAL_PRIVATE_MATING_OVERLAP_REPORT!, "utf8"),
    );
    const row = report.searches.find((s: { id: string }) => s.id === "real-missed-alternative");
    const steps = replayTacticalLine(row.fen, row.lines[0].pvUci);
    const input = {
        fen: makeFen(steps[0].after.toSetup()),
        pvUci: row.lines[0].pvUci.slice(1),
        engineName: "Stockfish 18",
        depth: 16,
    };
    const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
    expect(result.scan).toEqual(buildLiveTacticalScan(input));
    expect(result.scan.motifs[0]).toMatchObject({ id: "skewer", value: 500 });
    expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
    expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
});

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_PRIVATE_THIRD_REPORT)(
    "the third disjoint sample retains full source and live timelines through the worker",
    async () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_REPORT!, "utf8"));
        expect(report.cases).toHaveLength(24);
        for (const row of report.cases) {
            for (const input of [
                {
                    fen: row.fen,
                    pvUci: row.engineLines[0].pvUci,
                    variations: row.engineLines,
                    engineName: "Stockfish 18",
                    depth: 16,
                },
                {
                    fen: row.fen,
                    pvUci: row.sourceUci,
                    engineName: "Private source continuation",
                    depth: 16,
                },
            ]) {
                const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
                expect({ id: row.id, scan: result.scan }).toEqual({
                    id: row.id,
                    scan: buildLiveTacticalScan(input),
                });
                expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
                expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
            }
        }
    },
    120000,
);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "the private recovered themes survive the built worker boundary",
    async () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        for (const [id, theme, value] of [
            ["private-easy:145", "fork", 80],
            ["private-easy:68", "pin", 100],
            ["private-easy:77", "forkPreparation", 100],
            ["private-easy:97", "forkPreparation", 280],
            ["private-easy:87", "forkPreparation", 90],
            ["private-easy:173", "forkPreparation", 100],
            ["private-easy:10", "deflection", 320],
            ["private-easy:212", "fork", 180],
            ["private-easy:49", "forkPreparation", 100],
            ["private-easy:193", "deflection", 100],
            ["private-easy:58", "attraction", 100],
            ["private-easy:202", "deflection", 330],
        ] as const) {
            const row = sample.cases.find((item: { id: string }) => item.id === id);
            const input = {
                fen: row.fen,
                pvUci: row.sourceUci,
                engineName: "Private course source",
                depth: 16,
            };
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
            expect(result.scan).toEqual(buildLiveTacticalScan(input));
            expect(result.scan.motifs[0]).toMatchObject({ id: theme, value });
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
        }
    },
);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_PRIVATE_DISJOINT_REPORT)(
    "the disjoint fresh-engine sample survives the built worker boundary",
    async () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_REPORT!, "utf8"),
        );
        expect(report.cases).toHaveLength(24);
        for (const row of report.cases) {
            const input = {
                fen: row.fen,
                pvUci: row.engineLines[0].pvUci,
                variations: row.engineLines,
                engineName: "Stockfish 18",
                depth: 16,
            };
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
            expect({ id: row.id, scan: result.scan }).toEqual({
                id: row.id,
                scan: buildLiveTacticalScan(input),
            });
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
            expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
        }
        // The quiet sacrifice is still unproved. Verify the independently
        // reached drawing check instead of counting the source root recovered.
        const draw = report.cases.find(
            (row: { eligibleIndex: number }) => row.eligibleIndex === 11,
        );
        const steps = replayTacticalLine(draw.fen, draw.sourceUci);
        const input = {
            fen: makeFen(steps[4].before.toSetup()),
            pvUci: [steps[4].uci],
            variations: [{ pvUci: [steps[4].uci], cp: 0 }],
            engineName: "Stockfish 18",
            depth: 16,
        };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs[0]).toMatchObject({ id: "perpetualCheck", value: 0 });
        expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
    },
    120000,
);
