import { expect, test } from "vitest";
import { queries } from "../stockfish-test-harness";
import {
    gatherDecisionEvidence,
    gatherSiblingRefutation,
} from "@/components/panels/tactics/decisionSearch";
import { assessChessDecision } from "@/utils/tacticalMotifs/decisionAssessment";
import type { LocalEngine } from "@/utils/engines";
import fixture from "./fixture.json";

const engine = {
    id: "fixture",
    name: "Stockfish 19",
    type: "local",
    version: "19",
    path: process.env.SIBLING_LIVE_ENGINE!,
    settings: [],
} satisfies LocalEngine;

test("the app checks the exact weaker choice with one independently searched reply", async () => {
    const { input } = fixture.bavaria;
    const target = { fen: input.fen };
    const request = await gatherSiblingRefutation(
        engine,
        target,
        input,
        new AbortController().signal,
        Date.now() + 12_000,
        () => {},
    );
    expect(request?.reply.pvUci[0]).toBe("d4b5");
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ nodes: 1_400_000, moves: [], restricted: [] });
    expect(request?.reply.fen).toBe(fixture.bavaria.causal.reply.fen);
    const output = assessChessDecision({ ...input, siblingRefutation: request });
    expect(output?.position.tactical.support).toBe("supported");
    expect(output?.position.tactical.reasons[0]).toMatch(/Qc8 allows Nxb5/);
    expect(output?.mistake).toBeNull();
}, 15_000);

test("normal root analysis can find the weaker choice independently", async () => {
    const target = { fen: fixture.bavaria.input.fen };
    const signal = new AbortController().signal;
    const deadline = Date.now() + 28_000;
    const input = await gatherDecisionEvidence(engine, target, signal, () => {}, deadline);
    const first = assessChessDecision(input);
    expect(first?.position.tactical.support).not.toBe("supported");
    const siblingRefutation = await gatherSiblingRefutation(
        engine,
        target,
        input,
        signal,
        deadline,
        () => {},
    );
    const after = assessChessDecision({ ...input, siblingRefutation });
    expect(after?.position.tactical.reasons[0]).toMatch(/Qc8 allows Nxb5/);
}, 33_000);
