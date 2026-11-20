import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { extractTacticalSequenceWitnesses } from "@/utils/tacticalMotifs/tacticalSequenceEvidence";

type Request = DecisionAssessmentInput & { id: string };

test("exports legal same-type witness pairs without a classifier prediction", () => {
    const rows = JSON.parse(readFileSync(process.env.IDENTITY_INPUT!, "utf8")) as Request[];
    const groups = rows.flatMap((row) => {
        const [better, ...alternatives] = row.comparisonCandidates ?? row.candidates;
        const played = alternatives.find((line) => line.pvUci[0] === row.playedMoveUci);
        if (!better || !played) return [];
        const roots = [played, better];
        const branches = roots.map((line, index) => {
            const root = replayTacticalLine(row.fen, line.pvUci.slice(0, 1))[0];
            if (!root) return [];
            const probe = row.replyProbes?.find((item) => item.moveUci === root.uci)?.lines[0];
            const opponent = index === 0 && probe ? probe : {
                fen: makeFen(root.after.toSetup()),
                pvUci: line.pvUci.slice(1),
                cp: line.cp === null ? null : -line.cp,
                mate: line.mate == null ? null : -line.mate,
                depth: line.depth,
            };
            return extractTacticalSequenceWitnesses(opponent.fen, opponent).filter(
                (item) => item.actor === root.after.turn && item.mechanismPly <= 5,
            );
        });
        return branches[0].flatMap((a) => branches[1].filter((b) => b.mechanism === a.mechanism)
            .map((b) => ({
                id: row.id, a, b,
                context: { fen: row.fen, firstPrefix: [played.pvUci[0]], secondPrefix: [better.pvUci[0]] },
            })));
    });
    expect(rows.length).toBeGreaterThan(0);
    writeFileSync(process.env.IDENTITY_OUTPUT!, JSON.stringify(groups), { flag: "wx" });
}, 130_000);
