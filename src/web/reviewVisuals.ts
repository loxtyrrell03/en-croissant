import { makeUci } from "chessops";
import { parseSan } from "chessops/san";
import { positionFromFen } from "@/utils/chessops";
import { playUciMove } from "./pgn";
import type { PhoneReviewCard } from "./mistakeReview";

/** Replay the original mistake and only legal opponent replies from saved SAN. */
export function reviewMistakeFrames(card: PhoneReviewCard) {
    let fen = card.fen;
    const frames: { fen: string; uci: string; san: string }[] = [];
    for (const san of [card.played, ...card.refutation]) {
        const position = positionFromFen(fen)[0];
        const move = position && parseSan(position, san);
        if (!move) break;
        const uci = makeUci(move);
        const played = playUciMove(fen, uci);
        if (!played) break;
        fen = played.fenAfter;
        frames.push({ fen, uci, san });
    }
    return frames;
}
