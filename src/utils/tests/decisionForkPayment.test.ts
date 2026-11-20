import { expect, test } from "vitest";
import fixtures from "../../../benchmarks/decision-evidence/fork-defence-concession/fixtures.json";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { findForkWithPaidDefence } from "../tacticalMotifs/decisionForkPayment";

test.each([
    {
        fixture: fixtures.checking,
        primary: "Qxf6",
        alternative: "Kf7",
        gain: "4.7 material points",
    },
    { fixture: fixtures.promotion, primary: "Rxd8", alternative: "Kh7", gain: "4 material points" },
    { fixture: fixtures.quiet, primary: "Bxc4", alternative: "Qd4", gain: "1.3 material points" },
])("corroborates material paid by $primary", ({ fixture, primary, alternative, gain }) => {
    const report = assessChessDecision({
        fen: fixture.fen,
        candidates: fixture.paired,
        replyProbes: fixture.withReplies,
    });
    const evidence = report?.moves.find((move) => move.moveUci === fixture.move)?.conditionalFork;
    expect(evidence).toMatchObject({
        mechanism: "fork",
        mechanismPly: 1,
        payoffPly: 3,
        weakerReplySan: alternative,
        defenceConsequence: { kind: "material", description: expect.stringContaining(gain) },
    });
    expect(evidence!.defenceConsequence!.description).toContain(primary);
    expect(evidence!.bestReplyLineUci.slice(0, 3)).toEqual(fixture.paired[0].pvUci.slice(0, 3));
    expect(report?.position.tactical.support).toBe("supported");
});

test("an equal recapture cannot spend the initial capture a second time", () => {
    const fixture = fixtures.equalExchange;
    expect(
        findForkWithPaidDefence(fixture.fen, fixture.paired[0], fixture.withReplies[0].lines),
    ).toBeNull();
});

test("the separate search must be exact and confirm the same recapture", () => {
    const fixture = fixtures.checking;
    const [best, alternative] = fixture.withReplies[0].lines;
    const [root] = fixture.paired;
    expect(findForkWithPaidDefence(fixture.fen, root, [best])).toBeNull();
    expect(
        findForkWithPaidDefence(fixture.fen, root, [{ ...best, upperbound: true }, alternative]),
    ).toBeNull();
    expect(
        findForkWithPaidDefence(fixture.fen, root, [
            { ...best, pvUci: [best.pvUci[0]] },
            alternative,
        ]),
    ).toBeNull();
    expect(
        findForkWithPaidDefence(fixture.fen, { ...root, fen: best.fen }, [best, alternative]),
    ).toBeNull();
});
