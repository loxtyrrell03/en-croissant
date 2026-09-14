import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import sample from "../../../benchmarks/tactical-relevance/preparation-safety-development.json";
import {
    proveCheckingForkPreparation,
    proveQuietDoubleThreat,
    replayTacticalLine,
    tacticalExchangeGain,
} from "@/utils/tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

const mirrorMove = (move: string) => move.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
const rows = sample.cases.flatMap((row) => {
    const fields = row.fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = fields[1] === "w" ? "b" : "w";
    return [
        row,
        {
            ...row,
            id: `${row.id}:reflected`,
            fen: fields.join(" "),
            root: mirrorMove(row.root),
            pvUci: row.pvUci.map(mirrorMove),
            resourceUci: row.resourceUci?.map(mirrorMove),
        },
    ];
});
const prove = (row: (typeof rows)[number], onFailure?: (reason: string) => void) =>
    row.kind === "quiet"
        ? proveQuietDoubleThreat(replayTacticalLine(row.fen, [row.root])[0], 8192, onFailure)
        : proveCheckingForkPreparation(replayTacticalLine(row.fen, [row.root])[0], 4096, onFailure);

test.each(rows)("$id has a legal, liability-aware root certificate", (row) => {
    expect(Chess.fromSetup(parseFen(row.fen).unwrap()).isOk).toBe(true);
    expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(row.pvUci.length);
    expect(replayTacticalLine(row.fen, row.resourceUci ?? [])).toHaveLength(
        row.resourceUci?.length ?? 0,
    );
    const failures: string[] = [];
    const proof = prove(row, (reason) => failures.push(reason));
    assert.equal(Boolean(proof), row.expectedProof, JSON.stringify({ id: row.id, failures }));
    // These selected counterexamples have a concrete unresolved defence;
    // they are not just making the operation budget run out.
    expect(failures.some((reason) => reason.includes("exhausted"))).toBe(false);
    const theme = row.kind === "quiet" ? "doubleThreat" : "forkPreparation";
    for (const pvUci of [[row.root], row.pvUci]) {
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
        expect(result.motifs.some((m) => m.id === theme && m.ply === 1)).toBe(row.expectedProof);
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            pvUci,
            depth: 16,
            engineName: "Safety regression",
        });
        expect(scan.motifs.some((m) => m.id === theme && m.ply === 1)).toBe(row.expectedProof);
        expect(!row.expectedProof || result.motifs[0]?.id === theme).toBe(true);
    }
});

