import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type {
    DecisionAssessmentInput,
    ChessDecisionReport,
    DecisionReplyProbe,
} from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import type { DecisionSharedReplyProbe } from "../tacticalMotifs/decisionSharedReply";
import { nominateSharedReply } from "../tacticalMotifs/decisionSharedReply";
import {
    compareExtraPositionMove,
    nominatePositionRefutation,
    pickExtraPositionMove,
} from "../tacticalMotifs/decisionPositionContrast";
import { extractTacticalSequenceWitnesses } from "../tacticalMotifs/tacticalSequenceEvidence";
import { extractPositionalTransitions } from "../tacticalMotifs/positionalTransitions";
import * as tacticalScan from "../tacticalMotifs/liveTactics";

type Source = {
    name: string;
    profile: string;
    cache: string;
    reference: string;
    strata?: string[];
};
type Row = {
    id: string;
    event: string;
    fen: string;
    phase: string;
    stratum: string;
    sourceGroup: string;
    playedMoveUci: string;
};
type Root = {
    id: string;
    played: string;
    identity: { engine_sha256: string; fen: string; protocol: number };
    deep: DecisionEngineLine[];
    comparison?: DecisionEngineLine[];
};
type Replies = {
    identity: { root_sha256: string; engine_sha256: string; position_reply_budget: number };
    replyProbes: DecisionReplyProbe[];
    positionReplyProbes: DecisionReplyProbe[];
};
type Extras = {
    rootSha256: string;
    engineSha256: string;
    profiles: { six90k: [number, number] };
    results: Array<{
        id: string;
        cachedRootSha256: string;
        observed: { six90k?: { lines: DecisionEngineLine[] } };
        verification: Record<
            string,
            { pair: DecisionEngineLine[]; reply?: { lines: DecisionEngineLine[] } }
        >;
    }>;
};
type Ref = {
    id: string;
    scope: string;
    tactical: boolean | null;
    positional: boolean | null;
    rationale: string;
};
const parse = <T>(p: string) => JSON.parse(readFileSync(p, "utf8")) as T;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const manifest = process.env.ORDINARY_REPLAY_MANIFEST;
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
test.skipIf(!manifest)(
    "replays sampled classical cases through the app's classifier worker",
    async () => {
        const output = process.env.ORDINARY_REPLAY_OUTPUT;
        if (!output || !manifest)
            throw new Error("An input manifest and new output file are required");
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const sources = parse<Source[]>(manifest);
        const scan = tacticalScan.buildLiveTacticalScan;
        const scans: Array<ReturnType<typeof scan>> = [];
        vi.spyOn(tacticalScan, "buildLiveTacticalScan").mockImplementation((input) => {
            const result = scan(input);
            scans.push(result);
            return result;
        });
        const notices: Array<{ type: string; report?: ChessDecisionReport; message?: string }> = [];
        const worker = {
            onmessage: (_event: {
                data: { input: DecisionAssessmentInput; engineName: string };
            }) => {},
            postMessage: (notice: (typeof notices)[number]) => notices.push(notice),
        };
        vi.stubGlobal("self", worker);
        await import("../../components/panels/tactics/decisionReport.worker");
        const doAnalysis = (input: DecisionAssessmentInput) => {
            notices.length = 0;
            scans.length = 0;
            const start = performance.now();
            worker.onmessage({ data: { input, engineName: "Stockfish 19" } });
            const result = notices.find((notice) => notice.type === "result");
            const currentScan = scans[0];
            if (!result?.report || !currentScan)
                throw new Error(
                    notices.find((notice) => notice.type === "error")?.message ??
                        "No decision report",
                );
            return {
                report: result.report,
                milliseconds: performance.now() - start,
                tacticalScan: currentScan,
            };
        };
        const seen = new Set<string>();
        const groups = new Set<string>();
        const results = sources.flatMap((source) => {
            const path = (name: string) => join(source.cache, name);
            const sampleBytes = readFileSync(path("tournament-sample.json"));
            const sample = JSON.parse(sampleBytes.toString("utf8")) as { cases: Row[] };
            const refs = new Map(
                parse<{ cases: Ref[] }>(source.reference).cases.map((row) => [row.id, row]),
            );
            const extras = parse<Extras>(path("quick-nominations.json"));
            if (
                extras.rootSha256 !== sha(sampleBytes) ||
                JSON.stringify(extras.profiles) !== JSON.stringify({ six90k: [6, 90_000] })
            )
                throw new Error("Unmatched shortlists");
            const extraRows = new Map(extras.results.map((row) => [row.id, row]));
            const strata = source.strata ?? ["ordinary"];
            if (!sample.cases.some((row) => strata.includes(row.stratum)))
                throw new Error("No matching cases for " + source.name);
            return sample.cases
                .filter((row) => strata.includes(row.stratum))
                .map((row) => {
                    const label = refs.get(row.id);
                    if (!label || label.scope !== "position-character")
                        throw new Error("Missing position reference");
                    const identity = row.fen.split(" ").slice(0, 4).join(" ");
                    if (seen.has(identity) || groups.has(row.sourceGroup))
                        throw new Error("Duplicated board or game");
                    seen.add(identity);
                    groups.add(row.sourceGroup);
                    const rootBytes = readFileSync(
                        path(join("tournament-engine-" + source.profile, row.id + ".json")),
                    );
                    const root = JSON.parse(rootBytes.toString("utf8")) as Root;
                    const rootHash = sha(rootBytes);
                    const probeBytes = readFileSync(
                        path(join("tournament-probes-" + source.profile, row.id + ".json")),
                    );
                    const replies = JSON.parse(probeBytes.toString("utf8")) as Replies;
                    if (
                        root.id !== row.id ||
                        root.identity.fen !== row.fen ||
                        root.played !== row.playedMoveUci ||
                        root.identity.protocol !== 2 ||
                        replies.identity.position_reply_budget !== 1_000_000 ||
                        replies.identity.root_sha256 !== rootHash ||
                        replies.identity.engine_sha256 !== root.identity.engine_sha256 ||
                        extras.engineSha256 !== root.identity.engine_sha256
                    )
                        throw new Error(
                            "Root, reply or shortlist evidence does not match " + row.id,
                        );
                    const input: DecisionAssessmentInput = {
                        fen: row.fen,
                        candidates: root.deep,
                        replyProbes: replies.replyProbes,
                        comparisonCandidates: root.comparison,
                        playedMoveUci: root.played,
                    };
                    const first = root.deep[0];
                    const pairedBest = root.comparison?.[0];
                    const played = root.comparison?.find((line) => line.pvUci[0] === root.played);
                    const opponent = replies.replyProbes.find(
                        (probe) => probe.moveUci === root.played,
                    )?.lines[0];
                    if (played && opponent && pairedBest?.pvUci[0] === first.pvUci[0]) {
                        const request = nominateSharedReply(row.fen, pairedBest, played, opponent);
                        if (request) {
                            const shared = parse<{
                                sharedReply: DecisionSharedReplyProbe | null;
                                identity: {
                                    rootSha256: string;
                                    probeSha256: string;
                                    engineSha256: string;
                                };
                            }>(path(join("tournament-shared-" + source.profile, row.id + ".json")));
                            if (
                                shared.identity.rootSha256 !== rootHash ||
                                shared.identity.probeSha256 !== sha(probeBytes) ||
                                shared.identity.engineSha256 !== root.identity.engine_sha256
                            )
                                throw new Error("Unmatched shared reply " + row.id);
                            input.sharedReply = shared.sharedReply ?? undefined;
                        }
                    }
                    const nominated = nominatePositionRefutation(row.fen, root.deep);
                    if (
                        nominated &&
                        !replies.replyProbes.some((probe) => probe.moveUci === nominated.moveUci)
                    ) {
                        input.positionReply = replies.positionReplyProbes.find(
                            (probe) => probe.moveUci === nominated.moveUci,
                        );
                        if (!input.positionReply)
                            throw new Error("Missing position reply " + row.id);
                    }
                    const ordinary = doAnalysis(input);
                    let extraChoice;
                    let final = ordinary;
                    if (ordinary.report.position.tactical.support !== "supported") {
                        const extra = extraRows.get(row.id);
                        if (!extra || extra.cachedRootSha256 !== rootHash)
                            throw new Error("Unmatched extra-choice frame " + row.id);
                        const shortlist = extra.observed.six90k?.lines;
                        const move =
                            shortlist && pickExtraPositionMove(row.fen, root.deep, shortlist);
                        const recovery = move ? extra.verification[move] : undefined;
                        if (
                            shortlist &&
                            move &&
                            recovery?.reply &&
                            compareExtraPositionMove(row.fen, first, move, recovery.pair)
                        ) {
                            extraChoice = {
                                shortlist,
                                pair: recovery.pair,
                                replies: recovery.reply.lines,
                            };
                            final = doAnalysis({ ...input, extraPositionChoice: extraChoice });
                        }
                    }
                    const signals = root.deep.map((line) => ({
                        witnesses: extractTacticalSequenceWitnesses(row.fen, line),
                        changes: extractPositionalTransitions(row.fen, line),
                    }));
                    const legacy =
                        ordinary.tacticalScan.variations
                            .find((line) => line.lineUci[0] === first.pvUci[0])
                            ?.motifs.filter(
                                (motif) => motif.ply === 1 && motif.moveUci === first.pvUci[0],
                            )
                            .map((motif) => motif.id) ?? [];
                    return {
                        row,
                        source: source.name,
                        label,
                        report: final.report,
                        beforeExtra: ordinary.report.position,
                        legacy,
                        searchedExtra: !!extraChoice,
                        workerMs: ordinary.milliseconds + (extraChoice ? final.milliseconds : 0),
                        signals,
                        cp: root.deep.map((line) => line.cp),
                        playedCp: played?.cp,
                        bestPairedCp: pairedBest?.cp,
                    };
                });
        });
        expect(results.length).toBeGreaterThan(0);
        writeFileSync(privateReportPath(output), JSON.stringify({ results }, null, 2), {
            flag: "wx",
        });
    },
    180_000,
);
