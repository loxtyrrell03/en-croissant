import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { MAX_TACTICAL_HISTORY_PLIES } from "../tacticalMotifs/gameHistory";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const fen = "6k1/4r1q1/N2R1pp1/1B3b2/5pP1/4Q3/PPr4P/6K1 w - - 0 32";
const line = ["d6d8", "g8h7", "e3h3", "g7h6", "d8h8", "h7h8", "h3h6"];

for (const mirror of [false, true]) {
    const origin = mirror ? reflectMixedForkFen(fen) : fen;
    const moves = mirror ? line.map(reflectMixedForkMove) : line;
    const steps = replayTacticalLine(origin, moves);
    const current = { fen: makeFen(steps[6].before.toSetup()), pvUci: moves.slice(6) };
    const history = { fen: origin, moves: moves.slice(0, 6) };
    for (const [name, bad] of Object.entries({
        "illegal prefix": { ...history, moves: ["a1a8", ...history.moves] },
        "illegal middle": { ...history, moves: [...history.moves.slice(0, 2), "a1a8", ...history.moves.slice(2)] },
        "missing offer": { fen: makeFen(steps[5].before.toSetup()), moves: [moves[5]] },
        "future capture included": { ...history, moves },
        "different reached clock": { ...history, fen: origin.replace(/ \d+ \d+$/, " 0 99") },
        "overlong": { ...history, moves: Array(MAX_TACTICAL_HISTORY_PLIES + 1).fill(moves[0]) as string[] },
    })) {
        test(`${name} cannot invent deflection compensation, mirror=${mirror}`, () => {
            const result = classifyPositionTacticalMotifs({ ...current, tacticalHistory: bad });
            expect(result.motifs[0]).toMatchObject({ id: "hangingPiece", value: 900 });
            expect(result.motifs[0]?.label).not.toBe("Deflection Payoff");
        });
    }
    test(`normal previous-move context agrees with exact full history, mirror=${mirror}`, () => {
        const result = classifyPositionTacticalMotifs({ ...current, tacticalHistory: history,
            previousFen: makeFen(steps[5].before.toSetup()), previousMoveUci: moves[5] });
        expect(result.motifs[0]).toMatchObject({ id: "hangingPiece", label: "Deflection Payoff" });
        expect(result.motifs[0]?.value).toBeUndefined();
    });
}

test("public mating deflection independently closes both legal defences", () => {
    const start = "1r3rk1/p1pn1ppp/b4b2/6q1/3PB3/1P2P2P/PBPN1P2/R2QK2R b KQ - 2 15";
    const root = replayTacticalLine(start, ["g5e3"])[0];
    const replies = [...root.after.allDests()].flatMap(([from, to]) => [...to].map(dest => [from, dest]));
    expect(replies).toHaveLength(2);
    for (const pv of [["g5e3", "f2e3", "f6h4"], ["g5e3", "d1e2", "e3e2"]]) {
        const replay = replayTacticalLine(start, pv);
        expect(replay).toHaveLength(3);
        expect(replay[2].after.isCheckmate()).toBe(true);
        const result = classifyPositionTacticalMotifs({ fen: start, pvUci: pv });
        expect(result.motifs[0]).toMatchObject({ id: "mateIn2", value: 10000 });
        expect(result.motifs.find(m => m.id === "deflection")?.value).toBeUndefined();
    }
});
