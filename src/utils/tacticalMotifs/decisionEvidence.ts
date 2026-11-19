import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import type { Color, Role } from "chessops/types";
import { parseUci } from "chessops/util";

const MATERIAL: Record<Role, number> = {
    pawn: 100,
    knight: 320,
    bishop: 330,
    rook: 500,
    queen: 900,
    king: 0,
};

export type DecisionEngineLine = {
    fen: string;
    pvUci: string[];
    depth: number;
    /** Engine evaluation from the side to move in fen. */
    cp: number | null;
    mate?: number | null;
    lowerbound?: boolean;
    upperbound?: boolean;
};

export type DecisionLineEvidence = {
    moves: string[];
    plies: number;
    depth: number;
    evaluationCp: number | null;
    mateDistance: number | null;
    checks: number;
    captures: number;
    promotions: number;
    materialChangeCp: number;
    /** Range over the final four plies, including unsettled recaptures. */
    endingMaterialRangeCp: [number, number];
    quietEndingPlies: number;
    checkmate: boolean;
    drawnEnding: boolean;
};

function material(position: Chess, side: Color) {
    let value = 0;
    for (const [, piece] of position.board) {
        value += MATERIAL[piece.role] * (piece.color === side ? 1 : -1);
    }
    return value;
}

function identity(fen: string) {
    const setup = parseFen(fen);
    if (setup.isErr) return null;
    const position = Chess.fromSetup(setup.value);
    return position.isOk ? makeFen(position.value.toSetup()) : null;
}

/** Measure only a fully legal engine continuation tied to the exact board.
 * Material units remain separate from Stockfish's normalized evaluation units.
 * A PV is a witness line; these measurements do not certify all defences. */
export function measureDecisionLine(
    fen: string,
    line: DecisionEngineLine,
): DecisionLineEvidence | null {
    return replayDecisionEvidence(fen, line, false);
}

function replayDecisionEvidence(
    fen: string,
    line: DecisionEngineLine,
    stopAtInsufficientMaterial: boolean,
): DecisionLineEvidence | null {
    const root = identity(fen);
    if (
        !root ||
        root !== identity(line.fen) ||
        line.lowerbound ||
        line.upperbound ||
        !Number.isInteger(line.depth) ||
        line.depth < 1 ||
        !line.pvUci.length ||
        (line.cp !== null && !Number.isFinite(line.cp)) ||
        (line.mate != null && (!Number.isInteger(line.mate) || line.mate === 0))
    )
        return null;
    const position = Chess.fromSetup(parseFen(root).unwrap()).unwrap();
    const side = position.turn;
    const initial = material(position, side);
    const balance: number[] = [];
    const seen = new Map<string, number>();
    let checks = 0,
        captures = 0,
        promotions = 0,
        quietEndingPlies = 0;
    let repeated = false;
    for (const uci of line.pvUci) {
        if (stopAtInsufficientMaterial && balance.length && position.isInsufficientMaterial())
            break;
        const move = parseUci(uci);
        if (
            !move ||
            !("from" in move) ||
            !position.isLegal(move) ||
            position.isEnd() ||
            repeated ||
            position.halfmoves >= 100
        )
            return null;
        const before = makeFen(position.toSetup()).split(" ").slice(0, 4).join(" ");
        seen.set(before, (seen.get(before) ?? 0) + 1);
        const piece = position.board.get(move.from)!;
        const target = position.board.get(move.to);
        const capture =
            Boolean(target && target.color !== piece.color) ||
            (piece.role === "pawn" && position.epSquare === move.to);
        const promotion = Boolean(move.promotion);
        position.play(move);
        const check = position.isCheck();
        captures += Number(capture);
        promotions += Number(promotion);
        checks += Number(check);
        quietEndingPlies = capture || promotion || check ? 0 : quietEndingPlies + 1;
        balance.push(material(position, side) - initial);
        const after = makeFen(position.toSetup()).split(" ").slice(0, 4).join(" ");
        repeated = (seen.get(after) ?? 0) >= 2;
    }
    const tail = balance.slice(-4);
    return {
        moves: line.pvUci.slice(0, balance.length),
        plies: balance.length,
        depth: line.depth,
        evaluationCp: line.cp,
        mateDistance: line.mate ?? null,
        checks,
        captures,
        promotions,
        materialChangeCp: balance.at(-1)!,
        endingMaterialRangeCp: [Math.min(...tail), Math.max(...tail)],
        quietEndingPlies,
        checkmate: position.isCheckmate(),
        drawnEnding:
            repeated ||
            (!position.isCheckmate() && (position.isEnd() || position.halfmoves >= 100)),
    };
}

/** Some engines append extra moves from a position with insufficient material.
 * Recover the legal prefix of a finite, near-equal paired comparison. This
 * bypasses neither illegality before the draw nor other terminal checks. */
export function endPairedLineAtDeadDraw(fen: string, line: DecisionEngineLine): DecisionEngineLine {
    if (line.cp === null || Math.abs(line.cp) > 50 || line.mate != null) return line;
    const evidence = replayDecisionEvidence(fen, line, true);
    return evidence && evidence.moves.length < line.pvUci.length
        ? { ...line, pvUci: evidence.moves }
        : line;
}

