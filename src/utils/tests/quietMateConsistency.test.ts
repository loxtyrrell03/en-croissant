import { expect, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import type { Chess } from "chessops/chess";
import type { NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import {
    proveMateBackedFork,
    proveMateWithinThree,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    reflectMatingInterference,
    rookMatingInterferenceFen,
    matingInterferenceCases,
} from "./fixtures/matingInterference";

type QuietMateCase = { id: string; startFen: string; bestLine: string[]; stratum: string };
const sample: { cases: QuietMateCase[] } = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/quiet-mate-development.json", "utf8"),
);
const reflected = sample.cases.map((row) => ({
    ...row,
    id: `${row.id}:reflected`,
    startFen: reflectMatingInterference({ fen: row.startFen, move: row.bestLine[0] }).fen,
    bestLine: row.bestLine.map(
        (move) => reflectMatingInterference({ fen: row.startFen, move }).move,
    ),
}));
function legalMoves(pos: Chess): NormalMove[] {
    return [...pos.allDests()].flatMap(([from, dests]) =>
        [...dests].flatMap((to) =>
            pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) => ({
                      from,
                      to,
                      promotion,
                  }))
                : [{ from, to }],
        ),
    );
}
function play(pos: Chess, uci: string) {
    const move = parseUci(uci)!;
    expect(pos.isLegal(move)).toBe(true);
    const next = pos.clone();
    next.play(move);
    return next;
}
// Independent legal replay checks the entire AND/OR certificate, not the
// one illustrative PV or the search function's boolean answer.
function checkCertificate(fen: string, line: string[]) {
    const root = replayTacticalLine(fen, line.slice(0, 1))[0];
    const proof = proveMateWithinThree([root]);
    expect(proof).not.toBeNull();
    expect(proof!.visits).toBeLessThanOrEqual(16384);
    expect(proof!.branches.map((branch) => branch.replyUci).sort()).toEqual(
        legalMoves(root.after).map(makeUci).sort(),
    );
    const probes: { id: string; fen: string; searchMove: string; mateWithin: number }[] = [];
    for (const branch of proof!.branches) {
        const afterReply = play(root.after, branch.replyUci);
        probes.push({
            id: `answer:${branch.replyUci}`,
            fen: makeFen(afterReply.toSetup()),
            searchMove: branch.attackUci,
            mateWithin: branch.replies ? 2 : 1,
        });
        const attack = play(afterReply, branch.attackUci);
        if (!branch.replies) assert.equal(attack.isCheckmate(), true);
        else {
            assert(branch.replies.length > 0);
            assert.deepEqual(
                branch.replies.map((reply) => reply.replyUci).sort(),
                legalMoves(attack).map(makeUci).sort(),
            );
            for (const reply of branch.replies) {
                const after = play(attack, reply.replyUci);
                assert.equal(play(after, reply.mateUci).isCheckmate(), true);
                probes.push({
                    id: `mate:${branch.replyUci}:${reply.replyUci}`,
                    fen: makeFen(after.toSetup()),
                    searchMove: reply.mateUci,
                    mateWithin: 1,
                });
            }
        }
    }
    expect(proof!.replyCount).toBe(proof!.branches.length);
    return { proof, probes };
}

test.each([
    {
        id: "interference",
        fen: rookMatingInterferenceFen,
        line: ["e6e7", "b7e7", "g5f6", "h8h7", "f6h4"],
    },
    {
        id: "quiet-king-approach",
        fen: "7k/7p/5Kp1/7Q/8/8/8/8 w - - 0 1",
        line: ["h5h2", "h7h5", "f6g6", "h8g8", "h2b8"],
    },
])("a quiet mate preparation does not depend on PV length: $id", ({ fen, line }) => {
    checkCertificate(fen, line);
    for (const length of [1, 2, 3, 4, 5]) {
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line.slice(0, length) });
        expect(result.motifs[0]).toMatchObject({
            id: "mateIn3",
            label: "Mating Preparation",
            ply: 1,
            value: 10000,
        });
    }
});

