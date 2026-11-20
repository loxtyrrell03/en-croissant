import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { queries } from "../stockfish-test-harness";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { gatherDecisionEvidence } from "@/components/panels/tactics/decisionSearch";
import type { LocalEngine } from "@/utils/engines";
import fixture from "./fixture.json";

test("normal Stockfish analysis obtains the Amsterdam pawn plan", async () => {
    const input = fixture.amsterdam;
    const engine = {
        id: "fixture", name: "Stockfish 19", type: "local", version: "19",
        path: process.env.SETTLED_EXCHANGE_ENGINE!, settings: [],
    } satisfies LocalEngine;
    const history = input.history;
    const analysed = await gatherDecisionEvidence(
        engine, { fen: input.fen, playedMoveUci: input.recordedMove, history },
        new AbortController().signal, () => {},
    );
    const report = classify(analysed, engine.name, history);
    const move = report?.moves[0];
    const baseline = process.env.SETTLED_EXCHANGE_BASELINE === "1";
    expect(move?.moveUci).toBe("f6e5");
    expect(move?.category).toBe(baseline ? "tactical" : "mixed");
    writeFileSync(process.env.SETTLED_EXCHANGE_OUTPUT!, JSON.stringify({
        searches: queries.map(({ moves, ...query }) => ({ ...query, prefix: moves.slice(history.moves.length) })),
        category: move?.category, plan: move?.settledExchangePlan, input: analysed,
    }, null, 2), { flag: "wx" });
}, 60_000);
