import { expect, test } from "vitest";
import examples from "../../../benchmarks/decision-evidence/pawn-lock-reply/examples.json";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";

const { tactical, strategic } = examples;

test("a credible reply can use the same pawn to fork instead of retaining a lock", () => {
    const report = assessChessDecision(tactical);
    expect(report?.position.category).toBe("tactical");
    expect(report?.position.tactical.support).toBe("supported");
    expect(report?.position.mechanisms).toEqual(
        expect.arrayContaining([expect.objectContaining({ mechanism: "fork", payoffPly: 3 })]),
    );
    const leading = report?.moves[0];
    expect(leading?.category).toBe("tactical");
    expect(leading?.positionalFactors.some((factor) => factor.feature === "pawn-lock")).toBe(false);
    expect(leading?.limitations).toContain(
        "In a close reply, the pawn leaves the lock to take a piece. This line illustrates the pawn's tactical role.",
    );
});

test("an inferior or missing reply cannot rebut the observed lock", () => {
    const [probe] = tactical.replyProbes;
    const bestOnly = assessChessDecision({
        ...tactical,
        replyProbes: [{ ...probe, lines: [probe.lines[0]] }],
    });
    expect(bestOnly?.position.positionalFactors).toEqual(
        expect.arrayContaining([expect.objectContaining({ feature: "pawn-lock" })]),
    );
    const inferior = assessChessDecision({
        ...tactical,
        replyProbes: [
            {
                ...probe,
                lines: probe.lines.map((line, i) =>
                    i ? { ...line, cp: probe.lines[0].cp! - 100 - i } : line,
                ),
            },
        ],
    });
    expect(inferior?.moves[0].positionalFactors).toEqual(
        expect.arrayContaining([expect.objectContaining({ feature: "pawn-lock" })]),
    );
});

test("an inferior reply that takes the advancing pawn still allows a separate strategic plan", () => {
    const report = assessChessDecision(strategic);
    expect(report?.position.positional.support).toBe("supported");
    expect(report?.position.positionalFactors).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ feature: "pawn-lock", squareOrFile: "b" }),
        ]),
    );
});