test("audit the frozen unseen Lichess quiet-mate sample without treating tags as proof", () => {
    expect(sample.cases).toHaveLength(9);
    const cases = sample.cases.map((row) => {
        const steps = replayTacticalLine(row.startFen, row.bestLine);
        expect(steps).toHaveLength(row.bestLine.length);
        const proof = proveMateWithinThree(steps.slice(0, 1));
        const full = classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine });
        const short = classifyPositionTacticalMotifs({
            fen: row.startFen,
            pvUci: row.bestLine.slice(0, 1),
        });
        const probes = [
            { id: `${row.id}:best`, fen: row.startFen },
            { id: `${row.id}:root`, fen: row.startFen, searchMove: row.bestLine[0] },
            ...(proof
                ? checkCertificate(row.startFen, row.bestLine).probes.map((probe) => ({
                      ...probe,
                      id: `${row.id}:${probe.id}`,
                  }))
                : []),
        ];
        return { ...row, proof, full, short, probes };
    });
    if (process.env.TACTICAL_QUIET_MATE_SAMPLE_REPORT)
        writeFileSync(
            process.env.TACTICAL_QUIET_MATE_SAMPLE_REPORT,
            JSON.stringify(
                {
                    samplePath: "benchmarks/tactical-relevance/quiet-mate-development.json",
                    scope: "New output-blind sample. Six short-mate certificates and three retained longer-mate coverage gaps, not nine correct answers.",
                    cases,
                    probes: cases.flatMap((row) => row.probes),
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
});

test.each([...sample.cases, ...reflected].filter((row) => row.stratum === "mateIn4" && !/^lichess:(0rcU4|0QPvf)/.test(row.id)))(
    "the new attack proof recovers a lesson without claiming the longer mate distance: $id",
    (row) => {
        expect(proveMateWithinThree(replayTacticalLine(row.startFen, row.bestLine))).toBeNull();
        const result = classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine });
        expect(result.motifs).toEqual([expect.objectContaining({
            id: "forcingAttack", label: "Mating Attack", ply: 1,
            value: row.id.startsWith("lichess:0z5nl") ? 100 : 500,
        })]);
    },
);

test.each([...sample.cases, ...reflected].filter(row => /^lichess:(0rcU4|0QPvf)/.test(row.id)))(
    "the longer all-defence proof upgrades the recovered mating attack: $id", row => {
        expect(proveMateWithinThree(replayTacticalLine(row.startFen, row.bestLine))).toBeNull();
        const result = classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine });
        expect(result.motifs[0]).toMatchObject({ id: "mateIn4", label: "Forcing Mate", ply: 1 });
        // Root-only input still uses the existing material-or-mate threat
        // certificate; an absent full line cannot invent the longer distance.
        const short = classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine.slice(0, 1) });
        expect(short.motifs.some(motif => motif.id === "mateIn4")).toBe(false);
    },
);

test.each([...sample.cases, ...reflected].filter((row) => row.stratum !== "mateIn4"))(
    "root proof, main lesson and real-ply payoff: $id",
    (row) => {
        checkCertificate(row.startFen, row.bestLine);
        const expected = row.stratum === "mateIn2" ? "mateThreat" : "mateIn3";
        for (let length = 1; length <= row.bestLine.length; length++) {
            const result = classifyPositionTacticalMotifs({
                fen: row.startFen,
                pvUci: row.bestLine.slice(0, length),
            });
            expect(result.motifs[0]).toMatchObject({ id: expected, ply: 1, value: 10000 });
            expect(result.motifs.filter((m) => m.ply === 1)).toHaveLength(1);
            expect(result.timeline?.some((m) => m.ply === row.bestLine.length)).toBe(
                length === row.bestLine.length,
            );
            const scan = buildLiveTacticalScan({
                fen: row.startFen,
                pvUci: row.bestLine.slice(0, length),
                depth: 16,
                engineName: "Regression",
            });
            expect(scan.arrows).toEqual([
                {
                    from: row.bestLine[0].slice(0, 2),
                    to: row.bestLine[0].slice(2, 4),
                    ply: 1,
                    role: "trigger",
                },
            ]);
        }
    },
);

test("a mating-backed fork is not another material lesson beside a separately proved quiet mate", () => {
    const row = sample.cases.find((row) => row.id === "lichess:0hHGN")!;
    const root = replayTacticalLine(row.startFen, row.bestLine)[0];
    expect(proveMateBackedFork(root)?.matingDefences).toContainEqual(
        expect.objectContaining({ defence: "Bxf6" }),
    );
    expect(
        classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: [row.bestLine[0]] }).motifs.map(
            (m) => m.id,
        ),
    ).toEqual(["mateIn3"]);
});

test("quiet proof cache cannot bypass invalid, exhausted or drawing bounds", () => {
    const row = sample.cases.find((row) => row.id === "lichess:0IJ6I")!;
    const root = replayTacticalLine(row.startFen, [row.bestLine[0]]);
    expect(proveMateWithinThree(root)).not.toBeNull();
    for (const limit of [0, 1, -1, 1.5, NaN, Infinity])
        expect(proveMateWithinThree(root, limit)).toBeNull();
    expect(proveMateWithinThree([])).toBeNull();
    const drawFen = row.startFen.replace("0 47", "99 47");
    expect(proveMateWithinThree(replayTacticalLine(drawFen, [row.bestLine[0]]))).toBeNull();
    const stalemate = replayTacticalLine("7k/5K2/8/5Q2/8/8/8/8 w - - 0 1", ["f5g6"]);
    expect(stalemate[0].after.isStalemate()).toBe(true);
    expect(proveMateWithinThree(stalemate)).toBeNull();
});

