import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import type { TacticalMotifEvidence } from "./types";
import { probeKingPawnEndgame } from "./kpkBitbase";

/** A record is a provider response tied to the exact requested FEN. The
 * request owner supplies this envelope; a PV or engine score cannot create it.
 * This module is pure and performs no network access. */
export type TablebaseRecord = { fen: string; result: unknown };
export type TablebaseEvidence = { provider: "lichess-syzygy"; records: TablebaseRecord[] };
export type ExactOutcome = -1 | 0 | 1;
type VerifiedPosition = {
    fen: string;
    outcome: ExactOutcome;
    moves: { uci: string; outcome: ExactOutcome }[];
};

const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

/** Categories refer to the position's side to move, including child records.
 * Uncertain maybe-/syzygy-/unknown categories cannot establish a 50-move-safe
 * outcome. Cursed wins and blessed losses are draws under that rule.
 * Provider contract: https://github.com/lichess-org/lila-tablebase#http-api */
function outcome(value: unknown): ExactOutcome | null {
    if (value === "win") return 1;
    if (value === "loss") return -1;
    if (value === "draw" || value === "cursed-win" || value === "blessed-loss") return 0;
    return null;
}

function legalMoves(pos: Chess): NormalMove[] {
    return [...pos.allDests()].flatMap(([from, tos]) =>
        [...tos].flatMap((to) =>
            pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) => ({
                      from,
                      to,
                      promotion,
                  }))
                : [{ from, to }],
        ),
    );
}

export function tablebasePosition(fen: string): Chess | null {
    if (typeof fen !== "string" || fen.length > 200) return null;
    const parsed = parseFen(fen).chain((setup) => Chess.fromSetup(setup));
    if (parsed.isErr) return null;
    const pos = parsed.value;
    // A pass changes en-passant rights, and castling is not in these tables.
    // Do not silently change either when constructing the counterfactual.
    if (
        pos.board.occupied.size() > 7 ||
        pos.castles.castlingRights.nonEmpty() ||
        pos.epSquare !== undefined
    )
        return null;
    return pos;
}

function terminalFlags(data: Record<string, unknown>, pos: Chess) {
    return (
        data.checkmate === pos.isCheckmate() &&
        data.stalemate === pos.isStalemate() &&
        data.insufficient_material === pos.isInsufficientMaterial() &&
        data.variant_win === false &&
        data.variant_loss === false
    );
}

/** Validate transport identity, every legal move (including all promotions),
 * terminal facts and parent/child minimax consistency. This validates a
 * tablebase certificate, not the provider's entire database from scratch. */
export function validateTablebaseRecord(
    record: TablebaseRecord,
    expectedFen: string,
): VerifiedPosition | null {
    const pos = tablebasePosition(expectedFen);
    const recorded = typeof record?.fen === "string" ? tablebasePosition(record.fen) : null;
    if (!pos || !recorded || makeFen(recorded.toSetup()) !== makeFen(pos.toSetup())) return null;
    const data = object(record.result);
    if (!data || !terminalFlags(data, pos) || !Array.isArray(data.moves) || data.moves.length > 256)
        return null;
    const value = outcome(data.category);
    if (value === null) return null;
    const legal = legalMoves(pos);
    if (data.moves.length !== legal.length) return null;
    const available = new Map(legal.map((move) => [makeUci(move), move]));
    const moves: VerifiedPosition["moves"] = [];
    for (const raw of data.moves) {
        const row = object(raw);
        if (!row || typeof row.uci !== "string") return null;
        const move = available.get(row.uci);
        if (!move) return null;
        available.delete(row.uci);
        const childValue = outcome(row.category);
        if (childValue === null) return null;
        const next = pos.clone();
        next.play(move);
        if (!terminalFlags(row, next)) return null;
        if (next.isCheckmate() ? childValue !== -1 : next.isEnd() && childValue !== 0) return null;
        moves.push({ uci: row.uci, outcome: childValue });
    }
    if (available.size) return null;
    const expected = pos.isCheckmate()
        ? -1
        : pos.isEnd()
          ? 0
          : Math.max(...moves.map((move) => -move.outcome));
    if (value !== expected) return null;
    // Where the independent local bitbase applies, disagreement is not a
    // reason to replace it with an external assertion.
    const local = probeKingPawnEndgame(pos);
    if (local && value !== (local.win ? (pos.turn === local.pawnSide ? 1 : -1) : 0)) return null;
    return { fen: makeFen(pos.toSetup()), outcome: value, moves };
}

