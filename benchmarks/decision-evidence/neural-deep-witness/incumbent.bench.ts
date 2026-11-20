import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { assessChessDecision, type DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

type Replies = NonNullable<DecisionAssessmentInput["replyProbes"]>[number]["lines"];
type Frame = {
    id: string;
    fen: string;
    history: DecisionAssessmentInput["history"];
    candidate: string;
    playedMoveUci: string;
    deep: { root: Replies; better: Replies; played: Replies };
    short: { better: Replies; played: Replies };
    skipped?: string;
};

function replay(row: Frame, replies: Frame["short"]) {
    const { fen, history, candidate, playedMoveUci, deep } = row;
    const report = assessChessDecision({
        fen, history, playedMoveUci,
        candidates: deep.root,
        comparisonCandidates: deep.root,
        replyProbes: [
            { moveUci: candidate, lines: replies.better },
            { moveUci: playedMoveUci, lines: replies.played },
        ],
    });
    const mistake = report?.mistake;
    return mistake && {
        category: mistake.category,
        tactical: mistake.tactical,
        positional: mistake.positional,
    };
}

test("runs the committed assessor with both sets of exact branches", () => {
    const cases = readFileSync(process.env.DEEP_WITNESS_INPUT!, "utf8").trim().split(/\r?\n/);
    const results = cases.map((line) => JSON.parse(line) as Frame).filter((row) => !row.skipped).map((row) => ({
        id: row.id, short: replay(row, row.short), deep: replay(row, row.deep),
    }));
    expect(results.length).toBeGreaterThan(0);
    writeFileSync(process.env.DEEP_WITNESS_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 30_000);
