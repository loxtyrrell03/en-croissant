import { expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { proveQuietMatingAttack, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { shortMatingThreatCases } from "./fixtures/shortMatingThreat";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const cases = [false, true].flatMap((reflected) =>
    shortMatingThreatCases.map((row) => ({
        ...row,
        id: `${row.id}:${reflected}`,
        reflected,
        fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
        move: reflected ? reflectMixedForkMove(row.move) : row.move,
    })),
);

test.each(cases)("short mating threats must survive actual defences: $id", (row) => {
    const steps = replayTacticalLine(row.fen, [row.move]);
    expect(steps).toHaveLength(1);
    const trace: string[] = [];
    const proof = proveQuietMatingAttack(steps[0], 8192, (reason) => trace.push(reason));
    expect(Boolean(proof)).toBe(row.positive);
    if (!proof) return;
    expect(trace).toEqual([]);
    expect(proof).toMatchObject({
        gain: 130,
        threatMateIn: 2,
        threatSan: row.reflected ? "Rh6+" : "Rh3+",
    });
    expect(proof.visits).toBeLessThanOrEqual(8192);
    const replies = [...steps[0].after.allDests()].flatMap(([from, dests]) =>
        [...dests].map((to) => makeSan(steps[0].after, { from, to })),
    );
    expect(proof.branches.map((b) => b.reply).sort()).toEqual(replies.sort());
    expect(proof.gain).toBe(Math.min(...proof.branches.map((b) => b.gain)));
    for (const d of proof.decisions) expect(replayTacticalLine(d.fen, [d.move])).toHaveLength(1);
    expect(proof.branches.some((b) => b.gain === 10000)).toBe(true);
    expect(
        proof.branches.some((b) => b.line.some((san) => /^K/.test(san) && !san.includes("+"))),
    ).toBe(true);
    const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
    expect(result.motifs[0]).toMatchObject({
        id: "forcingAttack",
        label: "Mating Attack",
        ply: 1,
        value: 130,
    });
    expect(result.motifs[0].evidence).toContain("mate in two if unanswered");
    expect(result.motifs[0].evidence).toContain("not a forced-mate claim");
});

test.each([false, true])(
    "root explanation and arrows do not depend on a cooperating continuation: %s",
    (reflected) => {
        const row = cases.find((row) => row.reflected === reflected && row.positive)!;
        const line = ["g1g3", "f7h7", "g3h3", "f8f7", "h3h7", "f7h7", "g6e8"].map((move) =>
            reflected ? reflectMixedForkMove(move) : move,
        );
        expect(replayTacticalLine(row.fen, line)).toHaveLength(line.length);
        for (const pvUci of [[row.move], line.slice(0, 3), line]) {
            const scan = buildLiveTacticalScan({
                fen: row.fen,
                pvUci,
                depth: 16,
                engineName: "Constructed mechanism",
            });
            expect(scan.motifs[0]).toMatchObject({ label: "Mating Attack", ply: 1, value: 130 });
            expect(scan.labels).toHaveLength(1);
            expect(scan.arrows).toEqual([
                {
                    from: reflected ? "g8" : "g1",
                    to: reflected ? "g6" : "g3",
                    ply: 1,
                    role: "trigger",
                },
                {
                    from: reflected ? "g6" : "g3",
                    to: reflected ? "h6" : "h3",
                    ply: 1,
                    role: "attacker",
                },
            ]);
            const result = classifyMistakeReviewMotifs({
                fen: row.fen,
                pvUci,
                bestMoveUci: row.move,
                playedMoveUci: row.move,
            });
            expect(buildMistakeReviewTacticalExplanation(result)?.primary?.source).not.toBe(
                "missed",
            );
        }
    },
);

test("failed budgets cannot reuse a successful short-threat proof", () => {
    const row = cases[0],
        root = replayTacticalLine(row.fen, [row.move])[0];
    expect(proveQuietMatingAttack(root)).not.toBeNull();
    for (const limit of [0, 1, 50, -1, 1.5, NaN, Infinity])
        expect(proveQuietMatingAttack(root, limit)).toBeNull();
});

function auditedCases() {
    return cases.map((row) => {
        const root = replayTacticalLine(row.fen, [row.move])[0];
        const trace: string[] = [];
        const proof = proveQuietMatingAttack(root, 8192, (reason) => trace.push(reason));
        const decisions = [
            { fen: row.fen, move: "" },
            { fen: row.fen, move: row.move },
            ...(proof?.decisions ?? []),
        ];
        const defences = [...root.after.allDests()].flatMap(([from, dests]) =>
            [...dests].map((to) => {
                const pos = root.after.clone();
                pos.play({ from, to });
                return { fen: makeFen(pos.toSetup()), move: "" };
            }),
        );
        const probes = [
            ...new Map([...decisions, ...defences].map((d) => [`${d.fen}:${d.move}`, d])).values(),
        ].map((d, i) => ({
            id: `${row.id}:${i}`,
            fen: d.fen,
            ...(d.move ? { searchMove: d.move } : {}),
        }));
        return { ...row, proof, trace, probes };
    });
}

test.skipIf(!process.env.TACTICAL_SHORT_THREAT_PROBES)(
    "export short-threat decisions and contrary controls",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const rows = auditedCases();
        expect(rows).toHaveLength(12);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_SHORT_THREAT_PROBES!),
            JSON.stringify(
                {
                    samplePath: "benchmarks/tactical-relevance/quiet-mate-development.json",
                    cases: rows,
                    probes: rows.flatMap((r) => r.probes),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test("engine evidence covers each retained short-threat decision", () => {
    const receipt = JSON.parse(
        readFileSync(
            process.env.TACTICAL_SHORT_THREAT_ENGINE ??
                "benchmarks/tactical-relevance/short-mating-threat-stockfish-18.json",
            "utf8",
        ),
    );
    expect(receipt.completed ?? receipt.searches.length).toBe(
        receipt.requested ?? receipt.searches.length,
    );
    const records = new Map<string, any>(
        receipt.searches.map((r: any) => [`${r.fen}:${r.searchMove ?? r.move ?? ""}`, r]),
    );
    const exported: any[] = [];
    for (const row of auditedCases())
        for (const probe of row.probes) {
            const record = records.get(`${probe.fen}:${probe.searchMove ?? ""}`);
            expect({ id: probe.id, present: Boolean(record) }).toMatchObject({ present: true });
            const best = record.lines?.[0] ?? record;
            expect(best.depth).toBe(16);
            const sameSide = probe.fen.split(" ")[1] === row.fen.split(" ")[1] ? 1 : -1;
            expect(
                !row.positive ||
                    (best.cp !== null && best.cp * sameSide > 0) ||
                    (best.mate !== null && best.mate * sameSide > 0),
            ).toBe(true);
            const held = probe.searchMove === row.move && probe.fen === row.fen;
            expect(!held || !row.id.startsWith("queen-capture") || best.cp < -300).toBe(true);
            expect(
                !held ||
                    !row.id.startsWith("f-file-countercheck") ||
                    (best.cp > 0 && best.pvUci[1] === (row.reflected ? "f2f3" : "f7f6")),
            ).toBe(true);
            expect(!held || !row.id.startsWith("claimable") || best.cp === 0).toBe(true);
            // Export only exact constructed positions/decisions, never arbitrary
            // input records from the independently stored private engine receipt.
            exported.push({
                id: probe.id,
                fen: probe.fen,
                move: probe.searchMove ?? "",
                depth: best.depth,
                cp: best.cp,
                mate: best.mate,
                pvUci: best.pvUci,
                pvSan: best.pvSan,
            });
        }
    if (process.env.TACTICAL_SHORT_THREAT_PUBLIC_RECEIPT)
        writeFileSync(
            process.env.TACTICAL_SHORT_THREAT_PUBLIC_RECEIPT,
            JSON.stringify(
                {
                    scope: "Constructed short mating-threat controls; full-position finite-depth scores are not local proof bounds or an accuracy score.",
                    engine: "Stockfish 18",
                    searches: exported,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});

test.skipIf(!process.env.TACTICAL_SHORT_THREAT_BASELINE)(
    "the committed baseline misses both constructed short threats",
    async () => {
        const baseline = await import(process.env.TACTICAL_SHORT_THREAT_BASELINE!);
        for (const row of cases.filter((row) => row.positive)) {
            const root = baseline.replayTacticalLine(row.fen, [row.move])[0];
            expect(baseline.proveQuietMatingAttack(root)).toBeNull();
        }
    },
);