test("the real Nd7 proof replaces a mating blunder with the checking fork", () => {
    const row = sample.cases[0];
    const oldWitness = replayTacticalLine(row.fen, row.resourceUci!);
    expect(oldWitness.at(-1)!.after.isCheckmate()).toBe(true);
    const proof = proveQuietDoubleThreat(replayTacticalLine(row.fen, [row.root])[0]);
    expect(proof).toMatchObject({ gain: 250 });
    expect(proof?.branches).toContainEqual({ reply: "Bd3", answer: "Nf6+", kind: "fork" });
    expect(proof?.branches).not.toContainEqual({ reply: "Bd3", answer: "Nxb6", kind: "capture" });
    expect(proof?.branches).toContainEqual({ reply: "Rc8", answer: "Nf6+", kind: "fork" });
    expect(proof?.branches).toContainEqual({ reply: "Qd1", answer: "Rxd1", kind: "capture" });
    expect(proof?.branches).toContainEqual({ reply: "Rbb8", answer: "Nf6+", kind: "fork" });
    expect(proof?.branches).toContainEqual({ reply: "Rab8", answer: "Nf6+", kind: "fork" });
    const material = replayTacticalLine(row.fen, ["c5d7", "b6a6", "d7f6", "g8f8", "f6h5", "g6h5"]);
    expect(material).toHaveLength(6);
    expect(
        material.reduce(
            (gain, step, index) => gain + (index % 2 ? -step.capture : step.capture),
            0,
        ),
    ).toBe(250);
    const longerMate = replayTacticalLine(row.fen, [
        "c5d7",
        "a8c8",
        "d7b6",
        "c8c2",
        "f2e1",
        "h5e2",
    ]);
    expect(longerMate).toHaveLength(6);
    expect(longerMate.at(-1)!.after.isCheckmate()).toBe(true);
    const continuation = classifyPositionTacticalMotifs({
        fen: row.fen,
        pvUci: ["c5d7", "f5d3", "d7f6", "g8g7", "f6h5"],
    });
    expect(continuation.motifs[0]).toMatchObject({ id: "doubleThreat", ply: 1 });
    expect(continuation.timeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
});

test("an allied capture of the moved original target preserves the real combination", () => {
    const row = sample.cases.find((row) => row.id === "constructed:fork-payoff-rook-liability")!;
    expect(
        proveQuietDoubleThreat(replayTacticalLine(row.fen, [row.root])[0])?.branches,
    ).toContainEqual({ reply: "Rbxa6", answer: "Rxa6", kind: "capture" });
    const line = ["c5d7", "b6a6", "a1a6", "a8a6", "b5a6"];
    expect(replayTacticalLine(row.fen, line)).toHaveLength(line.length);
});

test("off-square liabilities are actual legal profitable captures", () => {
    for (const id of [
        "constructed:double-threat-queen-liability",
        "constructed:fork-payoff-rook-liability",
        "constructed:double-threat-counterattack",
        "constructed:checking-preparation-queen-liability",
    ]) {
        const row = sample.cases.find((row) => row.id === id)!;
        const resource = replayTacticalLine(row.fen, row.resourceUci!).at(-1)!;
        expect(tacticalExchangeGain(resource.before, resource.move)).toBeGreaterThanOrEqual(500);
    }
    const row = sample.cases.find((row) => row.id === "constructed:double-threat-promotion")!;
    const promotion = replayTacticalLine(row.fen, row.resourceUci!).at(-1)!;
    expect(promotion.move.promotion).toBe("queen");
});

test.each(rows.filter((row) => !row.expectedProof))(
    "$id cannot become a missed preparation lesson",
    (row) => {
        const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
        const alternatives = [...pos.allDests()]
            .flatMap(([from, dests]) => [...dests].map((to) => ({ from, to })))
            .filter(
                (move) =>
                    pos.isLegal(move) && makeUci(move) !== row.root && !pos.board.get(move.to),
            );
        expect(alternatives.length).toBeGreaterThan(0);
        const result = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: makeUci(alternatives[0]),
            bestMoveUci: row.root,
            pvUci: row.pvUci,
            refutationUci: [],
        });
        const theme = row.kind === "quiet" ? "doubleThreat" : "forkPreparation";
        expect(result.missedMotifs.some((m) => m.id === theme && m.ply === 1)).toBe(false);
    },
);

test.each([0, -1, 1.5, NaN, Infinity, -Infinity])(
    "invalid preparation budget %s fails closed after a warm cache",
    (limit) => {
        const quiet = replayTacticalLine(sample.cases[0].fen, [sample.cases[0].root])[0];
        const checking = replayTacticalLine(sample.cases[1].fen, [sample.cases[1].root])[0];
        expect(proveQuietDoubleThreat(quiet)).not.toBeNull();
        expect(proveCheckingForkPreparation(checking)).not.toBeNull();
        expect(proveQuietDoubleThreat(quiet, limit)).toBeNull();
        expect(proveCheckingForkPreparation(checking, limit)).toBeNull();
    },
);