export function tablebaseZugzwangRequests(fen: string, moveUci: string) {
    if (typeof moveUci !== "string" || moveUci.length > 5) return null;
    const before = tablebasePosition(fen),
        move = parseUci(moveUci);
    if (
        !before ||
        before.isCheck() ||
        before.isEnd() ||
        !move ||
        !("from" in move) ||
        move.promotion ||
        before.board.get(move.to) ||
        !before.isLegal(move)
    )
        return null;
    const after = before.clone();
    after.play(move);
    if (
        after.isCheck() ||
        after.isEnd() ||
        after.halfmoves >= 99 ||
        !tablebasePosition(makeFen(after.toSetup()))
    )
        return null;
    const passed = after.clone();
    passed.turn = before.turn;
    const passedFen = makeFen(passed.toSetup());
    if (!tablebasePosition(passedFen)) return null;
    return { before, after, passed, move, actualFen: makeFen(after.toSetup()), passedFen };
}

/** Capturing the last mating material is locally terminal, but that alone
 * does not make it a saving tactic. Exact outcomes of the alternatives are
 * required separately; routine drawn exchanges must remain quiet. */
export function drawingCaptureRequest(fen: string, moveUci: string) {
    if (typeof moveUci !== "string" || moveUci.length > 5) return null;
    const before = tablebasePosition(fen),
        move = parseUci(moveUci);
    if (
        !before ||
        before.isEnd() ||
        before.halfmoves >= 100 ||
        !move ||
        !("from" in move) ||
        !before.board.get(move.to) ||
        !before.isLegal(move)
    )
        return null;
    const after = before.clone();
    after.play(move);
    if (!after.isInsufficientMaterial()) return null;
    return { before, after, move, fen: makeFen(before.toSetup()) };
}

export function proveDrawingCapture(
    fen: string,
    moveUci: string,
    evidence?: TablebaseEvidence | null,
) {
    const request = drawingCaptureRequest(fen, moveUci);
    if (!request) return null;
    const exact = verifiedTablebasePosition(request.fen, evidence);
    if (
        !exact ||
        exact.outcome !== 0 ||
        !exact.moves.some((m) => m.uci === moveUci && m.outcome === 0)
    )
        return null;
    const drawing = exact.moves.filter((m) => m.outcome === 0);
    // Permit equivalent captures of the same last piece, but not quiet
    // drawing alternatives or another unrelated route to a drawn ending.
    if (
        !exact.moves.some((m) => m.outcome === 1) ||
        drawing.some((m) => {
            const alternative = drawingCaptureRequest(fen, m.uci);
            return !alternative || alternative.move.to !== request.move.to;
        })
    )
        return null;
    return {
        ...request,
        drawingMoves: drawing.map((m) => m.uci),
        losingMoves: exact.moves.filter((m) => m.outcome === 1).map((m) => m.uci),
    };
}

export function drawingCaptureEvidence(
    fen: string,
    moveUci: string,
    evidence: TablebaseEvidence | null | undefined,
    source: TacticalMotifEvidence["source"],
): TacticalMotifEvidence | null {
    const proof = proveDrawingCapture(fen, moveUci, evidence);
    if (!proof) return null;
    const captured = proof.before.board.get(proof.move.to)!;
    return {
        id: "drawingCapture",
        label: "Drawing Capture",
        source,
        confidence: "high",
        ply: 1,
        moveUci,
        value: 0,
        evidence: `${makeSan(proof.before, proof.move)} removes the last ${captured.role} and immediately draws by insufficient material. ${proof.drawingMoves.length === 1 ? "Every other legal move loses" : "Only captures of this piece draw; every other legal move loses"}, according to Lichess Syzygy. This saves the game, not a material win.`,
    };
}

