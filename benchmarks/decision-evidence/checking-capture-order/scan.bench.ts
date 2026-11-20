import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { queries } from "../stockfish-test-harness";
import { gatherCheckingOrder } from "@/components/panels/tactics/decisionSearch";
import type { LocalEngine } from "@/utils/engines";
import { assessChessDecision, type DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { confirmCheckingOrder, findCheckingOrderChoice, nominateCheckingOrder } from "@/utils/tacticalMotifs/decisionCheckingOrder";
import type { DecisionEngineLine } from "@/utils/tacticalMotifs/decisionEvidence";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";

type Row = DecisionAssessmentInput & { id: string; event?: string; site?: string };
type AlternateInput = Row & { reference?: DecisionEngineLine[]; referenceReplies?: Record<string, DecisionEngineLine[]> };

const engine = {
    id: "test-stockfish",
    name: "Stockfish 19",
    type: "local",
    version: "19",
    path: process.env.CHECKING_ORDER_ENGINE!,
    settings: [],
} satisfies LocalEngine;

function readRows(file: string) {
    const raw = readFileSync(file, "utf8").trim();
    const rows = (raw.startsWith("[") ? JSON.parse(raw) : raw.split(/\r?\n/).map((line) => JSON.parse(line))) as AlternateInput[];
    return rows.map((row) => {
        if (!row.reference) return row;
        const candidates = row.reference.slice(0, 3);
        return { ...row, candidates, replyProbes: candidates.flatMap((line) => {
            const moveUci = line.pvUci[0];
            const replies = row.referenceReplies?.[moveUci];
            return replies?.length ? [{ moveUci, lines: replies }] : [];
        }) };
    });
}

function broad(fen: string, [best, ...choices]: DecisionEngineLine[]) {
    return choices.filter((choice) => {
        if (best.cp == null || choice.cp == null || best.cp - choice.cp < 100) return false;
        const [, check, , take] = replayTacticalLine(fen, choice.pvUci.slice(0, 4));
        return Boolean(check?.after.isCheck() && take?.capture);
    }).length;
}

test("replay check-order nominations and bounded app searches", async () => {
    const rows = readRows(process.env.CHECKING_ORDER_INPUT!);
    const results = [];
    for (const row of rows) {
        const broadCount = broad(row.fen, row.candidates);
        const positionChoice = findCheckingOrderChoice(row.fen, row.candidates);
        const pairs = row.comparisonCandidates ?? row.candidates;
        const played = pairs.find((line) => line.pvUci[0] === row.playedMoveUci);
        const playedChoice = played && nominateCheckingOrder(row.fen, pairs[0], played);
        const sample = { id: row.id, event: row.event, site: row.site, broadCount,
            positionNominated: !!positionChoice, mistakeNominated: !!playedChoice };
        if (!positionChoice && !playedChoice) {
            results.push(sample);
            continue;
        }
        const before = assessChessDecision(row);
        const signal = new AbortController().signal;
        const started = performance.now();
        const count = queries.length;
        const probe = await gatherCheckingOrder(engine, row, row, {
            mistake: !!before?.mistake,
            position: !!before && before.position.tactical.support !== "supported",
        }, signal, Date.now() + 7_000, () => {});
        const request = probe?.scope === "mistake" ? playedChoice : positionChoice;
        const proof = probe && request ? confirmCheckingOrder(row.fen, request, probe.lines, row.history) : null;
        const after = proof ? assessChessDecision({ ...row, checkingOrder: probe }) : before;
        results.push({ ...sample, positionBefore: before?.position.category, mistakeBefore: before?.mistake?.category,
            positionAfter: after?.position.category, mistakeAfter: after?.mistake?.category,
            scope: probe?.scope, proof, frames: probe?.lines,
            queries: queries.slice(count), milliseconds: Math.round(performance.now() - started) });
    }
    expect(results).toHaveLength(rows.length);
    writeFileSync(process.env.CHECKING_ORDER_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 180_000);