test("check complete constructed mate certificates and retain their contrary defences", () => {
    const examples = [
        ...matingInterferenceCases
            .filter((row) => ["rook-interposition", "extra-diagonal-defender"].includes(row.id))
            .map((row) => ({ id: row.id, fen: row.fen, line: [row.move] })),
        { id: "quiet-king-approach", fen: "7k/7p/5Kp1/7Q/8/8/8/8 w - - 0 1", line: ["h5h2"] },
    ];
    const cases = examples.map((row) => ({ ...row, ...checkCertificate(row.fen, row.line) }));
    const probes: { id: string; fen: string; searchMove: string; mateWithin?: number }[] =
        cases.flatMap((row) => [
            { id: `${row.id}:root`, fen: row.fen, searchMove: row.line[0], mateWithin: 3 },
            ...row.probes.map((probe) => ({ ...probe, id: `${row.id}:${probe.id}` })),
        ]);
    const controls = matingInterferenceCases.filter((row) =>
        ["queen-countercheck", "missing-mate-support", "checking-resource"].includes(row.id),
    );
    for (const row of controls) {
        expect(proveMateWithinThree(replayTacticalLine(row.fen, [row.move]))).toBeNull();
        probes.push({ id: `${row.id}:root`, fen: row.fen, searchMove: row.move });
    }
    const bishopCheck = "7k/7p/5Kp1/7Q/8/8/8/2b5 w - - 0 1";
    expect(proveMateWithinThree(replayTacticalLine(bishopCheck, ["h5h2"]))).toBeNull();
    probes.push({ id: "bishop-countercheck:root", fen: bishopCheck, searchMove: "h5h2" });
    if (process.env.TACTICAL_QUIET_MATE_CONTROL_REPORT)
        writeFileSync(
            process.env.TACTICAL_QUIET_MATE_CONTROL_REPORT,
            JSON.stringify(
                {
                    samplePath: "benchmarks/tactical-relevance/quiet-mate-development.json",
                    scope: "Complete constructed certificates and contrary-defence controls. Null proof is not necessarily a losing move.",
                    cases,
                    probes,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
});

test("an underpromotion used by one defence stays secondary at its actual move", () => {
    const row = matingInterferenceCases.find((row) => row.id === "extra-diagonal-defender")!;
    const pvUci = ["e6e7", "h8h7", "e7f8n", "a8f8", "g5h4"];
    const steps = replayTacticalLine(row.fen, pvUci);
    expect(steps).toHaveLength(5);
    expect(steps[2].after.isCheck()).toBe(true);
    expect(steps[4].after.isCheckmate()).toBe(true);
    const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn3", ply: 1 });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({
            id: "underPromotion",
            ply: 3,
            moveUci: "e7f8n",
            relevance: "secondary",
        }),
    );
    expect(result.motifs.some((m) => m.id === "interference")).toBe(false);
});

test.skipIf(!process.env.TACTICAL_QUIET_MATE_INPUT || !process.env.TACTICAL_QUIET_MATE_REPORT)(
    "audit every eligible quiet source and engine root across frozen game phases",
    () => {
        const privateRows = JSON.parse(
            readFileSync(process.env.TACTICAL_QUIET_MATE_INPUT!, "utf8"),
        ).results.flatMap((group: any) => group.cases);
        expect(privateRows).toHaveLength(246);
        const publicRows = ["broader-game", "black-context", "cross-phase"].flatMap((name) =>
            JSON.parse(
                readFileSync(`benchmarks/tactical-relevance/${name}-stockfish-18.json`, "utf8"),
            ).cases.map((row: any) => ({ ...row, id: `${name}:${row.id}`, public: true })),
        );
        const candidates = [...privateRows, ...publicRows]
            .flatMap((row: any) => [
                {
                    id: `${row.id}:source`,
                    fen: row.fen,
                    line: row.sourceUci,
                    public: Boolean(row.public),
                },
                {
                    id: `${row.id}:engine`,
                    fen: row.fen,
                    line: row.engineLines?.[0]?.pvUci,
                    public: Boolean(row.public),
                },
            ])
            .filter((row) => row.line?.length);
        const cases = candidates.flatMap((row) => {
            const root = replayTacticalLine(row.fen, row.line.slice(0, 1))[0];
            if (
                !root ||
                root.capture ||
                root.move.promotion ||
                root.before.isCheck() ||
                root.after.isCheck()
            )
                return [];
            const full = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.line });
            const short = classifyPositionTacticalMotifs({
                fen: row.fen,
                pvUci: row.line.slice(0, 1),
            });
            const proof = proveMateWithinThree([root]);
            if (
                proof &&
                (!short.motifs[0] || !["mateIn3", "mateThreat"].includes(short.motifs[0].id))
            )
                throw new Error(`Unstable quiet mate primary: ${row.id}`);
            return [{ ...row, full, short, proof, rootAfter: makeFen(root.after.toSetup()) }];
        });
        writeFileSync(
            process.env.TACTICAL_QUIET_MATE_REPORT!,
            JSON.stringify(
                {
                    scope: "All eligible quiet source/engine roots from 246 fixed private positions and three public cross-phase corpora. Root-only versus full supplied continuation; not a population accuracy score.",
                    candidates: candidates.length,
                    cases,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
        expect(cases.length).toBeGreaterThan(100);
    },
    120000,
);
