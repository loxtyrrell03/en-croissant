import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test, vi } from "vitest";
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
                id: "constructed:queen-capture-over-incidental-pin",
                input: {
                    fen: "8/4R1pk/5q2/8/8/8/1B6/6K1 w - - 0 1",
                    pvUci: ["b2f6"],
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
        expect(report).toHaveLength(85);
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

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "the private fork and pinned capture survive the built worker boundary",
    async () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        for (const [id, theme, value] of [
            ["private-easy:145", "fork", 80],
            ["private-easy:68", "pin", 100],
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
