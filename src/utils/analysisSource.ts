import type { BestMoveSource } from "@/bindings";

export function getBestMoveSourceLabel(source: BestMoveSource): string {
    switch (source) {
        case "lichess":
            return "Lichess Cloud";
        case "chessdb":
            return "ChessDB";
        default:
            return source satisfies never;
    }
}
