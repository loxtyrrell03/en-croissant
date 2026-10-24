import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSquare, parseUci } from "chessops/util";
import { proveTrappedMaterial, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Fresh public FSJC4 nominates a real queen trap. Clock variants are explicitly
// constructed controls, not claims about the source game's actual history.
const sourceFen = "6k1/2q2pp1/Q1pb3p/3b4/2PP3B/4rP2/P2N2P1/R6K b - - 0 30";
const sourceLine = ["e3a3", "a6a3", "d6a3"];
const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

for (const reflected of [false, true]) {
    const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
    const fenAt = (clock: number, capture = false) => {
        const board = position(reflected ? reflectMixedForkFen(sourceFen) : sourceFen);
        board.halfmoves = clock;
        if (capture) board.board.set(parseSquare(flip("a3"))!, {
            role: "pawn", color: board.turn === "white" ? "black" : "white",
        });
        return makeFen(board.toSetup());
    };
    const target = parseSquare(flip("a6"))!;

    for (const clock of [0, 97]) test(`real trap survives normal clock and optional attacker claim; clock=${clock}, reflected=${reflected}`, () => {
        const fen = fenAt(clock), steps = replayTacticalLine(fen, sourceLine.map(flip));
        expect(steps).toHaveLength(3);
        const proof = proveTrappedMaterial(steps[0], target);
        expect(proof?.gain).toBe(170);
        expect(proof?.branches).toHaveLength(33);
        // At clock97 White's quiet reply reaches99 on BLACK's turn. Black can
        // decline its own claim/announced move and reset the count with Rxa6.
        const quiet = replayTacticalLine(fen, ["e3a3", "a1b1", "a3a6"].map(flip));
        expect(quiet).toHaveLength(3);
        expect(quiet[1].after.halfmoves).toBe(clock + 2);
        expect(quiet[2].after.halfmoves).toBe(0);
        expect(classifyPositionTacticalMotifs({ fen, pvUci: sourceLine.map(flip) }).motifs[0])
            .toMatchObject({ id: "trappedPiece", ply: 1, value: 170 });
    });

    for (const clock of [98, 99, 149, 150]) test(`trap cannot outrun defender claim or automatic ending; clock=${clock}, reflected=${reflected}`, () => {
        const fen = fenAt(clock), steps = replayTacticalLine(fen, ["e3a3", "a1b1"].map(flip));
        expect(steps).toHaveLength(2);
        expect(steps[0].capture).toBe(0);
        expect(steps[0].after.halfmoves).toBe(clock + 1);
        // Rb1 is a legal non-capture, non-pawn announced reply at clock99.
        // At100 the claim is current; at150 the draw is automatic already.
        expect(steps[1].capture).toBe(0);
        expect(steps[1].after.halfmoves).toBe(clock + 2);
        expect(proveTrappedMaterial(steps[0], target)).toBeNull();
        const classified = classifyPositionTacticalMotifs({ fen, pvUci: [flip("e3a3")] });
        expect(classified.motifs.filter(motif => motif.id === "trappedPiece")).toEqual([]);
    });

    for (const clock of [99, 149]) test(`actual initiating capture resets clock before defender can claim; clock=${clock}, reflected=${reflected}`, () => {
        const fen = fenAt(clock, true), root = replayTacticalLine(fen, [flip("e3a3")])[0];
        expect(root.before.isLegal(parseUci(flip("e3a3"))!)).toBe(true);
        expect(root.capture).toBe(100);
        expect(root.after.halfmoves).toBe(0);
        expect(proveTrappedMaterial(root, target)?.gain).toBe(270);
        expect(classifyPositionTacticalMotifs({ fen, pvUci: [flip("e3a3")] }).motifs[0])
            .toMatchObject({ id: "trappedPiece", ply: 1, value: 270 });
    });

    test(`capture cannot revive a game already ended at150; reflected=${reflected}`, () => {
        const fen = fenAt(150, true), root = replayTacticalLine(fen, [flip("e3a3")])[0];
        expect(root.capture).toBe(100);
        expect(root.after.halfmoves).toBe(0);
        expect(proveTrappedMaterial(root, target)).toBeNull();
        expect(classifyPositionTacticalMotifs({ fen, pvUci: [flip("e3a3")] }).motifs
            .filter(motif => motif.id === "trappedPiece")).toEqual([]);
    });

    for (const clock of [98, 99, 149, 150]) test(`full supplied exchange cannot recover a claim-defeated trap payoff; clock=${clock}, reflected=${reflected}`, () => {
        const result = classifyPositionTacticalMotifs({ fen: fenAt(clock), pvUci: sourceLine.map(flip) });
        expect(result.motifs).toEqual([]);
        expect(result.timeline ?? []).toEqual([]);
    });

    for (const clock of [99, 149]) test(`a pawn attack legitimately resets the trap clock; clock=${clock}, reflected=${reflected}`, () => {
        const original = `k7/8/8/6p1/7b/8/6PP/7K w - - ${clock} 1`;
        const fen = reflected ? reflectMixedForkFen(original) : original;
        const steps = replayTacticalLine(fen, ["g2g3", "h4g3", "h2g3"].map(flip));
        expect(steps).toHaveLength(3);
        expect(steps[0].capture).toBe(0);
        expect(steps[0].after.halfmoves).toBe(0);
        expect(proveTrappedMaterial(steps[0], parseSquare(flip("h4"))!)?.gain).toBe(230);
        expect(classifyPositionTacticalMotifs({ fen, pvUci: [flip("g2g3")] }).motifs[0])
            .toMatchObject({ id: "trappedPiece", ply: 1, value: 230 });
    });

    test(`checkmate still precedes an automatic move-count draw; reflected=${reflected}`, () => {
        const original = "7k/8/5KQ1/8/8/8/8/8 w - - 149 1";
        const fen = reflected ? reflectMixedForkFen(original) : original;
        const root = replayTacticalLine(fen, [flip("g6g7")])[0];
        expect(root.after.halfmoves).toBe(150);
        expect(root.after.isCheckmate()).toBe(true);
        expect(classifyPositionTacticalMotifs({ fen, pvUci: [flip("g6g7")] }).motifs[0]?.id).toBe("mateIn1");
    });
}
