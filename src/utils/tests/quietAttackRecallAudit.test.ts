import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { makeSan } from "chessops/san";
import {
    proveCheckingMate,
    proveQuietMatingAttack,
    proveMatingCaptureAttack,
    proveShortCheckingMate,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

test.skipIf(!process.env.TACTICAL_QUIET_ATTACK_INPUT || !process.env.TACTICAL_QUIET_ATTACK_REPORT)(
    "inspect quiet owner attacks, their actual replies and explicitly hypothetical passing threats",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const input = JSON.parse(readFileSync(process.env.TACTICAL_QUIET_ATTACK_INPUT!, "utf8"));
        const ids: string[] = JSON.parse(process.env.TACTICAL_QUIET_ATTACK_IDS ?? "[]");
        expect(ids.length).toBeGreaterThan(0);
        const rows: any[] = input.results.filter((row: any) => ids.includes(row.id));
        expect(rows).toHaveLength(ids.length);
        const cases = rows.map((row) => {
            const pv = row.before[0].pvUci;
            const steps = replayTacticalLine(row.fen, pv),
                root = steps[0];
            expect(steps).toHaveLength(pv.length);
            const trace: string[] = [];
            const quiet = proveQuietMatingAttack(root, 8192, (reason) => trace.push(reason));
            const scan = buildLiveTacticalScan({
                fen: row.fen,
                pvUci: pv,
                variations: row.before,
                depth: 16,
                engineName: "Stockfish 18",
                previousFen: row.previousFen,
                previousMoveUci: row.previousMoveUci,
                tacticalHistory: row.tacticalHistory,
            });
            const mate = proveCheckingMate(steps, 65536, true, (reason) => trace.push(reason));
            const probe = root.after.clone();
            probe.turn = root.before.turn;
            probe.epSquare = undefined;
            const passFen = makeFen(probe.toSetup());
            const threats = [...probe.allDests()].flatMap(([from, dests]) =>
                [...dests].flatMap((to) => {
                    const move = { from, to };
                    const threat = replayTacticalLine(passFen, [makeUci(move)])[0];
                    if (!threat?.after.isCheck()) return [];
                    const proof = threat.after.isCheckmate()
                        ? { maxMoves: 1, example: [threat.san] }
                        : proveShortCheckingMate(threat);
                    return proof ? [{ move: makeUci(move), san: threat.san, proof }] : [];
                }),
            );
            const replies = [...root.after.allDests()].flatMap(([from, dests]) =>
                [...dests].map((to) => {
                    const move = { from, to },
                        pos = root.after.clone();
                    pos.play(move);
                    return {
                        move: makeUci(move),
                        san: makeSan(root.after, move),
                        fen: makeFen(pos.toSetup()),
                    };
                }),
            );
            const alternativeLines =
                row.playedMoveUci === root.uci
                    ? row.after.map((line: any) => {
                          const moves = [root.uci, ...line.pvUci];
                          const replay = replayTacticalLine(row.fen, moves);
                          const reasons: string[] = [];
                          return {
                              moves,
                              san: replay.map((step) => step.san),
                              mate: proveCheckingMate(replay, 65536, true, (reason) =>
                                  reasons.push(reason),
                              ),
                              motifs: classifyPositionTacticalMotifs({
                                  fen: row.fen,
                                  pvUci: moves,
                              }),
                              reasons,
                          };
                      })
                    : [];
            const probes = [
                { id: `${row.id}:best`, fen: row.fen },
                { id: `${row.id}:held`, fen: row.fen, searchMove: root.uci },
                ...replies.map((reply) => ({
                    id: `${row.id}:reply:${reply.move}`,
                    fen: reply.fen,
                })),
                ...threats.map((threat) => ({
                    id: `${row.id}:hypothetical-pass:${threat.move}`,
                    fen: passFen,
                    searchMove: threat.move,
                })),
                ...(quiet?.decisions ?? []).map((decision, index) => ({
                    id: `${row.id}:decision:${index}`,
                    fen: decision.fen,
                    searchMove: decision.move,
                })),
            ];
            return {
                id: row.id,
                fen: row.fen,
                root: root.uci,
                quiet,
                mate,
                scan,
                trace,
                passFen,
                threats,
                replies,
                alternativeLines,
                probes,
            };
        });
        writeFileSync(
            privateReportPath(process.env.TACTICAL_QUIET_ATTACK_REPORT!),
            JSON.stringify(
                {
                    scope: "Private recall diagnostic. Passing threats are nominations, never actual legal-game proof; empty output is not a correct negative.",
                    samplePath: process.env.TACTICAL_QUIET_ATTACK_INPUT,
                    cases,
                    probes: cases.flatMap((row) => row.probes),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            cases.map((row) => ({
                id: row.id,
                trace: row.trace,
                threats: row.threats,
                alternatives: row.alternativeLines.map((line: any) => ({
                    mate: line.mate,
                    reasons: line.reasons,
                })),
            })),
        );
    },
    60000,
);

test.skipIf(
    !process.env.TACTICAL_SHORT_THREAT_SELECTED_PROOF ||
        !process.env.TACTICAL_SHORT_THREAT_SELECTED_ENGINE,
)("selected real short-threat decisions retain exact complete engine evidence", () => {
    const selected = JSON.parse(
        readFileSync(process.env.TACTICAL_SHORT_THREAT_SELECTED_PROOF!, "utf8"),
    );
    const receipt = JSON.parse(
        readFileSync(process.env.TACTICAL_SHORT_THREAT_SELECTED_ENGINE!, "utf8"),
    );
    expect(receipt.completed).toBe(receipt.requested);
    expect(receipt.completed).toBe(selected.probes.length);
    const records = new Map<string, any>(
        receipt.searches.map((r: any) => [`${r.fen}:${r.searchMove ?? ""}`, r]),
    );
    for (const row of selected.cases) {
        const root = replayTacticalLine(row.fen, [row.root])[0];
        const proof = root.capture ? proveMatingCaptureAttack(root) : proveQuietMatingAttack(root);
        expect(proof).toEqual(row.proof);
        for (const request of row.probes) {
            const record = records.get(`${request.fen}:${request.searchMove ?? ""}`);
            expect(Boolean(record)).toBe(true);
            const best = record.lines[0];
            expect(best.depth).toBe(16);
            const side = request.fen.split(" ")[1] === row.fen.split(" ")[1] ? 1 : -1;
            expect(
                (best.cp !== null && best.cp * side > 0) ||
                    (best.mate !== null && best.mate * side > 0),
            ).toBe(true);
        }
    }
});

test.skipIf(
    !process.env.TACTICAL_SHORT_THREAT_REPLAY || !process.env.TACTICAL_SHORT_THREAT_SELECTED_PROBES,
)(
    "audit every displayed new short mating threat at its actual board",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const input = JSON.parse(readFileSync(process.env.TACTICAL_SHORT_THREAT_REPLAY!, "utf8"));
        const reached = new Map<string, any>();
        const inspect = (id: string, fen: string, moves: string[], motifs: any[]) => {
            const selected = motifs.filter(
                (m) =>
                    m.label === "Mating Attack" && m.evidence.includes("mate in two if unanswered"),
            );
            if (!selected.length) return;
            const steps = replayTacticalLine(fen, moves);
            expect(steps).toHaveLength(moves.length);
            for (const motif of selected) {
                const root = steps[motif.ply - 1];
                expect(root.uci).toBe(motif.moveUci);
                const rootFen = makeFen(root.before.toSetup());
                const key = `${rootFen}:${root.uci}`;
                if (reached.has(key)) {
                    reached.get(key).contexts.push(id);
                    continue;
                }
                const proof = root.capture
                    ? proveMatingCaptureAttack(root)
                    : proveQuietMatingAttack(root);
                expect(proof).toMatchObject({ threatMateIn: 2 });
                expect(motif.value).toBeLessThanOrEqual(proof!.gain);
                const probe = root.after.clone();
                probe.turn = root.before.turn;
                probe.epSquare = undefined;
                const passFen = makeFen(probe.toSetup());
                const decisions = [
                    { fen: rootFen, move: "" },
                    { fen: rootFen, move: root.uci },
                    ...proof!.decisions,
                    { fen: passFen, move: makeUci(proof!.threat) },
                    ...[...root.after.allDests()].flatMap(([from, dests]) =>
                        [...dests].map((to) => {
                            const pos = root.after.clone();
                            pos.play({ from, to });
                            return { fen: makeFen(pos.toSetup()), move: "" };
                        }),
                    ),
                ];
                const probes = [
                    ...new Map(decisions.map((d) => [`${d.fen}:${d.move}`, d])).values(),
                ].map((d, index) => ({
                    id: `${id}:${motif.ply}:${index}`,
                    fen: d.fen,
                    ...(d.move ? { searchMove: d.move } : {}),
                }));
                reached.set(key, {
                    id,
                    contexts: [id],
                    fen: rootFen,
                    root: root.uci,
                    motif,
                    proof,
                    probes,
                });
            }
        };
        for (const row of input.results) {
            inspect(`${row.id}:source`, row.fen, row.sourceUci, [
                ...row.source.motifs,
                ...(row.source.timeline ?? []),
            ]);
            for (const [index, variation] of row.scan.variations.entries())
                inspect(`${row.id}:variation${index}`, row.fen, variation.lineUci, [
                    ...variation.motifs,
                    ...variation.timeline,
                ]);
        }
        if (process.env.TACTICAL_SHORT_THREAT_COURSE_REPLAY) {
            const course = JSON.parse(
                readFileSync(process.env.TACTICAL_SHORT_THREAT_COURSE_REPLAY, "utf8"),
            );
            for (const group of course.results)
                for (const row of group.cases) {
                    inspect(`${row.id}:source`, row.fen, row.sourceUci, [
                        ...row.sourceResult.motifs,
                        ...(row.sourceResult.timeline ?? []),
                    ]);
                    for (const [index, variation] of row.scan.variations.entries())
                        inspect(`${row.id}:variation${index}`, row.fen, variation.lineUci, [
                            ...variation.motifs,
                            ...variation.timeline,
                        ]);
                }
        }
        expect(reached.size).toBeGreaterThan(0);
        const cases = [...reached.values()];
        writeFileSync(
            privateReportPath(process.env.TACTICAL_SHORT_THREAT_SELECTED_PROBES!),
            JSON.stringify(
                {
                    scope: "Private selected actual-ply short-threat certificates. Hypothetical pass only nominates; full-position scores are not local bounds.",
                    samplePath: process.env.TACTICAL_SHORT_THREAT_REPLAY,
                    cases,
                    probes: cases.flatMap((row) => row.probes),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            cases.map((row) => ({
                id: row.id,
                move: row.root,
                gain: row.proof.gain,
                nodes: row.proof.visits,
                probes: row.probes.length,
            })),
        );
    },
    60000,
);
