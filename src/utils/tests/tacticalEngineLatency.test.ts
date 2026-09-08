import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { buildTacticalEngineOptions } from "../tacticalMotifs/liveTactics";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";

// Fresh native processes, actual per-scan options and coherent MultiPV sets.
// This measures UCI startup/search, not Tauri delivery or WebView rendering.
function scan(engine: string, fen: string) {
    const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    let legalCount = 0;
    for (const [from, dests] of position.allDests()) {
        for (const to of dests)
            legalCount += position.board.get(from)?.role === "pawn" && (to < 8 || to >= 56) ? 4 : 1;
    }
    const expectedRoots = Math.min(3, legalCount);
    const started = performance.now();
    const child = spawn(engine, [], { windowsHide: true, stdio: "pipe" });
    const options = buildTacticalEngineOptions([
        { name: "Threads", value: 8 },
        { name: "Hash", value: 512 },
    ]);
    return new Promise<{
        startupMs: number;
        usableMs: number;
        totalMs: number;
        depth: number;
        roots: string[];
        expectedRoots: number;
    }>((resolve, reject) => {
        let pending = "";
        let startupMs = 0;
        let usableMs = 0;
        let depth = 0;
        let latest = new Map<number, string[]>();
        let currentDepth = 0;
        const current = new Map<number, string[]>();
        let searchTimer: ReturnType<typeof setTimeout> | undefined;
        const hardDeadline = setTimeout(
            () => finish(new Error("Native scan exceeded its startup/search deadline")),
            19000,
        );
        let done = false;
        function finish(error?: Error) {
            if (done) return;
            done = true;
            clearTimeout(hardDeadline);
            clearTimeout(searchTimer);
            child.kill();
            if (error) reject(error);
            else
                resolve({
                    startupMs,
                    usableMs,
                    totalMs: performance.now() - started,
                    depth,
                    expectedRoots,
                    roots: [...latest.values()].map((pv) => pv[0]),
                });
        }
        child.on("error", finish);
        child.on("exit", (code) => {
            if (!done) finish(new Error(`Engine exited early: ${code}`));
        });
        child.stdin.on("error", (error) => {
            if (!done) finish(error);
        });
        child.stderr.resume();
        child.stdout.on("data", (chunk) => {
            pending += String(chunk);
            const rows = pending.split(/\r?\n/);
            pending = rows.pop() ?? "";
            for (const row of rows) {
                if (done) break;
                if (row === "uciok")
                    child.stdin.write(
                        options
                            .map(
                                (option) => `setoption name ${option.name} value ${option.value}\n`,
                            )
                            .join("") + "isready\n",
                    );
                if (row === "readyok") {
                    startupMs = performance.now() - started;
                    child.stdin.write(`position fen ${fen}\ngo depth 16\n`);
                    searchTimer = setTimeout(() => child.stdin.write("stop\n"), 6000);
                }
                const match = row.match(
                    /info depth (\d+).* multipv (\d+).* score (?:cp|mate) -?\d+.* pv (.+)/,
                );
                if (match && !/\b(?:lowerbound|upperbound)\b/.test(row)) {
                    const nextDepth = Number(match[1]);
                    if (nextDepth < currentDepth) continue;
                    if (nextDepth > currentDepth) {
                        currentDepth = nextDepth;
                        current.clear();
                    }
                    current.set(Number(match[2]), match[3].trim().split(/\s+/));
                    if (current.size === expectedRoots) {
                        depth = currentDepth;
                        latest = new Map(current);
                        if (depth >= 8 && !usableMs) usableMs = performance.now() - started;
                    }
                }
                if (row.startsWith("bestmove ")) {
                    if (depth < 8 || latest.size !== expectedRoots)
                        return finish(
                            new Error(
                                `No usable complete snapshot: depth ${depth}, ${latest.size} roots`,
                            ),
                        );
                    for (const pv of latest.values()) {
                        if (replayTacticalLine(fen, pv).length !== pv.length)
                            return finish(
                                new Error("Native snapshot contains an illegal continuation"),
                            );
                    }
                    finish();
                }
            }
        });
        child.stdin.write("uci\n");
    });
}

test.skipIf(
    !process.env.TACTICAL_LATENCY_ENGINE || !existsSync(process.env.TACTICAL_LATENCY_ENGINE),
)(
    "fresh Stockfish scans return usable snapshots across frozen real positions",
    async () => {
        const ordinary = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/ordinary-games-stockfish-18.json", "utf8"),
        ) as { id: string; fen: string }[];
        const expanded = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/expanded-development.json", "utf8"),
        ).cases as { id: string; startFen: string }[];
        const positions = [
            {
                id: "screenshot:f7",
                fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
            },
            {
                id: "screenshot:reti",
                fen: "rnbqkbnr/ppp1pppp/8/3p4/2P5/5N2/PP1PPPPP/RNBQKB1R b KQkq - 0 2",
            },
            ...ordinary,
            ...expanded.map((row) => ({ id: row.id, fen: row.startFen })),
        ];
        const report = [];
        for (const position of positions) {
            const result = await scan(process.env.TACTICAL_LATENCY_ENGINE!, position.fen).catch(
                (error) => {
                    throw new Error(`${position.id}: ${error.message}`);
                },
            );
            expect(result.depth).toBeGreaterThanOrEqual(8);
            expect(new Set(result.roots).size).toBe(result.expectedRoots);
            report.push({ id: position.id, ...result });
        }
        expect(report).toHaveLength(58);
        if (process.env.TACTICAL_LATENCY_REPORT)
            writeFileSync(
                process.env.TACTICAL_LATENCY_REPORT,
                JSON.stringify(
                    {
                        scope: "58 fresh native UCI searches, Threads 2 / Hash 64 / MultiPV up to 3 (legal-move count), depth 16 with six-second stop; not Tauri, WebView or classification timing. Fixed development positions, not an accuracy estimate.",
                        report,
                    },
                    null,
                    2,
                ),
            );
    },
    420000,
);
