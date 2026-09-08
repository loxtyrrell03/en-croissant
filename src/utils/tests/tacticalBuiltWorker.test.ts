import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    buildLiveTacticalScan,
    type LiveTacticalScan,
    type LiveTacticalScanInput,
    type LiveTacticalVariationInput,
} from "../tacticalMotifs/liveTactics";
import {
    TACTICAL_CLASSIFICATION_TIMEOUT_MS,
    type TacticalWorkerReply,
} from "../tacticalMotifs/liveTacticsWorker";

/** Execute the actual Vite artifact with only a browser message bridge. No DOM,
 * Tauri, localStorage or source transpiler is supplied to the worker. */
function runBuiltWorker(path: string, input: LiveTacticalScanInput) {
    const start = performance.now();
    const worker = new Worker(
        `
    const { parentPort } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = data => parentPort.postMessage(data);
    import(${JSON.stringify(pathToFileURL(resolve(path)).href)}).then(() => {
      parentPort.on('message', data => globalThis.onmessage({ data }));
      parentPort.postMessage({ ready: true });
    });
  `,
        { eval: true },
    );
    return new Promise<{ scan: LiveTacticalScan; elapsedMs: number }>((accept, reject) => {
        let settled = false;
        const finish = async (reply: TacticalWorkerReply) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const elapsedMs = performance.now() - start;
            await worker.terminate();
            if (reply.ok) accept({ scan: reply.scan, elapsedMs });
            else reject(new Error(reply.error));
        };
        const timer = setTimeout(() => {
            void finish({ ok: false, error: "Built worker deadline exceeded" });
        }, TACTICAL_CLASSIFICATION_TIMEOUT_MS);
        worker.on("error", (error) => {
            void finish({ ok: false, error: error.message });
        });
        worker.on("message", (reply: TacticalWorkerReply | { ready: true }) => {
            if ("ready" in reply) worker.postMessage(input);
            else void finish(reply);
        });
    });
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
            report.push({
                id: item.id,
                elapsedMs: result.elapsedMs,
                primary: result.scan.motifs.map((m) => m.id),
                matchesSource: true,
            });
        }
        expect(report).toHaveLength(82);
        if (process.env.TACTICAL_WORKER_REPORT)
            writeFileSync(
                process.env.TACTICAL_WORKER_REPORT,
                JSON.stringify(
                    {
                        scope: "Cold production JS worker import, classification and structured result transfer on this Node host; excludes engine search and does not prove WebView or physical UI latency.",
                        deadlineMs: TACTICAL_CLASSIFICATION_TIMEOUT_MS,
                        cases: report,
                    },
                    null,
                    2,
                ),
            );
    },
    120000,
);
