import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci, parseSquare } from "chessops/util";
import {
    proveQuietTacticalPreparation,
    replayTacticalLine,
} from "../../src/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../../src/utils/tacticalMotifs/liveTactics";

// Public DEVELOPMENT nomination GrHPv, not an untouched holdout or a gold
// interference label. These contracts preserve abstention pending a causal
// certificate; they do not adjudicate Ra1 as positional or a bad move.
const fen = "5k2/5q1p/6p1/3pQp2/1prP4/7P/6P1/1R4K1 w - - 3 43";
const line = ["b1a1", "c4c8", "a1a7", "f7a7", "e5h8", "f8f7", "h8h7", "f7f6", "h7a7"];
const previousFen = "6k1/5q1p/6p1/3pQp2/1prP4/7P/6P1/1R4K1 b - - 2 42";
const flip = (text: string) => text.replace(/[1-8]/g, rank => String(9 - Number(rank)));
function reflect(position: string, moves: string[], mirrored: boolean) {
    if (!mirrored) return { fen: position, pvUci: moves };
    const fields = position.split(" ");
    fields[0] = fields[0].split("/").reverse().join("/").replace(/[a-zA-Z]/g,
        c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
    fields[1] = fields[1] === "w" ? "b" : "w";
    return { fen: fields.join(" "), pvUci: moves.map(flip) };
}

for (const mirrored of [false, true]) {
    for (const length of [1, 2, 3, 9]) {
        test(`unresolved preparation stays unknown, prefix=${length}, mirrored=${mirrored}`, () => {
            const row = reflect(fen, line.slice(0, length), mirrored);
            const steps = replayTacticalLine(row.fen, row.pvUci);
            expect(steps).toHaveLength(length);
            expect(proveQuietTacticalPreparation(steps)).toBeNull();
            expect(classifyPositionTacticalMotifs({ ...row, rootCp: 410 }).motifs).toEqual([]);
        });
    }
    test(`live scan does not invent root arrows from a cooperative tail, mirrored=${mirrored}`, () => {
        const row = reflect(fen, line, mirrored);
        const scan = buildLiveTacticalScan({ ...row, depth: 16, engineName: "Public development adjudication",
            variations: [{ pvUci: row.pvUci, cp: 410, depth: 16, multipv: 1 }] });
        expect(scan.motifs).toEqual([]);
        expect(scan.arrows).toEqual([]);
        expect(scan.labels).toEqual([]);
    });
    test(`legal previous history does not supply the missing causal proof, mirrored=${mirrored}`, () => {
        const previous = reflect(previousFen, ["g8f8"], mirrored);
        // Reflection changes which colour increments the fullmove counter.
        if (mirrored) previous.fen = previous.fen.replace("2 42", "2 43");
        const row = reflect(fen, line, mirrored);
        expect(makeFen(replayTacticalLine(previous.fen, previous.pvUci)[0].after.toSetup())).toBe(row.fen);
        expect(classifyPositionTacticalMotifs({ ...row, rootCp: 410,
            previousFen: previous.fen, previousMoveUci: previous.pvUci[0] }).motifs).toEqual([]);
    });
    test(`review does not blame a missed tactic using unproved root nomination, mirrored=${mirrored}`, () => {
        const row = reflect(fen, line, mirrored);
        const result = classifyMistakeReviewMotifs({ ...row, bestMoveUci: row.pvUci[0],
            playedMoveUci: mirrored ? flip("b1e1") : "b1e1",
            refutationUci: [mirrored ? flip("f8g8") : "f8g8"],
            cpBefore: mirrored ? -410 : 410, cpAfter: 0, cpLoss: 410 });
        expect(buildMistakeReviewTacticalExplanation(result)).toBeNull();
    });
    test(`interference geometry belongs to conditional Qh8+, not Ra1, mirrored=${mirrored}`, () => {
        const row = reflect(fen, line, mirrored);
        const steps = replayTacticalLine(row.fen, row.pvUci);
        const check = steps[4];
        expect(check.after.isCheck()).toBe(true);
        const replies = [...check.after.allDests()].flatMap(([from, tos]) => [...tos].map(to => ({ from, to })));
        expect(replies.map(makeUci).sort()).toEqual((mirrored ? ["f1e2", "f1f2"] : ["f8e7", "f8f7"]).sort());
        for (const reply of replies) {
            const position = check.after.clone();
            position.play(reply);
            const capture = { from: parseSquare(mirrored ? "h1" : "h8")!, to: parseSquare(mirrored ? "h2" : "h7")! };
            expect(position.isLegal(capture)).toBe(true);
            expect(position.board.get(capture.to)?.role).toBe("pawn");
            position.play(capture);
            expect(position.isCheck()).toBe(true);
            const kingReplies = [...position.allDests()].flatMap(([from, tos]) => [...tos].map(to => ({ from, to })));
            expect(kingReplies.length).toBeGreaterThan(0);
            for (const flight of kingReplies) {
                const after = position.clone(); after.play(flight);
                const queenCapture = { from: capture.to, to: parseSquare(mirrored ? "a2" : "a7")! };
                expect(after.board.get(queenCapture.to)?.role).toBe("queen");
                expect(after.isLegal(queenCapture)).toBe(true);
            }
        }
    });
    for (const move of ["b1c1", "b1d1", "b1e1", "b1f1", "b1b2", "b1b3"]) {
        test(`unrelated rook activity is not this preparation: ${move}, mirrored=${mirrored}`, () => {
            const row = reflect(fen, [move], mirrored);
            expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(1);
            expect(classifyPositionTacticalMotifs({ ...row, rootCp: 410 }).motifs.some(m =>
                m.ply === 1 && ["tacticalPreparation", "forcingAttack", "interference"].includes(m.id))).toBe(false);
        });
    }
    for (const clock of [98, 99]) {
        test(`a legal draw claim cannot license the preparation, clock=${clock}, mirrored=${mirrored}`, () => {
            const row = reflect(fen.replace("3 43", `${clock} 43`), line, mirrored);
            expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(line.length);
            expect(classifyPositionTacticalMotifs({ ...row, rootCp: 410 }).motifs).toEqual([]);
        });
    }
}
