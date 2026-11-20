import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";
import { classifyProvedMistakeNature } from "@/utils/tacticalMotifs/mistakeNature";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type {
    DecisionAssessmentInput,
    DecisionAssessment,
} from "@/utils/tacticalMotifs/decisionAssessment";

type Case = DecisionAssessmentInput & { id: string; label?: object };

function legacy(input: Case) {
    const best = input.candidates[0];
    if (input.playedMoveUci) {
        const comparison = input.comparisonCandidates ?? input.candidates;
        const best = comparison[0];
        const played = comparison.find((line) => line.pvUci[0] === input.playedMoveUci);
        const replies = input.replyProbes?.find((p) => p.moveUci === input.playedMoveUci)?.lines;
        const sign = input.fen.split(" ")[1] === "b" ? -1 : 1;
        const nature = classifyProvedMistakeNature({
            fen: input.fen,
            bestMoveUci: best.pvUci[0],
            playedMoveUci: input.playedMoveUci,
            pvUci: best.pvUci,
            refutationUci: replies?.[0]?.pvUci,
            bestCandidates: comparison,
            refutationCandidates: replies,
            cpBefore: best.cp == null ? null : best.cp * sign,
            cpAfter: played?.cp == null ? null : played.cp * sign,
            cpLoss: best.cp == null || played?.cp == null ? null : Math.max(0, best.cp - played.cp),
            reachedDepth: Math.min(best.depth, replies?.[0]?.depth ?? 0),
            tacticalHistory: input.history,
        });
        return {
            tactical: nature.nature === "tactical",
            positional: nature.nature === "positional",
            basis: nature.confidence,
            category: nature.nature,
        };
    }
    const scan = buildLiveTacticalScan({
        fen: input.fen,
        pvUci: best.pvUci,
        depth: best.depth,
        engineName: "Stockfish 19",
        tacticalHistory: input.history,
        variations: input.candidates.map((line, index) => ({ ...line, multipv: index + 1 })),
    });
    const motifs = scan.variations.find((line) => line.lineUci[0] === best.pvUci[0])?.motifs ?? [];
    const rootMotifs = motifs.filter((motif) => motif.ply === 1 && motif.moveUci === best.pvUci[0]);
    return {
        tactical: rootMotifs.length > 0,
        allLeading: scan.variations.some((line) => line.motifs.length > 0),
        ...(process.env.DECISION_SCORE_ROOT_MOTIFS ? { motifs: rootMotifs.map((motif) => motif.id) } : {}),
    };
}

function compact(output: DecisionAssessment | null | undefined) {
    return {
        category: output?.category ?? "unavailable",
        tactical: output?.tactical.support === "supported",
        positional: output?.positional.support === "supported",
        tacticalBasis: output?.tactical.basis,
        positionalBasis: output?.positional.basis,
    };
}

test("scores the same archived inputs through the original or current classifier", () => {
    const rows = JSON.parse(readFileSync(process.env.DECISION_SCORE_INPUT!, "utf8")) as Case[];
    const preRebuild = process.env.DECISION_SCORE_ARM === "original";
    const result = rows
        .filter((row) => !!row.label)
        .map((row) => {
            const start = performance.now();
            if (preRebuild) {
                const output = legacy(row);
                return { id: row.id, ...output, ms: performance.now() - start };
            }
            const result = classify(row, "Stockfish 19", row.history);
            const output = compact(row.playedMoveUci ? result?.mistake : result?.position);
            return { id: row.id, ...output, ms: performance.now() - start };
        });
    writeFileSync(process.env.DECISION_SCORE_OUTPUT!, JSON.stringify(result), { flag: "wx" });
}, 220_000);
