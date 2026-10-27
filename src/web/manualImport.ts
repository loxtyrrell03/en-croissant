import { makeFen, parseFen } from "chessops/fen";
import { Chess } from "chessops/chess";
import { parsePgnDatabase } from "./pgn";

/** Validate the complete paste before changing the saved workspace. */
export function preparePhoneManualImport(text: string) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Paste a PGN game or FEN position first.");
    if (/^[prnbqkPRNBQK1-8]+\//.test(trimmed)) {
        const setup = parseFen(trimmed);
        if (setup.isErr)
            throw new Error(
                "This FEN could not be read. Paste the full position, including the side to move.",
            );
        const position = Chess.fromSetup(setup.value);
        if (position.isErr)
            throw new Error(
                "This FEN is not a legal chess position. Check the pieces and side to move.",
            );
        return {
            kind: "fen" as const,
            name: "Pasted position",
            pgn: `[SetUp "1"]\n[FEN "${makeFen(position.value.toSetup())}"]\n\n*`,
        };
    }
    if (!/\[\w+\s+"|\b\d+\.(?:\s|\.|[KQRBNa-hO])/.test(trimmed)) {
        throw new Error("Paste PGN moves (for example, 1. e4 e5) or a full FEN position.");
    }
    const parsed = parsePgnDatabase("Pasted games", trimmed, 0);
    if (!parsed.games.length || parsed.warnings.length) {
        throw new Error(
            parsed.warnings[0] ?? "No readable games were found. Check the PGN and try again.",
        );
    }
    return { kind: "pgn" as const, name: "Pasted games", pgn: trimmed };
}
