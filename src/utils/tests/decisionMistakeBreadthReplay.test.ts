import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { classifyMistakeReviewNature } from "../mistakeReview";
import type {
    ChessDecisionReport,
    DecisionAssessmentInput,
    DecisionReplyProbe,
} from "../tacticalMotifs/decisionAssessment";
import {
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "../tacticalMotifs/decisionEvidence";
import {
    nominateSharedReply,
    type DecisionSharedReplyProbe,
} from "../tacticalMotifs/decisionSharedReply";

type Example = {
    id: string;
    fen: string;
    playedMoveUci: string;
    sourceGroup: string;
    event: string;
    stratum: string;
};
type Reference = {
    id: string;
    scope: string;
    moveUci: string;
    tactical: boolean | null;
    positional: boolean | null;
    rationale: string;
};
type Source = { name: string; path: string; profile: string; sample: string; reference: string };
const manifest = process.env.DECISION_MISTAKE_MANIFEST;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const load = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));

test.skipIf(!manifest)(
    "replay reviewed actual played mistakes through the decision worker",
    async () => {
        const output = process.env.DECISION_MISTAKE_REPORT;
        if (!manifest || !output) throw new Error("A manifest and a new report path are required");
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const worker = {
            onmessage: (_event: {
                data: { input: DecisionAssessmentInput; engineName: string };
            }) => {},
            postMessage: (event: {
                type: string;
                report?: ChessDecisionReport;
                message?: string;
            }) => {
                notices.push(event);
            },
        };
        const notices: Parameters<typeof worker.postMessage>[0][] = [];
        const boards = new Set<string>();
        const groups = new Map<string, string>();
        vi.stubGlobal("self", worker);
        try {
            await import("../../components/panels/tactics/decisionReport.worker");
            const results = load<Source[]>(manifest).flatMap((source) => {
                const file = (dir: string, row: Example) =>
                    join(source.path, `tournament-${dir}-${source.profile}`, row.id + ".json");
                const references = load<{ cases: Reference[] }>(
                    join(source.path, source.reference),
                ).cases;
                const rows = load<{ cases: Example[] }>(join(source.path, source.sample)).cases;
                const byId = new Map(rows.map((row) => [row.id, row]));
                return references.map(({ id, scope, moveUci, tactical, positional, rationale }) => {
                    const row = byId.get(id);
                    if (!row || scope !== "mistake-mechanism" || row.playedMoveUci !== moveUci)
                        throw new Error("Review must match the played move: " + id);
                    const board = row.fen.split(" ").slice(0, 4).join(" ");
                    if (
                        boards.has(board) ||
                        (groups.has(row.sourceGroup) && groups.get(row.sourceGroup) !== source.name)
                    )
                        throw new Error("Repeated board or game across cohorts: " + id);
                    boards.add(board);
                    groups.set(row.sourceGroup, source.name);
                    const rootFile = file("engine", row);
                    const replyFile = file("probes", row);
                    const root = load<{
                        id: string;
                        played: string;
                        deep: DecisionEngineLine[];
                        comparison: DecisionEngineLine[];
                        reply: DecisionEngineLine[];
                        identity: { protocol: number; fen: string; engine_sha256: string };
                    }>(rootFile);
                    const replies = load<{
                        replyProbes: DecisionReplyProbe[];
                        identity: { protocol: number; root_sha256: string; engine_sha256: string };
                    }>(replyFile);
                    const rootHash = sha(readFileSync(rootFile));
                    if (
                        root.identity.protocol !== 2 ||
                        replies.identity.protocol !== 2 ||
                        root.id !== id ||
                        root.identity.fen !== row.fen ||
                        root.played !== moveUci ||
                        replies.identity.root_sha256 !== rootHash ||
                        replies.identity.engine_sha256 !== root.identity.engine_sha256
                    )
                        throw new Error("Root or reply cache mismatch: " + id);

                    const input: DecisionAssessmentInput = {
                        candidates: root.deep,
                        comparisonCandidates: root.comparison,
                        fen: row.fen,
                        playedMoveUci: moveUci,
                        replyProbes: replies.replyProbes,
                    };
                    const pair = root.comparison ?? root.deep;
                    const best = pair[0];
                    const played = pair.find((line) => line.pvUci[0] === moveUci);
                    const probes =
                        replies.replyProbes.find((probe) => probe.moveUci === moveUci)?.lines ?? [];
                    const reply = probes[0];
                    const sharedPath = file("shared", row);
                    const request =
                        played && reply && best.pvUci[0] === root.deep[0]?.pvUci[0]
                            ? nominateSharedReply(row.fen, best, played, reply)
                            : null;
                    if (request && existsSync(sharedPath)) {
                        const saved = load<{
                            identity: {
                                rootSha256: string;
                                probeSha256: string;
                                engineSha256: string;
                            };
                            sharedReply: DecisionSharedReplyProbe | null;
                        }>(sharedPath);
                        if (
                            saved.identity.rootSha256 !== rootHash ||
                            saved.identity.probeSha256 !== sha(readFileSync(replyFile)) ||
                            saved.identity.engineSha256 !== root.identity.engine_sha256 ||
                            (saved.sharedReply &&
                                (saved.sharedReply.betterMoveUci !== request.betterMoveUci ||
                                    saved.sharedReply.playedMoveUci !== request.playedMoveUci ||
                                    saved.sharedReply.line.pvUci[0] !== request.replyUci))
                        )
                            throw new Error("Shared reply mismatch: " + id);
                        input.sharedReply = saved.sharedReply ?? undefined;
                    }
                    let legacy = null;
                    if (played && played !== best) {
                        const replyFrame = probes.length ? probes : root.reply;
                        const sign = row.fen.split(" ")[1] === "b" ? -1 : 1;
                        legacy = classifyMistakeReviewNature({
                            fen: row.fen,
                            bestMoveUci: best.pvUci[0],
                            playedMoveUci: moveUci,
                            pvUci: best.pvUci,
                            refutationUci: replyFrame[0]?.pvUci,
                            bestCandidates: pair,
                            refutationCandidates: replyFrame,
                            cpBefore: best.cp === null ? null : sign * best.cp,
                            cpAfter: played.cp === null ? null : sign * played.cp,
                            cpLoss:
                                best.cp === null || played.cp === null ? null : best.cp - played.cp,
                            reachedDepth: Math.min(best.depth, replyFrame[0]?.depth ?? 0),
                        }).nature;
                    }
                    notices.length = 0;
                    const start = performance.now();
                    worker.onmessage({ data: { input, engineName: "Stockfish 19" } });
                    const workerMs = performance.now() - start;
                    const report = notices.find((notice) => notice.type === "result")?.report;
                    if (!report)
                        throw new Error("No decision report: " + id + " " + notices[0]?.message);
                    return {
                        row,
                        source: source.name,
                        label: { id, scope, moveUci, tactical, positional, rationale },
                        report,
                        legacy,
                        workerMs,
                        searchedExtra: false,
                        frame: {
                            best,
                            played,
                            rootAgrees: best.pvUci[0] === root.deep[0].pvUci[0],
                            legalPair:
                                measurePositionDecision(row.fen, pair)?.lines.length ===
                                pair.length,
                            bestReply:
                                replies.replyProbes.find((probe) => probe.moveUci === best.pvUci[0])
                                    ?.lines ?? [],
                            playedReply: probes,
                            sharedReply: input.sharedReply,
                            legalPlayedReply:
                                reply &&
                                measurePositionDecision(reply.fen, probes)?.lines.length ===
                                    probes.length,
                            legalPlayed: played && !!measureDecisionLine(row.fen, played),
                        },
                    };
                });
            });
            expect(results).not.toHaveLength(0);
            writeFileSync(privateReportPath(output), JSON.stringify({ results }), { flag: "wx" });
        } finally {
            vi.unstubAllGlobals();
        }
    },
    180_000,
);
