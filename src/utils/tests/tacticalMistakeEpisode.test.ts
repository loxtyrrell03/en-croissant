import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import youthCapture from "../../../benchmarks/decision-evidence/reply-search-allocation/european-youth.json";
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
    expect(episode?.explanation).toContain("That capture is unavailable after Nb5");
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

test("a refuted leading alternative makes the position tactical even without a played move", () => {
    const input = { fen, candidates: [better, actual] };
    expect(assessChessDecision(input)?.position.tacticalContrast).toBeUndefined();
    const positionReply = { moveUci: actual.pvUci[0], lines: [reply] };
    const report = assessChessDecision({ ...input, positionReply });
    expect(report?.mistakeStatus).toBe("not-requested");
    expect(report?.moves[0].tactical.support).toBe("unestablished");
    expect(report?.position).toMatchObject({
        category: "tactical",
        tacticalContrast: {
            playedLineUci: actual.pvUci.slice(0, 5),
            betterLineUci: better.pvUci.slice(0, 5),
        },
    });
    const disagreement = { ...reply, cp: 180 };
    expect(
        assessChessDecision({
            ...input,
            positionReply: { ...positionReply, lines: [disagreement] },
        })?.position.tacticalContrast,
    ).toBeUndefined();
});

test("refuting a much worse third move does not establish tactical demand on the board", () => {
    const plausible = { ...better, cp: -120, pvUci: ["c3a4", "e7f7", "g1f2", "f7g6", "f2g3"] };
    const report = assessChessDecision({
        fen,
        candidates: [better, plausible, actual],
        positionReply: { moveUci: actual.pvUci[0], lines: [reply] },
    });
    expect(report?.position.tacticalContrast).toBeUndefined();
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

const exchangeRoot = "2r2rk1/p6p/1q1pnp2/Np1B1p2/5P1P/PP2P1P1/3Q4/R2n2K1 b - - 0 30";
const saveKnight = {
    fen: exchangeRoot,
    depth: 26,
    cp: 653,
    pvUci: [
        "d1e3",
        "d5e6",
        "g8h8",
        "e6c8",
        "f8c8",
        "a1c1",
        "e3g4",
        "g1h1",
        "c8c1",
        "d2c1",
        "b6f2",
        "c1g1",
        "f2f3",
    ],
};
const concedeKnight = {
    fen: exchangeRoot,
    depth: 26,
    cp: 372,
    pvUci: [
        "c8c3",
        "a1d1",
        "c3e3",
        "g1h2",
        "g8h8",
        "d1e1",
        "e3e1",
        "d2e1",
        "f8e8",
        "d5c6",
        "e8e7",
        "c6d5",
        "b6c5",
    ],
};
const exchangeAfter = (line: typeof saveKnight) => ({
    ...line,
    fen: makeFen(replayTacticalLine(exchangeRoot, [line.pvUci[0]])[0].after.toSetup()),
    cp: -line.cp,
    pvUci: line.pvUci.slice(1),
});
const exchangeReply = { ...exchangeAfter(concedeKnight), depth: 19, cp: -403 };

test("reports the local concession when a different trade distorts the better branch's material count", () => {
    const report = assessChessDecision({
        fen: exchangeRoot,
        candidates: [saveKnight, concedeKnight],
        playedMoveUci: concedeKnight.pvUci[0],
        replyProbes: [{ moveUci: concedeKnight.pvUci[0], lines: [exchangeReply] }],
    });
    expect(report?.mistake?.tacticalEpisode).toMatchObject({
        kind: "concession",
        materialConcededPoints: 2.2,
        throughPly: 6,
        betterLineUci: saveKnight.pvUci.slice(0, 6),
        playedLineUci: concedeKnight.pvUci.slice(0, 6),
    });
    expect(report?.mistake?.tactical.reasons[0]).toContain("Rxd1 takes the knight on d1");
    expect(report?.mistake?.tactical.reasons[0]).toContain("Both searches");
});

test("does not reuse a local material claim when the paired search has a different refutation", () => {
    const different = {
        ...concedeKnight,
        pvUci: ["c8c3", "d5e6", "g8h8", "a1d1", "c3e3", "g1h2", "f8e8", "d2f2"],
    };
    expect(
        compareTacticalMistakeEpisode(
            exchangeRoot,
            saveKnight,
            different,
            exchangeReply,
            exchangeAfter(saveKnight),
        ),
    ).toBeNull();
});

test("a later settled recovery in either search disqualifies the earlier net loss", () => {
    const recovers = {
        ...concedeKnight,
        pvUci: [...concedeKnight.pvUci.slice(0, 8), "b6a5", "d5c6", "f8e8", "h2h3", "a5c3"],
    };
    expect(
        compareTacticalMistakeEpisode(
            exchangeRoot,
            saveKnight,
            recovers,
            exchangeReply,
            exchangeAfter(saveKnight),
        ),
    ).toBeNull();
});

test("names the legal recapture that saves an advanced pawn", () => {
    const report = assessChessDecision(youthCapture);
    expect(report?.position.category).toBe("mixed");
    expect(report?.position.tacticalContrast).toMatchObject({
        kind: "comparative",
        explanation: "Rxa2 takes the pawn on a2. After Bd5, Rxa2 can be answered by Bxa2.",
    });
});
