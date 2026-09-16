import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { persistentPawnExchangeContext } from "../tacticalMotifs/gameHistory";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { provePersistentPawnCapture, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { settledPawnHistoryCases } from "./fixtures/settledPawnHistory";

test.each(settledPawnHistoryCases)(
    "a settled exchange does not create historical debt: $id",
    (row) => {
        const step = replayTacticalLine(row.fen, row.pvUci)[0];
        expect(step).toBeDefined();
        expect(
            persistentPawnExchangeContext(row.tacticalHistory, row.fen, step.move)?.balance,
        ).toBe(row.positive ? 0 : -320);
        const proof = provePersistentPawnCapture(step, row.tacticalHistory);
        expect(proof ? { gain: proof.gain, balance: proof.exchangeBalance } : null).toEqual(
            row.positive ? { gain: 100, balance: 0 } : null,
        );
        const scan = buildLiveTacticalScan({
            ...row,
            depth: 16,
            engineName: "Constructed history, synthetic selection score",
            variations: [{ pvUci: row.pvUci, cp: 100, depth: 16 }],
        });
        expect(scan.motifs.map((m) => m.label)).toEqual(row.positive ? ["Hanging Pawn"] : []);
    },
);

test("missing early exchange history cannot gain the same credit", () => {
    const row = settledPawnHistoryCases[0];
    const history = replayTacticalLine(row.tacticalHistory.fen, row.tacticalHistory.moves);
    const root = replayTacticalLine(row.fen, row.pvUci)[0];
    const truncated = {
        fen: makeFen(history[6].after.toSetup()),
        moves: row.tacticalHistory.moves.slice(7),
    };
    expect(provePersistentPawnCapture(root, truncated)).toBeNull();
    expect(provePersistentPawnCapture(root, undefined)).toBeNull();
});

test.skipIf(!process.env.TACTICAL_SETTLED_HISTORY_OWNER)(
    "a real later pawn capture survives its earlier knight exchange",
    () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_SETTLED_HISTORY_OWNER!, "utf8"),
        );
        const row = report.results.find((r: any) => r.id === "recall:174476976620:ply40");
        expect(row).toBeDefined();
        const scan = buildLiveTacticalScan({
            ...row,
            ...row.before[0],
            variations: row.before,
            engineName: "Stockfish 18",
        });
        expect(scan.motifs[0]).toMatchObject({
            id: "hangingPiece",
            label: "Hanging Pawn",
            moveUci: "a7d4",
            value: 100,
        });
        const input = {
            ...row,
            bestMoveUci: row.before[0].pvUci[0],
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            cpBefore: row.before[0].cp,
            cpAfter: -row.after[0].cp,
            cpLoss: row.before[0].cp + row.after[0].cp,
            bestCandidates: row.before.map((line: any) => ({ fen: row.fen, ...line })),
            refutationCandidates: row.after.map((line: any) => ({ fen: row.afterFen, ...line })),
        };
        const result = classifyMistakeReviewMotifs(input);
        // Recover the overlooked alternative without replacing the much larger
        // queen-for-bishop loss that actually explains this mistake.
        expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
            source: "allowed",
            value: 570,
        });
        expect(result.missedMotifs).toContainEqual(
            expect.objectContaining({
                label: "Hanging Pawn",
                moveUci: "a7d4",
                value: 100,
            }),
        );
        expect(
            classifyMistakeReviewMotifs({ ...input, playedMoveUci: "a7d4" }).missedMotifs,
        ).toEqual([]);
    },
);

test.skipIf(
    !process.env.TACTICAL_SETTLED_HISTORY_OWNER || !process.env.TACTICAL_SETTLED_HISTORY_PROBES,
)("export fresh owner and contrary exchange-history engine probes", async () => {
    const { privateReportPath } =
        await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const report = JSON.parse(readFileSync(process.env.TACTICAL_SETTLED_HISTORY_OWNER!, "utf8"));
    const row = report.results.find((r: any) => r.id === "recall:174476976620:ply40");
    if (!row) throw new Error("Missing frozen owner position");
    const probes = [];
    for (const c of [{ id: "owner", fen: row.fen, pvUci: ["a7d4"] }, ...settledPawnHistoryCases]) {
        probes.push(
            { id: `${c.id}:best`, fen: c.fen },
            { id: `${c.id}:capture`, fen: c.fen, searchMove: c.pvUci[0] },
        );
        const root = replayTacticalLine(c.fen, c.pvUci)[0];
        if (!root) throw new Error("Illegal probe root");
        probes.push({ id: `${c.id}:after`, fen: makeFen(root.after.toSetup()) });
        if (c.id === "owner")
            for (const [from, dests] of root.after.allDests())
                for (const to of dests) {
                    const move = parseUci(makeUci({ from, to }))!;
                    const next = root.after.clone();
                    next.play(move);
                    probes.push({
                        id: `owner:reply-${makeUci(move)}`,
                        fen: makeFen(next.toSetup()),
                    });
                }
    }
        expect(new Set(probes.map(probe => probe.id)).size).toBe(probes.length);
        expect(probes.length).toBeGreaterThan(15);
        writeFileSync(
        privateReportPath(process.env.TACTICAL_SETTLED_HISTORY_PROBES!),
        JSON.stringify({ samplePath: process.env.TACTICAL_SETTLED_HISTORY_OWNER, probes }, null, 2),
        { flag: "wx" },
    );
});