test.skipIf(!process.env.TACTICAL_PREPARATION_PROBES)(
    "export exact public root and defence searches for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const probes: { id: string; fen: string; searchMove?: string }[] = [];
        for (const row of sample.cases) {
            probes.push(
                { id: `${row.id}:root`, fen: row.fen },
                { id: `${row.id}:root-fixed`, fen: row.fen, searchMove: row.root },
            );
            const proof = prove(row);
            if (proof)
                for (const branch of proof.branches) {
                    const pos = replayTacticalLine(row.fen, [row.root])[0].after.clone();
                    const reply = parseSan(pos, branch.reply)!;
                    assert(reply);
                    pos.play(reply);
                    const answer = parseSan(pos, branch.answer)!;
                    assert(answer);
                    probes.push({
                        id: `${row.id}:witness:${makeUci(reply)}`,
                        fen: makeFen(pos.toSetup()),
                        searchMove: makeUci(answer),
                    });
                }
            if (row.resourceUci) {
                const replay = replayTacticalLine(row.fen, row.resourceUci);
                probes.push({
                    id: `${row.id}:resource`,
                    fen: makeFen(replay.at(-1)!.before.toSetup()),
                    searchMove: replay.at(-1)!.uci,
                });
                probes.push({
                    id: `${row.id}:defence-choice`,
                    fen: makeFen(replay[1].after.toSetup()),
                });
                probes.push({
                    id: `${row.id}:unsafe-answer`,
                    fen: makeFen(replay[2].before.toSetup()),
                    searchMove: replay[2].uci,
                });
            }
        }
        expect(probes.length).toBeGreaterThan(14);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_PREPARATION_PROBES!),
            JSON.stringify(
                {
                    samplePath: "benchmarks/tactical-relevance/preparation-safety-development.json",
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(
    !process.env.TACTICAL_PREPARATION_PRIVATE_INPUT ||
        !process.env.TACTICAL_PREPARATION_PRIVATE_PROBES,
)(
    "inspect changed private continuation certificates without publishing source positions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const source = JSON.parse(
            readFileSync(process.env.TACTICAL_PREPARATION_PRIVATE_INPUT!, "utf8"),
        );
        const cases = source.results.flatMap((group: { cases: any[] }) => group.cases);
        const probes: { id: string; fen: string; searchMove?: string }[] = [];
        for (const [id, index, lane] of [
            ["private-easy:21", 6, "source"],
            ["engine-game:6:ply32", 9, "engine"],
        ] as const) {
            const row = cases.find((row: any) => row.id === id);
            assert(row);
            const line = lane === "source" ? row.sourceUci : row.engineLines[0].pvUci;
            const root = replayTacticalLine(row.fen, line)[index];
            const proof = proveCheckingForkPreparation(root);
            assert(proof);
            const fen = makeFen(root.before.toSetup());
            probes.push(
                { id: `${id}:root`, fen },
                { id: `${id}:root-fixed`, fen, searchMove: root.uci },
            );
            for (const branch of proof.branches) {
                const pos = root.after.clone(),
                    reply = parseSan(pos, branch.reply);
                assert(reply);
                pos.play(reply);
                const answer = parseSan(pos, branch.answer);
                assert(answer);
                probes.push({
                    id: `${id}:answer:${makeUci(reply)}`,
                    fen: makeFen(pos.toSetup()),
                    searchMove: makeUci(answer),
                });
                pos.play(answer);
                for (const [from, dests] of pos.allDests())
                    for (const to of dests) {
                        // These reached boards have no promotion candidate; reject
                        // silently incomplete nomination if that fixture changes.
                        assert(!(pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)));
                        const defence = { from, to };
                        assert(pos.isLegal(defence));
                        const leaf = pos.clone();
                        leaf.play(defence);
                        probes.push({
                            id: `${id}:payoff:${makeUci(reply)}:${makeUci(defence)}`,
                            fen: makeFen(leaf.toSetup()),
                        });
                    }
            }
        }
        expect(probes.length).toBeGreaterThan(4);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_PREPARATION_PRIVATE_PROBES!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_PREPARATION_PRIVATE_INPUT,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
