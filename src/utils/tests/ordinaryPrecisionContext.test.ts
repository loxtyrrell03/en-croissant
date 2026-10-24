import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import initial from "../../../benchmarks/tactical-relevance/ordinary-precision-v1-selection.json";
import adjacent from "../../../benchmarks/tactical-relevance/ordinary-precision-v1-adjacent-selection.json";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { verifiedTacticalHistory } from "../tacticalMotifs/gameHistory";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Only these independently checked claims are regression judgments. The24
// observational boards are NOT24 positional negatives. Source games are reused
// public development games; the opposite bishop history is constructed.
const contexts = [...initial.cases, ...adjacent.cases];
function context(id: string, reflected: boolean, changedBishop = false) {
    const row = contexts.find(candidate => candidate.id === id)!;
    const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
    const moves = row.history.moves.map(move => changedBishop && move === "c1f4" ? "c1g5" : move).map(flip);
    const tacticalHistory = { fen: reflected ? reflectMixedForkFen(row.history.fen) : row.history.fen, moves };
    const board = Chess.fromSetup(parseFen(tacticalHistory.fen).unwrap()).unwrap();
    let previousFen = makeFen(board.toSetup());
    for (const uci of moves) {
        previousFen = makeFen(board.toSetup());
        const move = parseUci(uci)!;
        if (!board.isLegal(move)) throw new Error(`Illegal public history ${id}: ${uci}`);
        board.play(move);
    }
    const fen = makeFen(board.toSetup());
    expect(verifiedTacticalHistory(tacticalHistory, fen)).not.toBeNull();
    return { flip, fen, row, base: { fen, tacticalHistory, previousFen, previousMoveUci: moves.at(-1)! } };
}

for (const reflected of [false, true]) {
    test(`an opponent's later forced mate does not become the quiet king move's primary; reflected=${reflected}`, () => {
        const { base, flip, row } = context("context:QZDg7vtX:ply45", reflected);
        const steps = replayTacticalLine(base.fen, row.sourceUci.map(flip));
        expect(steps).toHaveLength(4);
        expect(steps[0].before.isCheck()).toBe(true);
        expect(steps[3].after.isCheckmate()).toBe(true);
        const result = classifyPositionTacticalMotifs({ ...base, pvUci: row.sourceUci.map(flip) });
        expect(result.motifs).toEqual([]);
        const mating = (result.timeline ?? []).filter(motif => motif.outcome === "mate");
        expect(mating).toHaveLength(2);
        expect(mating.map(motif => ({ id: motif.id, ply: motif.ply, actor: motif.actor })))
            .toEqual([{ id: "mateIn2", ply: 2, actor: reflected ? "black" : "white" },
                { id: "mateIn1", ply: 4, actor: reflected ? "black" : "white" }]);
    });

    test(`the reached checking move owns its independently forced mate; reflected=${reflected}`, () => {
        const { base, flip, row } = context("context:QZDg7vtX:ply46", reflected);
        const steps = replayTacticalLine(base.fen, row.sourceUci.map(flip));
        expect(steps).toHaveLength(3);
        expect([...steps[0].after.allDests()].reduce((sum, [, destinations]) => sum + destinations.size(), 0)).toBe(1);
        expect(steps[2].after.isCheckmate()).toBe(true);
        for (const line of [row.sourceUci.slice(0, 1), row.sourceUci])
            expect(classifyPositionTacticalMotifs({ ...base, pvUci: line.map(flip) }).motifs[0])
                .toMatchObject({ id: "mateIn2", ply: 1, moveUci: flip("f7f8"), relevance: "primary" });
    });

    test(`the apparent queen defence loses its queen to the exact guarding bishop; reflected=${reflected}`, () => {
        const { base, flip } = context("context:Z1Tw5YR3:ply16", reflected);
        const recapture = replayTacticalLine(base.fen, ["b5c7", "d8c7", "f4c7"].map(flip));
        expect(recapture).toHaveLength(3);
        expect(recapture.map(step => step.capture)).toEqual([100, 320, 900]);
        expect(classifyPositionTacticalMotifs({ ...base, pvUci: [flip("b5c7")] }).motifs[0])
            .toMatchObject({ id: "hangingPiece", value: 100, ply: 1, relevance: "primary" });
    });

    test(`a legal altered development without that bishop defence cannot borrow its punishment; reflected=${reflected}`, () => {
        const { base, flip } = context("context:Z1Tw5YR3:ply16", reflected, true);
        expect(base.tacticalHistory.moves).toContain(flip("c1g5"));
        expect(base.tacticalHistory.moves).not.toContain(flip("c1f4"));
        const refuted = replayTacticalLine(base.fen, ["b5c7", "d8c7"].map(flip));
        expect(refuted).toHaveLength(2);
        expect(refuted[1].after.isLegal(parseUci(flip("f4c7"))!)).toBe(false);
        expect(classifyPositionTacticalMotifs({ ...base, pvUci: [flip("b5c7")] }).motifs
            .filter(motif => motif.ply === 1 && motif.id === "hangingPiece")).toEqual([]);
    });
}
