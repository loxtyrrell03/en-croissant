import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { nominatePositionRefutation } from "../tacticalMotifs/decisionPositionContrast";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

type Attempt = { requestedNodes: number; depth: number; milliseconds: number };
type Frame = { lines: DecisionEngineLine[]; attempt: Attempt };
type Root = {
    id: string;
    cohort: string;
    fen: string;
    legal: number;
    playedMoveUci: string;
    frames: Record<"original" | "equalWide" | "deepNarrow" | "deepWide", Frame>;
};
type Target = Pick<DecisionEngineLine, "cp" | "mate">;
type Request = {
    id: string;
    fen: string;
    moveUci: string;
    bestTargets: Target[];
};
type Reply = Request & { depths: Frame[] };

const directory = process.env.DECISION_BREADTH_AUDIT;
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const choiceKey = (id: string, moveUci: string) => `${id}:${moveUci}`;
const agrees = (target: Target, reply: DecisionEngineLine) =>
    target.mate != null
        ? reply.mate != null && target.mate * reply.mate < 0
        : target.cp !== null && reply.cp !== null && Math.abs(target.cp + reply.cp) <= 90;

function profiles(row: Root) {
    const { original, equalWide, deepNarrow, deepWide } = row.frames;
    const settings = [
        ["original", original, 3, false],
        ["equalWideTop3", equalWide, 3, false],
        ["equalWide", equalWide, 8, false],
        ["deepNarrow", deepNarrow, 3, false],
        ["deepWideTop3", deepWide, 3, false],
        ["deepWide", deepWide, 8, false],
        ["deepWideCertificates", deepWide, 8, true],
    ] as const;
    return settings.map(([label, frame, width, moreCertificates]) => ({
        label,
        candidates: frame.lines.slice(0, width),
        attempt: frame.attempt,
        moreCertificates,
    }));
}

function plan(rows: Root[]) {
    const requests = new Map<string, Request>();
    for (const row of rows) {
        const add = (moveUci: string, target?: Target) => {
            const key = choiceKey(row.id, moveUci);
            const request = requests.get(key) ?? {
                id: row.id,
                fen: row.fen,
                moveUci,
                bestTargets: [],
            };
            if (
                target &&
                !request.bestTargets.some(
                    (item) => item.cp === target.cp && item.mate === target.mate,
                )
            )
                request.bestTargets.push(target);
            requests.set(key, request);
        };
        for (const { candidates } of profiles(row)) {
            const best = candidates[0];
            add(best.pvUci[0], { cp: best.cp, mate: best.mate ?? null });
            const counter = nominatePositionRefutation(row.fen, candidates);
            if (counter) add(counter.moveUci);
        }
    }
    return Array.from(requests.values());
}

test.skipIf(!directory)(
    "compares equal-budget and deeper candidate breadth",
    () => {
        const read = (name: string) => readFileSync(join(directory!, name));
        const save = (name: string, value: unknown) =>
            writeFileSync(join(directory!, name), JSON.stringify(value), { flag: "wx" });
        const engineBytes = read("engine-breadth.json");
        const engine = JSON.parse(engineBytes.toString("utf8")) as {
            protocol: number;
            engineSha256: string;
            rows: Root[];
        };
        expect(engine.protocol).toBe(1);
        const requested = plan(engine.rows);
        if (process.env.DECISION_BREADTH_PLAN === "1") {
            save("requests.json", {
                protocol: 1,
                engineSha256: engine.engineSha256,
                rootSha256: sha(engineBytes),
                requests: requested,
            });
            return;
        }
        const requestBytes = read("requests.json");
        const replyBytes = read("replies.json");
        const manifest = JSON.parse(requestBytes.toString("utf8"));
        const replies = JSON.parse(replyBytes.toString("utf8")) as {
            protocol: number;
            requestSha256: string;
            engineSha256: string;
            rows: Reply[];
        };
        expect(manifest.rootSha256).toBe(sha(engineBytes));
        expect(replies.requestSha256).toBe(sha(requestBytes));
        expect(replies.engineSha256).toBe(engine.engineSha256);
        expect(replies.protocol).toBe(1);
        expect(manifest.requests).toEqual(requested);
        expect(replies.rows.map(({ depths: _depths, ...query }) => query)).toEqual(requested);
        const replyFor = new Map(
            replies.rows.map((reply) => [choiceKey(reply.id, reply.moveUci), reply]),
        );
        const results = engine.rows.map((row) => {
            const reports = profiles(row).map(
                ({ label, candidates, attempt, moreCertificates }) => {
                    const best = candidates[0];
                    const lookup = (moveUci: string) => replyFor.get(choiceKey(row.id, moveUci));
                    const bestProbed = lookup(best.pvUci[0])!;
                    const bestProbe =
                        bestProbed.depths.find(
                            (frame) => frame.attempt.depth >= 16 && agrees(best, frame.lines[0]),
                        ) ?? bestProbed.depths.at(-1);
                    const alternative = nominatePositionRefutation(row.fen, candidates);
                    const alternativeProbe = alternative && lookup(alternative.moveUci)!.depths[0];
                    const start = performance.now();
                    const scan = buildLiveTacticalScan({
                        fen: row.fen,
                        pvUci: best.pvUci,
                        depth: best.depth,
                        engineName: "Stockfish 19",
                        variations: candidates,
                        supplementalVariations: moreCertificates ? candidates.slice(3) : undefined,
                    });
                    const assessment = assessChessDecision({
                        fen: row.fen,
                        candidates,
                        rootCertificates: scan.variations.map((line) => ({
                            fen: row.fen,
                            moveUci: line.lineUci[0],
                            motifs: line.motifs,
                        })),
                        replyProbes: bestProbe
                            ? [{ moveUci: best.pvUci[0], lines: bestProbe.lines }]
                            : [],
                        positionReply:
                            alternative && alternativeProbe
                                ? { moveUci: alternative.moveUci, lines: alternativeProbe.lines }
                                : undefined,
                    });
                    return [
                        label,
                        {
                            position: assessment?.position ?? null,
                            milliseconds: performance.now() - start,
                            rootAttempt: attempt,
                            bestReplyNodes: bestProbe
                                ? bestProbed.depths
                                      .slice(0, bestProbed.depths.indexOf(bestProbe) + 1)
                                      .reduce((sum, frame) => sum + frame.attempt.requestedNodes, 0)
                                : 0,
                            nominatedReplyNodes: alternativeProbe
                                ? alternativeProbe.attempt.requestedNodes
                                : 0,
                        },
                    ];
                },
            );
            return { id: row.id, cohort: row.cohort, reports: Object.fromEntries(reports) };
        });
        save("position-reports.json", {
            protocol: 1,
            rootSha256: sha(engineBytes),
            replySha256: sha(replyBytes),
            results,
        });
    },
    240_000,
);