export type PositionDecisionEvidence = {
    lines: DecisionLineEvidence[];
    suppliedCandidates: number;
    legalMoves: number;
    /** Top-line score minus second line, only at matching completed depth. */
    bestSecondGapCp: number | null;
    /** Count applies to the supplied candidates, not every legal move. */
    candidatesWithin50Cp: number | null;
};

export function measurePositionDecision(
    fen: string,
    candidates: DecisionEngineLine[],
): PositionDecisionEvidence | null {
    const root = identity(fen);
    if (!root) return null;
    const position = Chess.fromSetup(parseFen(root).unwrap()).unwrap();
    const lines: DecisionLineEvidence[] = [];
    const moves = new Set<string>();
    for (const candidate of candidates) {
        const line = measureDecisionLine(fen, candidate);
        if (!line) continue;
        const afterRoot = position.clone();
        afterRoot.play(parseUci(line.moves[0])!);
        const rootIdentity = makeFen(afterRoot.toSetup());
        if (moves.has(rootIdentity)) continue;
        moves.add(rootIdentity);
        lines.push(line);
    }
    const first = lines[0],
        second = lines[1];
    const comparable =
        lines.length >= 2 &&
        lines.length === candidates.length &&
        lines.every(
            (line) =>
                line.depth === first.depth &&
                line.evaluationCp !== null &&
                line.mateDistance === null,
        ) &&
        lines.every(
            (line, index) => index === 0 || line.evaluationCp! <= lines[index - 1].evaluationCp!,
        );
    let legalMoves = 0;
    for (const [, destinations] of position.allDests()) legalMoves += destinations.size();
    // Each promotion square supplies four legal choices.
    const promotionRank = position.turn === "white" ? 7 : 0;
    for (const [from, destinations] of position.allDests()) {
        if (position.board.get(from)?.role === "pawn") {
            for (const to of destinations)
                if (Math.floor(to / 8) === promotionRank) legalMoves += 3;
        }
    }
    return {
        lines,
        suppliedCandidates: candidates.length,
        legalMoves,
        bestSecondGapCp: comparable ? first.evaluationCp! - second.evaluationCp! : null,
        candidatesWithin50Cp: comparable
            ? lines.filter((line) => line.evaluationCp! >= first.evaluationCp! - 50).length
            : null,
    };
}

export type DecisionConsequence = {
    consequence: "material-difference" | "similar-material" | "unresolved";
    reason: string;
    evaluationLossCp: number | null;
    materialDifferenceCp: number | null;
    best: DecisionLineEvidence | null;
    played: DecisionLineEvidence | null;
};

/** An engine-backed estimate of the difference between two choices. The
 * comparison is relative to the original material balance in both branches.
 * Confidence is limited by the supplied searches and the continuation horizon. */
export function compareDecisionConsequences(
    fen: string,
    bestLine: DecisionEngineLine,
    playedLine: DecisionEngineLine,
): DecisionConsequence {
    const best = measureDecisionLine(fen, bestLine);
    const played = measureDecisionLine(fen, playedLine);
    const result: DecisionConsequence = {
        consequence: "unresolved",
        reason: "The supplied continuations do not support a settled material comparison.",
        evaluationLossCp: null,
        materialDifferenceCp: null,
        best,
        played,
    };
    if (
        !best ||
        !played ||
        best.moves[0] === played.moves[0] ||
        best.depth < 16 ||
        played.depth < 16 ||
        best.drawnEnding ||
        played.drawnEnding ||
        best.evaluationCp === null ||
        played.evaluationCp === null ||
        best.mateDistance !== null ||
        played.mateDistance !== null
    )
        return result;
    result.evaluationLossCp = best.evaluationCp - played.evaluationCp;
    if (result.evaluationLossCp <= 20) return result;
    // End after recaptures have settled. A transient queen/piece capture or a
    // checking tail must not turn a balanced exchange into a material-loss claim.
    const settled = (line: DecisionLineEvidence) =>
        line.plies >= 8 &&
        line.quietEndingPlies >= 3 &&
        line.endingMaterialRangeCp[0] === line.endingMaterialRangeCp[1];
    if (!settled(best) || !settled(played)) return result;
    result.materialDifferenceCp = best.materialChangeCp - played.materialChangeCp;
    if (result.evaluationLossCp >= 50 && result.materialDifferenceCp >= 90) {
        return {
            ...result,
            consequence: "material-difference",
            reason: `The engine's better continuation retains ${result.materialDifferenceCp / 100} more material points than the played continuation after exchanges settle (${best.plies} and ${played.plies} plies). This measures the material consequence in the supplied lines.`,
        };
    }
    if (
        Math.abs(result.materialDifferenceCp) <= 50 &&
        best.checks <= 1 &&
        played.checks <= 1 &&
        best.promotions === 0 &&
        played.promotions === 0
    ) {
        return {
            ...result,
            consequence: "similar-material",
            reason: `The engine evaluation falls by ${(result.evaluationLossCp / 100).toFixed(2)} while the two settled continuations differ by at most 0.50 material points (${best.plies} and ${played.plies} plies). Each line has at most one check. The decision's tactical and positional dependencies require further evidence.`,
        };
    }
    return result;
}
