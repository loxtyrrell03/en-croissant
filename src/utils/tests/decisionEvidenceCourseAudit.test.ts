import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { classifyMistakeReviewNature } from "../mistakeReview";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    measurePositionDecision,
    compareDecisionConsequences,
} from "../tacticalMotifs/decisionEvidence";
import { extractPositionalBoardFacts } from "../tacticalMotifs/positionalEvidence";

// Private course content and results stay outside the repository. This is an
// opt-in measurement harness; course titles never become correctness assertions.
const directory = process.env.DECISION_EVIDENCE_AUDIT;
test.skipIf(!directory)(
    "measure development course roots through both production classifiers",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const sample = JSON.parse(readFileSync(join(directory!, "course-sample.json"), "utf8"));
        const rows = sample.cases.filter((row: { split: string }) => row.split === "development");
        const output = privateReportPath(join(directory!, "measurement-development.json"));
        expect(existsSync(output)).toBe(false);
        const results = [];
        for (const row of rows) {
            const engine = JSON.parse(
                readFileSync(join(directory!, "engine-complete", `${row.id}.json`), "utf8"),
            );
            const best = engine.deep[0],
                reply = engine.reply[0];
            const sign = row.fen.split(" ")[1] === "w" ? 1 : -1;
            const started = performance.now();
            const scan = buildLiveTacticalScan({
                fen: row.fen,
                pvUci: best.pvUci,
                depth: best.depth,
                variations: engine.deep,
                engineName: "Stockfish 19",
            });
            const selected = engine.deep.find(
                (line: { pvUci: string[] }) => line.pvUci[0] === engine.played,
            );
            const loss =
                best.cp != null && selected.cp != null ? Math.max(0, best.cp - selected.cp) : null;
            const nature = classifyMistakeReviewNature({
                fen: row.fen,
                bestMoveUci: best.pvUci[0],
                playedMoveUci: engine.played,
                pvUci: best.pvUci,
                refutationUci: reply?.pvUci,
                bestCandidates: engine.deep,
                refutationCandidates: engine.reply,
                reachedDepth: Math.min(best.depth, reply?.depth ?? 0),
                cpBefore: best.cp == null ? null : best.cp * sign,
                cpAfter: selected.cp == null ? null : selected.cp * sign,
                cpLoss: loss,
            });
            results.push({
                id: row.id,
                category: row.category,
                chapter: row.chapter,
                loss,
                nature,
                motifs: scan.motifs,
                variations: scan.variations,
                milliseconds: performance.now() - started,
                decision: measurePositionDecision(row.fen, engine.deep),
                shallowerDecision: measurePositionDecision(row.fen, engine.shallow),
                positionalFacts: extractPositionalBoardFacts(row.fen),
                consequence: reply
                    ? compareDecisionConsequences(row.fen, best, {
                          ...reply,
                          fen: row.fen,
                          cp: reply.cp === null ? null : -reply.cp,
                          mate: reply.mate === null ? null : -reply.mate,
                          pvUci: [engine.played, ...reply.pvUci],
                      })
                    : null,
            });
        }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Development only. Weak source labels and engine-generated third-choice alternatives. No accuracy claim.",
                    results,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        expect(results).toHaveLength(rows.length);
    },
    240000,
);
