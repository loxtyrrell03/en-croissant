import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { assessChessDecision, type DecisionAssessmentInput } from "../tacticalMotifs/decisionAssessment";
import { findForkInReplies } from "./fixtures/decisionForkRepliesCandidate";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

type Row = {
    id: string;
    fen: string;
    move: string;
    paired: DecisionAssessmentInput["candidates"];
    withReplies: NonNullable<DecisionAssessmentInput["replyProbes"]>;
};

const input = process.env.DECISION_EXACT_FORK_INPUT;
const output = process.env.DECISION_EXACT_FORK_OUTPUT;

test.runIf(input && output)("reads exact-fork evidence in the live and decision analyzers", () => {
    const cases = JSON.parse(readFileSync(input!, "utf8")) as Row[];
    const results = cases.map(row => {
        const exact = row.paired.find(candidate => candidate.pvUci[0] === row.move);
        expect(exact).toBeDefined();
        const line = exact!;
        const scan = buildLiveTacticalScan({
            fen: row.fen, pvUci: line.pvUci, depth: line.depth, engineName: "Stockfish benchmark",
            variations: [{ depth: line.depth, pvUci: line.pvUci, cp: line.cp, mate: line.mate }],
        });
        const rootMotifs = scan.variations[0].motifs.filter(motif => motif.ply === 1 && motif.moveUci === row.move);
        const decision = assessChessDecision({
            fen: row.fen, candidates: row.paired, replyProbes: row.withReplies,
            rootCertificates: [{ fen: row.fen, moveUci: row.move, motifs: rootMotifs }],
        });
        const move = decision?.moves.find(candidate => candidate.moveUci === row.move);
        return {
            id: row.id,
            rootMotifs: rootMotifs.map(motif => motif.id),
            replyFork: findForkInReplies(row.fen, line, row.withReplies[0]?.lines ?? []),
            decision: move && {
                category: move.category,
                tactical: move.tactical.support,
                positional: move.positional.support,
                rootMotifs: move.verifiedMotifs.map(motif => motif.id),
                mechanisms: move.mechanisms.filter(mechanism => mechanism.rootMoveInvolved && mechanism.mechanismPly === 1),
            },
        };
    });
    writeFileSync(output!, JSON.stringify(results), { flag: "wx" });
}, 360_000);
