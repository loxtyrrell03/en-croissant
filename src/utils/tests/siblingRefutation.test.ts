import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { DecisionAssessmentInput } from "../tacticalMotifs/decisionAssessment";
import {
    confirmSiblingRefutation,
    nominateSiblingRefutation,
    type SiblingRefutationFrames,
} from "../tacticalMotifs/decisionSiblingRefutation";

const { bavaria, arequipa } = JSON.parse(
    readFileSync("benchmarks/decision-evidence/sibling-refutation/fixture.json", "utf8"),
) as Record<
    string,
    {
        input: DecisionAssessmentInput;
        causal: SiblingRefutationFrames;
        similar?: SiblingRefutationFrames;
    }
>;

test("a refuted third choice matters even with two competitive root choices", () => {
    const { fen, candidates } = bavaria.input;
    const request = nominateSiblingRefutation(fen, candidates)!;
    expect(request).toMatchObject({ replyUci: "d4b5", relation: "attacker" });
    expect(confirmSiblingRefutation(fen, request, bavaria.causal)?.explanation).toMatch(
        /Qc8 allows Nxb5.*Nxd4 removes the piece/,
    );
});

test("the same capture is allowed but loses its gain after the similar sound move", () => {
    const { fen, candidates } = bavaria.input;
    const request = nominateSiblingRefutation(fen, candidates, "similar")!;
    expect(request).toMatchObject({ relation: "similar", controlFen: expect.any(String) });
    expect(confirmSiblingRefutation(fen, request, bavaria.similar!)).toMatchObject({
        controlLineUci: ["f5d7", "d4b5", "d7b5", expect.any(String)],
        explanation: expect.stringMatching(/After Qd7, the same capture allows Qxb5/),
    });
    expect(confirmSiblingRefutation(fen, request, bavaria.causal)).toBeNull();
});

test.each(["same-root", "off-depth", "noncompetitive", "wrong-board"])(
    "a %s root cannot be used as the third candidate comparison",
    (defect) => {
        const { fen, candidates } = bavaria.input;
        const input = structuredClone(candidates);
        if (defect === "same-root") input[2] = input[1];
        if (defect === "off-depth") input[2].depth--;
        if (defect === "noncompetitive") input[1].cp = input[0].cp! - 76;
        if (defect === "wrong-board") input[2].fen = input[2].fen.replace(" b ", " w ");
        expect(nominateSiblingRefutation(fen, input)).toBeNull();
    },
);

test("a separate reply must start with the same legal capture and stay in the scored range", () => {
    const { fen, candidates } = arequipa.input;
    const request = nominateSiblingRefutation(fen, candidates)!;
    expect(
        confirmSiblingRefutation(fen, request, arequipa.causal, arequipa.input.history)
            ?.explanation,
    ).toMatch(/Bxd8 allows Bxc2.*Qc1 keeps the original queen/);
    const unrelated = { ...arequipa.causal.reply, fen: bavaria.causal.reply.fen };
    expect(confirmSiblingRefutation(fen, request, { reply: unrelated })).toBeNull();
    const wrongScore = { ...arequipa.causal.reply, cp: -candidates[2].cp! + 91 };
    expect(confirmSiblingRefutation(fen, request, { reply: wrongScore })).toBeNull();
});
