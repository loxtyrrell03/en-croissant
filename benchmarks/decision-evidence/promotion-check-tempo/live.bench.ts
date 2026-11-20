import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import "../stockfish-test-harness";
import type { LocalEngine } from "@/utils/engines";
import { gatherDecisionEvidence } from "@/components/panels/tactics/decisionSearch";

test("captures the normal Stockfish inputs on public reviewed cases", async () => {
    const engine = {
        id: "fixture",
        name: "Stockfish 19",
        type: "local",
        version: "19",
        path: process.env.PROMOTION_TEMPO_ENGINE!,
        settings: [],
    } satisfies LocalEngine;
    const fixtures = JSON.parse(readFileSync(process.env.PROMOTION_TEMPO_INPUT!, "utf8"));
    const output = [];
    for (const { id, fen, history, played } of fixtures) {
        const start = performance.now();
        const input = await gatherDecisionEvidence(
            engine,
            { fen, history, playedMoveUci: played },
            new AbortController().signal,
            () => {},
        );
        expect(input.candidates.length).toBeGreaterThan(0);
        output.push({
            id,
            cohort: "live",
            ...input,
            history,
            milliseconds: performance.now() - start,
        });
    }
    writeFileSync(process.env.PROMOTION_TEMPO_OUTPUT!, JSON.stringify(output), { flag: "wx" });
}, 90_000);
