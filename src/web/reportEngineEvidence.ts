import { makeUci, parseUci } from "chessops";
import { normalizeMove } from "chessops/chess";
import { makeSan } from "chessops/san";
import { exactReportRoot, type ReportSearchLimits } from "../../scripts/uci-report-search.mjs";
import { positionFromFen } from "@/utils/chessops";
import { normalizeWebEngineScoreForWhite } from "./engineScore";
import type { WebEngineLine } from "./model";

// Reports require exact evidence for the engine's final choice. Interactive
// display lines and saved cloud evaluations retain their separate behavior.
export function createReportEngineEvidence(
    fen: string,
    limits: ReportSearchLimits,
    multipv: number,
) {
    const [root] = positionFromFen(fen);
    if (!root || root.isEnd())
        throw new Error("A replayable nonterminal report position is required.");
    const byRoot = new Map<string, WebEngineLine>();
    const canonical = (uci: string) => {
        const parsed = parseUci(uci);
        if (!parsed) return null;
        const move = normalizeMove(root, parsed);
        return root.isLegal(move) ? makeUci(move) : null;
    };
    return {
        add(line: string, executionLocation: "gaming-pc" | "phone", engineName?: string) {
            const candidate = exactReportRoot(line, limits, multipv);
            if (!candidate) return;
            const key = canonical(candidate);
            if (!key) return;
            const tokens = line.trim().split(/\s+/);
            const uciMoves = tokens.slice(tokens.indexOf("pv") + 1);
            const position = root.clone();
            const sanMoves: string[] = [];
            for (const uci of uciMoves) {
                const parsed = parseUci(uci);
                if (!parsed) return;
                const move = normalizeMove(position, parsed);
                if (!position.isLegal(move)) return;
                sanMoves.push(makeSan(position, move));
                position.play(move);
            }
            const scoreIndex = tokens.indexOf("score");
            const rankIndex = tokens.indexOf("multipv");
            byRoot.set(key, {
                source: "stockfish",
                executionLocation,
                engineName: engineName ?? null,
                multipv: rankIndex < 0 ? 1 : Number(tokens[rankIndex + 1]),
                depth: Number(tokens[tokens.indexOf("depth") + 1]),
                score: normalizeWebEngineScoreForWhite(
                    {
                        type: tokens[scoreIndex + 1] as "cp" | "mate",
                        value: Number(tokens[scoreIndex + 2]),
                    },
                    root.turn,
                ),
                uciMoves,
                sanMoves,
            });
        },
        finish(bestmove: string): WebEngineLine[] {
            const key = canonical(bestmove);
            const selected = key ? byRoot.get(key) : undefined;
            if (!selected)
                throw new Error(
                    "The report engine returned no exact legal score for its selected move.",
                );
            return [selected];
        },
    };
}
