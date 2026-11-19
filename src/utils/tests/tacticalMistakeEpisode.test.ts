import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { compareTacticalMistakeEpisode } from "../tacticalMotifs/tacticalMistakeEpisode";

const fen = "r7/4k3/4p3/8/8/2N5/7P/6K1 w - - 0 1";
const better = {
    fen,
    cp: -100,
    depth: 18,
    pvUci: ["c3b5", "e7f7", "g1f2", "f7g6", "f2g3", "a8a1"],
};
const actual = {
    fen,
    cp: -410,
    depth: 18,
    pvUci: ["c3d5", "e6d5", "g1g2", "e7f6", "g2f3", "f6e5", "h2h3"],
};
const after = (uci: string) => makeFen(replayTacticalLine(fen, [uci])[0].after.toSetup());
const reply = { ...actual, fen: after("c3d5"), cp: 408, pvUci: actual.pvUci.slice(1) };
const betterReply = { ...better, fen: after("c3b5"), cp: 100, pvUci: better.pvUci.slice(1) };

test("a stable early loss of a knight has a concrete counterfactual and matching variation lengths", () => {
    const episode = compareTacticalMistakeEpisode(fen, better, actual, reply, betterReply);
    expect(episode).toMatchObject({
        throughPly: 5,
        materialDifferencePoints: 3.2,
        playedLineUci: actual.pvUci.slice(0, 5),
        betterLineUci: better.pvUci.slice(0, 5),
        mechanisms: [],
    });
    const report = assessChessDecision({
        fen,
        candidates: [better, actual],
        playedMoveUci: actual.pvUci[0],
        replyProbes: [{ moveUci: actual.pvUci[0], lines: [reply] }],
    });
    expect(report?.mistake).toMatchObject({ category: "tactical", tacticalEpisode: episode });
    expect(report?.moves[0].tactical.support).toBe("unestablished");
});

test("a wrong reply board or unstable reply evaluation cannot establish a mistake episode", () => {
    expect(
        compareTacticalMistakeEpisode(fen, better, actual, { ...reply, fen }, betterReply),
    ).toBeNull();
    const report = assessChessDecision({
        fen,
        candidates: [better, actual],
        playedMoveUci: actual.pvUci[0],
        replyProbes: [{ moveUci: actual.pvUci[0], lines: [{ ...reply, cp: 90 }] }],
    });
    expect(report?.mistake?.tacticalEpisode).toBeUndefined();
    expect(report?.mistake?.category).toBe("unclear");
});

test("an ordinary capture available on both boards does not establish the cause", () => {
    const unchanged = "r7/4k3/8/4p3/3N4/8/7P/6K1 w - - 0 1";
    const bad = {
        ...actual,
        fen: unchanged,
        pvUci: ["g1g2", "e5d4", "g2f3", "e7f6", "f3g3", "f6e5"],
    };
    const good = {
        ...better,
        fen: unchanged,
        pvUci: ["g1f2", "e5d4", "f2g3", "e7f6", "h2h3", "f6e5"],
    };
    const replyFor = (line: typeof bad) => ({
        ...line,
        fen: makeFen(replayTacticalLine(unchanged, line.pvUci.slice(0, 1))[0].after.toSetup()),
        cp: -line.cp,
        pvUci: line.pvUci.slice(1),
    });
    expect(
        compareTacticalMistakeEpisode(unchanged, good, bad, replyFor(bad), replyFor(good)),
    ).toBeNull();
});