/** The explicit online action requests either one real root or the existing
 * actual/pass pair. Ordinary scans never make these network requests. */
export function tablebaseTacticalRequests(fen: string, moveUci: string) {
    const capture = drawingCaptureRequest(fen, moveUci);
    if (capture) return { ...capture, kind: "drawingCapture" as const, targets: [capture.fen] };
    const zugzwang = tablebaseZugzwangRequests(fen, moveUci);
    return zugzwang
        ? {
              ...zugzwang,
              kind: "zugzwang" as const,
              targets: [zugzwang.actualFen, zugzwang.passedFen],
          }
        : null;
}

export function proveTablebaseZugzwang(
    fen: string,
    moveUci: string,
    evidence?: TablebaseEvidence | null,
) {
    if (
        evidence?.provider !== "lichess-syzygy" ||
        !Array.isArray(evidence.records) ||
        evidence.records.length > 32
    )
        return null;
    const request = tablebaseZugzwangRequests(fen, moveUci);
    if (!request) return null;
    const actual = verifiedTablebasePosition(request.actualFen, evidence),
        passed = verifiedTablebasePosition(request.passedFen, evidence);
    if (!actual || !passed || !actual.moves.length || !passed.moves.length) return null;
    const beneficiaryActual = -actual.outcome;
    // The passed position changes the side to move but not the move clock.
    // A pass cannot manufacture a new fifty-move draw as the explanation.
    if (beneficiaryActual < 0 || beneficiaryActual <= passed.outcome) return null;
    // Losing moves by the defender may be worse than a drawing best move;
    // do not falsely state that every reply must draw in a drawing resource.
    if (actual.moves.some((reply) => reply.outcome < beneficiaryActual)) return null;
    return {
        beneficiary: request.before.turn,
        defender: request.after.turn,
        outcome: beneficiaryActual === 1 ? ("win" as const) : ("draw" as const),
        passedOutcome: passed.outcome,
        replies: actual.moves.map((reply) => ({
            ...reply,
            san: makeSan(request.after, parseUci(reply.uci)!),
        })),
        pieceCount: request.after.board.occupied.size(),
    };
}

export function verifiedTablebasePosition(fen: string, evidence?: TablebaseEvidence | null) {
    if (
        evidence?.provider !== "lichess-syzygy" ||
        !Array.isArray(evidence.records) ||
        evidence.records.length > 32
    )
        return null;
    const records = evidence.records.filter((record) => record?.fen === fen);
    return records.length === 1 ? validateTablebaseRecord(records[0], fen) : null;
}

export function tablebaseZugzwangEvidence(
    fen: string,
    moveUci: string,
    evidence: TablebaseEvidence | null | undefined,
    source: TacticalMotifEvidence["source"],
): TacticalMotifEvidence | null {
    const proof = proveTablebaseZugzwang(fen, moveUci, evidence);
    if (!proof) return null;
    const request = tablebaseZugzwangRequests(fen, moveUci)!;
    const defender = proof.defender === "white" ? "White" : "Black";
    const passing = proof.passedOutcome === 0 ? "draw" : "win";
    return {
        id: "zugzwang",
        label: proof.outcome === "draw" ? "Drawing Zugzwang" : "Zugzwang",
        source,
        confidence: "high",
        ply: 1,
        moveUci,
        value: 0,
        evidence: `${makeSan(request.before, request.move)} ${proof.outcome === "draw" ? "holds the draw" : "wins the ending"} by zugzwang. ${proof.outcome === "draw" ? "The best defence only draws" : `All ${proof.replies.length} legal replies lose`}; ${defender} would ${passing} if allowed to pass. Both outcomes are verified by ${proof.pieceCount}-piece Lichess Syzygy.`,
    };
}
