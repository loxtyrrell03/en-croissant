import { expect, test } from "vitest";
import { findQuietMateInTwoThreat } from "../tacticalMotifs/decisionQuietMateInTwo";
import fixtures from "../../../benchmarks/decision-evidence/quiet-mate-in-two/fixtures.json";

test("checks a quiet preparation and a separate legal mate after it", () => {
    const { fen, candidates, replyProbes, history } = fixtures.mixed;
    const replies = replyProbes[0].lines;
    const result = findQuietMateInTwoThreat(fen, candidates[0], replies, history);
    expect(result).toMatchObject({
        mateIn: 2,
        exampleWasSearched: false,
        ignoredLineUci: ["g4h4", "a6a5", "h4h6", "f8h7", "h6g7"],
        defenceLinesUci: [["g4h4", "d6d2"]],
    });
    expect(findQuietMateInTwoThreat(fen, candidates[0], replies, history, "searched")).toBeNull();
});

test("keeps both defences when the independent search takes a different route", () => {
    const { fen, candidates, replyProbes, history } = fixtures.differentDefences;
    const chosen = candidates.find((line) => line.pvUci[0] === "d8h8")!;
    const probe = replyProbes.find((item) => item.moveUci === "d8h8")!;
    const result = findQuietMateInTwoThreat(fen, chosen, probe.lines, history);
    expect(result?.defenceLinesUci).toHaveLength(2);
    expect(result?.explanation).toMatch(/Nf1 and Rf1 stop/);
});

test("abstains on a cooperative mating line and keeps immediate threats separate", () => {
    for (const input of [fixtures.refutable, fixtures.immediate]) {
        const chosen =
            input.candidates.find((line) => line.pvUci[0] === input.gameMoveUci) ?? input.focused!;
        const probe = input.replyProbes.find((item) => item.moveUci === input.gameMoveUci)!;
        expect(findQuietMateInTwoThreat(input.fen, chosen, probe.lines, input.history)).toBeNull();
    }
});

test("abstains on a wrong reply board or a mismatched game history", () => {
    const { fen, candidates, replyProbes, history } = fixtures.mixed;
    expect(
        findQuietMateInTwoThreat(
            fen,
            candidates[0],
            [{ ...replyProbes[0].lines[0], fen }],
            history,
        ),
    ).toBeNull();
    expect(
        findQuietMateInTwoThreat(fen, candidates[0], replyProbes[0].lines, {
            fen: history.fen,
            moves: [],
        }),
    ).toBeNull();
});
