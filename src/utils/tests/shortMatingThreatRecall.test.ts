import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { proveQuietMatingAttack, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const sample: {cases: {id: string; startFen: string; bestLine: string[]}[]} = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/quiet-mate-development.json", "utf8"),
);
const cases = sample.cases
    .filter(r => ["lichess:0z5nl", "lichess:0QPvf"].includes(r.id))
    .flatMap(row =>
        [false, true].map((reflected) => ({
            id: `${row.id}:${reflected}`,
            fen: reflected ? reflectMixedForkFen(row.startFen) : row.startFen,
            moves: reflected ? row.bestLine.map(reflectMixedForkMove) : row.bestLine,
            gain: row.id === "lichess:0z5nl" ? 100 : 500,
        })),
    );

function auditedCases() {
    return cases.map(row => {
        const root = replayTacticalLine(row.fen, row.moves)[0];
        const proof = proveQuietMatingAttack(root);
        expect(proof).toMatchObject({ gain: row.gain });
        const pass = root.after.clone();
        pass.turn = root.before.turn;
        pass.epSquare = undefined;
        const decisions = [
            { fen: row.fen, move: "" },
            { fen: row.fen, move: root.uci },
            ...proof!.decisions,
            { fen: makeFen(pass.toSetup()), move: makeUci(proof!.threat) },
            ...[...root.after.allDests()].flatMap(([from, dests]) =>
                [...dests].map((to) => {
                    const pos = root.after.clone();
                    pos.play({ from, to });
                    return { fen: makeFen(pos.toSetup()), move: "" };
                }),
            ),
        ];
        const probes = [...new Map(decisions.map((d) => [`${d.fen}:${d.move}`, d])).values()].map(
            (d, i) => ({
                id: `${row.id}:${i}`,
                fen: d.fen,
                ...(d.move ? { searchMove: d.move } : {}),
            }),
        );
        return { ...row, proof, probes };
    });
}

test.each(cases)("a real quiet mating attack survives root-only and full input: $id", (row) => {
    for (const pvUci of [row.moves.slice(0, 1), row.moves]) {
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ label: "Mating Attack", ply: 1, value: row.gain });
    }
});

test.skipIf(!process.env.TACTICAL_SHORT_THREAT_RECALL_PROBES)(
    "export real quiet-mating recall decisions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const rows = auditedCases();
        expect(rows).toHaveLength(4);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_SHORT_THREAT_RECALL_PROBES!),
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

test("fresh engine evidence validates retained real mating-attack decisions", () => {
    const receipt = JSON.parse(
        readFileSync(
            process.env.TACTICAL_SHORT_THREAT_RECALL_ENGINE ??
                "benchmarks/tactical-relevance/short-mating-threat-recall-stockfish-18.json",
            "utf8",
        ),
    );
    expect(receipt.completed ?? receipt.searches.length).toBe(
        receipt.requested ?? receipt.searches.length,
    );
    const records = new Map<string, any>(
        receipt.searches.map((r: any) => [`${r.fen}:${r.searchMove ?? r.move ?? ""}`, r]),
    );
    const exported = [];
    for (const row of auditedCases())
        for (const probe of row.probes) {
            const record = records.get(`${probe.fen}:${probe.searchMove ?? ""}`);
            expect(Boolean(record)).toBe(true);
            const best = record.lines?.[0] ?? record;
            expect(best.depth).toBe(16);
            const side = probe.fen.split(" ")[1] === row.fen.split(" ")[1] ? 1 : -1;
            expect(
                (best.cp !== null && best.cp * side > 0) ||
                    (best.mate !== null && best.mate * side > 0),
            ).toBe(true);
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
    if (process.env.TACTICAL_SHORT_THREAT_RECALL_PUBLIC)
        writeFileSync(
            process.env.TACTICAL_SHORT_THREAT_RECALL_PUBLIC,
            JSON.stringify(
                {
                    scope: "Two reused CC0 game positions and constructed colour reflections; finite engine estimates, not new held-out accuracy.",
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
    "the committed baseline misses both real quiet mating attacks",
    async () => {
        const baseline = await import(process.env.TACTICAL_SHORT_THREAT_BASELINE!);
        for (const row of cases) {
            const root = baseline.replayTacticalLine(row.fen, row.moves)[0];
            expect(baseline.proveQuietMatingAttack(root)).toBeNull();
        }
    },
);
