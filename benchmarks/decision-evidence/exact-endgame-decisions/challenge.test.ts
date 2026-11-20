import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import {
    assessDecisionEndgame,
    type DecisionEndgameTarget,
} from "@/utils/tacticalMotifs/decisionEndgame";
import { lookupDecisionEndgameEvidence } from "@/utils/tacticalMotifs/tablebaseLookup";
import type { TablebaseEvidence } from "@/utils/tacticalMotifs/tablebaseEvidence";

type Sample = DecisionEndgameTarget & {
    id: string;
    event: string;
    site: string;
    stratum: string;
};
type Receipt = { id: string; evidence?: TablebaseEvidence; requests: number; error?: string };
const sample = JSON.parse(
    readFileSync(
        process.env.EXACT_ENDGAME_SAMPLE ??
            "benchmarks/decision-evidence/exact-endgame-decisions/sample.json",
        "utf8",
    ),
) as { sample: Sample[] };
const receipt =
    process.env.EXACT_ENDGAME_RECORDS ??
    "benchmarks/decision-evidence/exact-endgame-decisions/records.json";
const live = process.env.EXACT_ENDGAME_CAPTURE;
const saved: Receipt[] = live ? [] : JSON.parse(readFileSync(receipt, "utf8"));
const fields = [
    "category",
    "checkmate",
    "stalemate",
    "insufficient_material",
    "variant_win",
    "variant_loss",
];

test("the online path replays each held-out game with bounded exact-board evidence", async () => {
    const actualFetch = globalThis.fetch;
    const results: unknown[] = [];
    const captured: Receipt[] = [];
    let valid = 0;
    let worse = 0;
    let named = 0;
    try {
        for (const [index, target] of sample.sample.entries()) {
            let requests = 0;
            const expected = saved[index];
            if (!live) expect(expected.id).toBe(target.id);
            vi.stubGlobal("fetch", async (input: string, options: RequestInit) => {
                requests++;
                const fen = new URL(input).searchParams.get("fen");
                if (!live) {
                    const record = expected.evidence?.records.find((item) => item.fen === fen);
                    return record
                        ? Response.json(record.result)
                        : new Response("", { status: 404 });
                }
                const response = await actualFetch(input, options);
                if (!response.ok) return response;
                const data = await response.json();
                const compact = (row: Record<string, unknown>, keys: string[]) =>
                    Object.fromEntries(keys.map((key) => [key, row[key]]));
                return Response.json({
                    ...compact(data as Record<string, unknown>, fields),
                    moves: data.moves.map((row: Record<string, unknown>) =>
                        compact(row, ["uci", ...fields]),
                    ),
                });
            });
            let evidence: TablebaseEvidence | undefined;
            let error: string | undefined;
            try {
                evidence = await lookupDecisionEndgameEvidence(
                    target,
                    new AbortController().signal,
                );
            } catch (reason) {
                error = reason instanceof Error ? reason.message : String(reason);
            }
            expect(requests).toBeLessThanOrEqual(3);
            if (!live) expect(evidence).toEqual(expected.evidence);
            const proof = evidence ? assessDecisionEndgame(target, evidence) : null;
            if (evidence) {
                expect(proof).not.toBeNull();
                expect(proof?.played?.outcome).toBeLessThanOrEqual(proof!.bestOutcome);
                expect(proof?.legalMoveCount).toBe(proof?.moveOutcomes.length);
                valid++;
                if (proof?.played && proof.played.outcome < proof.bestOutcome) worse++;
                if (proof?.played?.reply?.cause) named++;
            }
            captured.push({ id: target.id, evidence, requests, error });
            results.push({
                id: target.id,
                event: target.event,
                site: target.site,
                stratum: target.stratum,
                requests,
                bestOutcome: proof?.bestOutcome,
                played: proof?.played,
                defence: proof?.defensiveTactic,
                error,
            });
        }
    } finally {
        vi.unstubAllGlobals();
    }
    if (live) writeFileSync(live, JSON.stringify(captured), { flag: "wx" });
    else if (!process.env.EXACT_ENDGAME_SAMPLE) expect([valid, worse, named]).toEqual([47, 1, 0]);
    else if (receipt.endsWith("/counterfactual-records.json"))
        expect([valid, worse, named]).toEqual([30, 30, 9]);
    const output = process.env.EXACT_ENDGAME_RESULTS;
    if (output) writeFileSync(output, JSON.stringify(results, null, 2), { flag: "wx" });
}, 120_000);
