import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { DecisionEngineLine } from "@/utils/tacticalMotifs/decisionEvidence";
import { measurePositionDecision } from "@/utils/tacticalMotifs/decisionEvidence";
import { confirmPositionRefutation } from "@/utils/tacticalMotifs/decisionPositionContrast";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "@/utils/tacticalMotifs/repetitionHistory";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";

type Frame = { requestedNodes: number; observedNodes: number; milliseconds: number; lines: DecisionEngineLine[] };
type Option = {
    moveUci: string;
    fen: string;
    alternative: DecisionEngineLine;
    defence: DecisionEngineLine;
    cached: DecisionEngineLine[];
};
type Row = {
    id: string;
    fen: string;
    candidates: DecisionEngineLine[];
    original: { tactical: boolean; positional: boolean; checked: boolean };
    options: Option[];
    history?: TacticalGameHistory;
};
type Arms = { id: string; options: Array<{ moveUci: string; nominated: string } & Record<string, Frame>> };

function legalHistory(row: Row, moves: string[]) {
    if (!row.history) return true;
    let context = readTacticalRepetitionContext(row.fen, row.history);
    for (const move of moves) {
        if (!context || tacticalRepetitionClaim(context) || context.endedAtPly !== undefined)
            return false;
        context = advanceTacticalRepetitionContext(context, move);
    }
    return Boolean(context && !tacticalRepetitionClaim(context));
}

function supports(row: Row, option: Option, lines: DecisionEngineLine[], near = false) {
    const shape = measurePositionDecision(option.fen, lines);
    if (!lines.length || shape?.lines.length !== lines.length) return null;
    const opener = option.alternative.pvUci[1];
    const top = lines[0];
    const reply = near ? lines.find((line) => line.pvUci[0] === opener) : top;
    if (
        !reply || top.cp === null || top.mate != null ||
        reply.depth < 16 || reply.cp === null || reply.mate != null ||
        top.depth !== reply.depth || top.cp - reply.cp > 35 ||
        Math.abs(option.alternative.cp! + reply.cp) > 90 ||
        !legalHistory(row, [option.moveUci, ...reply.pvUci])
    )
        return null;
    return confirmPositionRefutation(row.fen, { ...option, best: row.candidates[0] }, reply);
}

const planFile = process.env.REPLY_BUDGET_INPUT!;
const searchFile = process.env.REPLY_BUDGET_SEARCH;
const outputFile = process.env.REPLY_BUDGET_OUTPUT!;

test.skipIf(!searchFile)("verifies sampled alternatives at the same engine budget", () => {
    const rows = JSON.parse(readFileSync(planFile, "utf8")) as Row[];
    const [, ...searchRows] = readFileSync(searchFile!, "utf8").trim().split(/\r?\n/);
    const searched = new Map(searchRows.map((line) => {
        const item = JSON.parse(line) as Arms;
        return [item.id, item];
    }));
    expect(rows.length).toBe(searched.size);
    const output = rows.map((row) => {
        const actual = searched.get(row.id)!;
        expect(actual.options.map(({ moveUci }) => moveUci)).toEqual(row.options.map(({ moveUci }) => moveUci));
        const options = actual.options.map(({ moveUci, nominated, ...arms }, i) => {
            const option = row.options[i];
            expect(nominated).toBe(option.alternative.pvUci[1]);
            const evaluated = Object.fromEntries(
                Object.entries(arms).map(([name, value]) => [name, {
                    ...value, proof: supports(row, option, value.lines, name === "broad"),
                }]),
            );
            if (arms.ordinary) evaluated.near = {
                ...arms.ordinary, proof: supports(row, option, arms.ordinary.lines, true),
            };
            return { moveUci, options: evaluated };
        });
        return { id: row.id, original: row.original, options };
    });
    writeFileSync(outputFile, JSON.stringify(output), { flag: "wx" });
}, 180_000);
