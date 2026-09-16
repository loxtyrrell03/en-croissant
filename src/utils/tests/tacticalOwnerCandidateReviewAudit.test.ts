import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import {
    proveCheckingPawnRetention,
    proveQuietTacticalPreparation,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Private diagnostic: an empty root and a later PV capture are neither proof
// of a missing tactic nor permission to assign a mistake cause.
test.skipIf(
    !process.env.TACTICAL_CANDIDATE_REVIEW_REPLAY || !process.env.TACTICAL_CANDIDATE_REVIEW_REPORT,
)(
    "inspect selected owner candidate mechanisms and every legal checking defence",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CANDIDATE_REVIEW_REPORT!);
        expect(existsSync(output)).toBe(false);
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_CANDIDATE_REVIEW_REPLAY!, "utf8"),
        );
        const ids: string[] = JSON.parse(process.env.TACTICAL_CANDIDATE_REVIEW_IDS ?? "[]");
        expect(ids.length).toBeGreaterThan(0);
        const rows = report.results.filter((r: any) => ids.includes(r.id));
        expect(rows).toHaveLength(ids.length);
        const results = rows.map((row: any) => ({
            id: row.id,
            fen: row.fen,
            played: row.playedMoveUci,
            candidates: row.before.map((candidate: any) => {
                const steps = replayTacticalLine(row.fen, candidate.pvUci);
                const root = steps[0];
                const trace: string[] = [];
                const capture = tacticalCaptureGain(root);
                const retention = proveCheckingPawnRetention(steps, 8192, (reason) =>
                    trace.push(reason),
                );
                const preparation = proveQuietTacticalPreparation(steps);
                const classification = classifyPositionTacticalMotifs({
                    fen: row.fen,
                    pvUci: candidate.pvUci,
                    rootCp: candidate.cp,
                    previousFen: row.previousFen,
                    previousMoveUci: row.previousMoveUci,
                    tacticalHistory: row.tacticalHistory,
                });
                const defences = root.after.isCheck()
                    ? [...root.after.allDests()].flatMap(([from, tos]) =>
                          [...tos]
                              .map((to) => ({ from, to }))
                              .filter((move) => root.after.isLegal(move))
                              .map((move) => {
                                  const after = root.after.clone();
                                  after.play(move);
                                  return {
                                      move: makeUci(move),
                                      san: makeSan(root.after, move),
                                      fen: makeFen(after.toSetup()),
                                  };
                              }),
                      )
                    : [];
                return {
                    candidate,
                    capture,
                    retention,
                    trace,
                    preparation,
                    classification,
                    defences,
                };
            }),
        }));
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Selected development omissions, not an accuracy score. Frozen engine input; no fresh engine searches.",
                    replayFrom: process.env.TACTICAL_CANDIDATE_REVIEW_REPLAY,
                    results,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        if (process.env.TACTICAL_CANDIDATE_REVIEW_PROBES) {
            const probes = results.flatMap((row: any) =>
                row.candidates
                    .filter((c: any) => c.capture !== null && c.capture >= 90 && c.defences.length)
                    .flatMap((c: any) => {
                        const root = c.candidate.pvUci[0];
                        const afterFen = makeFen(
                            replayTacticalLine(row.fen, [root])[0].after.toSetup(),
                        );
                        const prefix = `${row.id}:${root}`;
                        return [
                            { id: `${prefix}:best`, fen: row.fen },
                            { id: `${prefix}:held`, fen: row.fen, searchMove: root },
                            { id: `${prefix}:played`, fen: row.fen, searchMove: row.played },
                            ...c.defences.flatMap((d: any) => [
                                {
                                    id: `${prefix}:${d.move}:defend`,
                                    fen: afterFen,
                                    searchMove: d.move,
                                },
                                { id: `${prefix}:${d.move}:answer`, fen: d.fen },
                            ]),
                        ];
                    }),
            );
            const destination = privateReportPath(process.env.TACTICAL_CANDIDATE_REVIEW_PROBES);
            if (existsSync(destination)) throw new Error("Existing private probe receipt");
            writeFileSync(
                destination,
                JSON.stringify(
                    { samplePath: process.env.TACTICAL_CANDIDATE_REVIEW_REPLAY, probes },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
        console.log(
            results.map((row: any) => ({
                id: row.id,
                candidates: row.candidates.map((c: any) => ({
                    move: c.candidate.pvSan[0],
                    capture: c.capture,
                    retention: c.retention?.gain,
                    trace: c.trace,
                    preparation: c.preparation?.gain,
                    themes: c.classification.motifs.map((m: any) => m.id),
                    defences: c.defences.map((d: any) => d.san),
                })),
            })),
        );
    },
    120000,
);

test.skipIf(
    !process.env.TACTICAL_OWNER_CANDIDATE_REPLAYS || !process.env.TACTICAL_OWNER_CANDIDATE_REPORT,
)(
    "replay every frozen owner context with its unchanged engine evidence",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_OWNER_CANDIDATE_REPORT!);
        expect(existsSync(output)).toBe(false);
        const paths: string[] = JSON.parse(process.env.TACTICAL_OWNER_CANDIDATE_REPLAYS!);
        expect(paths.length).toBeGreaterThan(0);
        const results: any[] = [];
        const changed: any[] = [];
        const normalize = (value: unknown) =>
            JSON.stringify(value, (key, v) => (key === "motifClassifierVersion" ? undefined : v));
        for (const path of paths) {
            const baseline = JSON.parse(readFileSync(path, "utf8"));
            expect(baseline.completed).toBe(baseline.results.length);
            for (const row of baseline.results) {
                const historySteps = replayTacticalLine(
                    row.tacticalHistory.fen,
                    row.tacticalHistory.moves,
                );
                expect(historySteps).toHaveLength(row.tacticalHistory.moves.length);
                const last = historySteps.at(-1);
                const context = {
                    tacticalHistory: row.tacticalHistory,
                    previousFen: last ? makeFen(last.before.toSetup()) : undefined,
                    previousMoveUci: last?.uci,
                };
                const input = { fen: row.fen, ...context };
                const start = performance.now();
                const scan = buildLiveTacticalScan({
                    ...input,
                    depth: 16,
                    engineName: "Stockfish 18",
                    pvUci: row.before[0].pvUci,
                    variations: row.before,
                });
                // The original source-solution lane deliberately has no engine
                // score/history. Preserve that input rather than count a new
                // context as an algorithmic change.
                const source = classifyPositionTacticalMotifs({
                    fen: row.fen,
                    pvUci: row.sourceUci,
                });
                const score = (line: any) => line.cp ?? (line.mate > 0 ? 10000 : -10000);
                const side = row.fen.split(" ")[1] === "w" ? 1 : -1;
                const classification = row.terminalReviewOmitted
                    ? row.classification
                    : classifyMistakeReviewMotifs({
                          ...input,
                          playedMoveUci: row.playedMoveUci,
                          bestMoveUci: row.before[0].pvUci[0],
                          pvUci: row.before[0].pvUci,
                          refutationUci: row.after[0].pvUci,
                          bestCandidates: row.before
                              .slice(0, 3)
                              .map((line: any) => ({ fen: row.fen, ...line })),
                          refutationCandidates: row.after
                              .slice(0, 3)
                              .map((line: any) => ({ fen: row.afterFen, ...line })),
                          cpBefore: score(row.before[0]) * side,
                          cpAfter: -score(row.after[0]) * side,
                          cpLoss: Math.max(0, score(row.before[0]) + score(row.after[0])),
                      });
                const explanation = row.terminalReviewOmitted
                    ? row.explanation
                    : buildMistakeReviewTacticalExplanation(classification);
                const result = {
                    ...row,
                    ...context,
                    scan,
                    source,
                    classification,
                    explanation,
                    classificationMs: performance.now() - start,
                };
                const keys = ["scan", "source", "classification", "explanation"].filter(
                    (key) => normalize(row[key]) !== normalize(result[key]),
                );
                if (keys.length)
                    changed.push({
                        id: row.id,
                        keys,
                        oldPrimary: row.scan.motifs.map((m: any) => m.id),
                        primary: scan.motifs.map((m) => m.id),
                        oldExplanation: row.explanation,
                        explanation,
                    });
                results.push(result);
            }
        }
        expect(new Set(results.map((r) => r.id)).size).toBe(results.length);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Exact frozen full-game replay, not fresh engine searches or an accuracy estimate.",
                    replayFrom: paths,
                    requested: results.length,
                    completed: results.length,
                    changed,
                    results,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            JSON.stringify(
                {
                    count: results.length,
                    changed: changed.map(({ id, keys, oldPrimary, primary }) => ({
                        id,
                        keys,
                        oldPrimary,
                        primary,
                    })),
                },
                null,
                2,
            ),
        );
    },
    600000,
);
