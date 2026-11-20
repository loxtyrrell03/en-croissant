import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Chess, castlingSide } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { vi } from "vitest";
import type { BestMoves, EngineOptions } from "@/bindings";
import type { LocalEngine } from "@/utils/engines";

const tasks = vi.hoisted(() => new Map<string, () => void>());
export const queries: Array<{
    nodes: number;
    searched: number;
    moves: string[];
    restricted: string[];
}> = [];
vi.mock("@/bindings", () => ({ events: { bestMovesPayload: { listen: async () => () => {} } } }));
vi.mock("@/utils/engines", () => ({
    killEngine: async (_engine: LocalEngine, tab: string) => tasks.get(tab)?.(),
    getBestMoves: (
        engine: LocalEngine,
        tab: string,
        limit: { t: string; c: number },
        options: EngineOptions,
    ) => runStockfish(engine.path, tab, limit.c, options),
}));

// Supply real engine frames through the app's existing native engine boundary.
async function runStockfish(path: string, id: string, nodes: number, options: EngineOptions) {
    const position = Chess.fromSetup(parseFen(options.fen).unwrap()).unwrap();
    const standardUci = (uci: string) => {
        const move = parseUci(uci)!;
        const castle = castlingSide(position, move);
        if (castle && "from" in move)
            return makeUci({ from: move.from, to: (move.from & 56) + (castle === "h" ? 6 : 2) });
        return uci;
    };
    const history = options.moves.map((uci) => {
        const encoded = standardUci(uci);
        position.play(parseUci(uci)!);
        return encoded;
    });
    const restricted = options.searchMoves?.map(standardUci) ?? [];
    const rank = Number(options.extraOptions.find((option) => option.name === "MultiPV")!.value);
    const sign = position.turn === "white" ? 1 : -1;
    const child = spawn(path, [], { windowsHide: true, stdio: "pipe" });
    tasks.set(id, () => {
        child.kill();
    });
    const query = { nodes, searched: 0, moves: [...options.moves], restricted };
    queries.push(query);
    const frames = new Map<number, Map<number, BestMoves>>();
    let complete: BestMoves[] = [];
    return new Promise<[number, BestMoves[]]>((resolve, reject) => {
        child.stdin.on("error", reject);
        child.on("error", reject);
        child.on("exit", () => {
            tasks.delete(id);
            resolve([100, complete]);
        });
        const protocol = createInterface({ input: child.stdout });
        protocol.on("line", (line) => {
            if (line === "uciok") {
                for (const option of options.extraOptions)
                    child.stdin.write(`setoption name ${option.name} value ${option.value}\n`);
                child.stdin.write("isready\n");
            } else if (line === "readyok") {
                child.stdin.write(
                    `position fen ${options.fen}${history.length ? " moves " + history.join(" ") : ""}\n`,
                );
                child.stdin.write(
                    `go nodes ${nodes}${restricted.length ? " searchmoves " + restricted.join(" ") : ""}\n`,
                );
            } else if (line.startsWith("bestmove ")) {
                child.stdin.end("quit\n");
            }
            const frame = line.match(
                /^info depth (\d+).*? multipv (\d+) score (cp|mate) (-?\d+) nodes (\d+).*? pv (.+)$/,
            );
            if (!frame) return;
            const [, d, variation, kind, value, visited, moves] = frame;
            const depth = Number(d),
                multipv = Number(variation);
            const row = frames.get(depth) ?? new Map<number, BestMoves>();
            query.searched = Math.max(Number(visited), query.searched);
            row.set(multipv, {
                depth,
                multipv,
                nodes: Number(visited),
                nps: 0,
                uciMoves: moves.split(" "),
                sanMoves: [],
                score: {
                    value: { type: kind as "cp" | "mate", value: sign * Number(value) },
                    wdl: null,
                },
            });
            frames.set(depth, row);
            if (row.size === rank && multipv <= rank && depth >= (complete[0]?.depth ?? 0))
                complete = [...row.values()].sort((a, b) => a.multipv - b.multipv);
        });
        child.stdin.write("uci\n");
    });
}
