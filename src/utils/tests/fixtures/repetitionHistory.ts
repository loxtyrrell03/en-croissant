import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

// Constructed reversible histories of an existing public mating fixture.
// No engine score or source tag establishes the repetition boundary.
export const repetitionOrigin = "r2q1r2/p4p1k/1p2pP1n/2p4R/3p1P2/P2P1N1P/1PP4K/6R1 w - - 0 30";
export const repetitionCycle = ["g1g7", "h7h8", "g7g1", "h8h7"];
export const repetitionClean = ["g1g2", "h7h8", "g2g3", "h8h7", "g3g4", "h7h8", "g4g1", "h8h7"];
export const repetitionMateLine = ["g1g7", "h7h8", "h5h6"];
export const repetitionAnnouncedOrigin = "r2q1r1k/p4pR1/1p2pP1n/2p4R/3p1P2/P2P1N1P/1PP4K/8 w - - 0 30";
export const repetitionAnnounced = ["g7h7", "h8g8", "h7g7", "g8h8", "g7g1", "h8h7"];
export const repetitionFlip = (move: string) => move.replace(/[1-8]/g, rank => String(9 - Number(rank)));

export function repetitionHistory(origin: string, moves: string[], mirrored = false) {
    const fields = origin.split(" ");
    if (mirrored) {
        fields[0] = fields[0].split("/").reverse().join("/").replace(/[a-zA-Z]/g,
            c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
        fields[1] = fields[1] === "w" ? "b" : "w";
        fields[2] = fields[2].replace(/[a-zA-Z]/g, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
        if (fields[3] !== "-") fields[3] = repetitionFlip(fields[3]);
    }
    const history = { fen: fields.join(" "), moves: mirrored ? moves.map(repetitionFlip) : [...moves] };
    const position = Chess.fromSetup(parseFen(history.fen).unwrap()).unwrap();
    for (const uci of history.moves) {
        const move = parseUci(uci);
        if (!move || !position.isLegal(move)) throw new Error(`Illegal fixture move ${uci}`);
        position.play(move);
    }
    return { fen: makeFen(position.toSetup()), tacticalHistory: history };
}
