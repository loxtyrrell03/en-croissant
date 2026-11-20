import { expect, test } from "vitest";
import { queries } from "../stockfish-test-harness";
import { gatherDecisionEvidence, gatherQuietReply } from "@/components/panels/tactics/decisionSearch";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { LocalEngine } from "@/utils/engines";
import fixture from "./fixture.json";

const engine = {
    id: "quiet-reply-stockfish",
    name: "Stockfish 19",
    type: "local",
    version: "19",
    path: process.env.QUIET_REPLY_ENGINE!,
    settings: [],
} satisfies LocalEngine;

test("finds the exact held-out Qg3 reply with the ordinary app search", async () => {
    const { fen, history } = fixture.heldout.input;
    const target = { fen, history };
    const signal = new AbortController().signal;
    const deadline = Date.now() + 28_000;
    const input = await gatherDecisionEvidence(engine, target, signal, () => {}, deadline);
    const before = classify(input, engine.name, history)!;
    const unproved = new Set(before.moves.filter(move => move.tactical.support !== "supported").map(move => move.moveUci));
    const count = queries.length;
    const probe = await gatherQuietReply(engine, target, input, unproved, signal, deadline, () => {});
    expect(probe?.rootMoveUci).toBe("h2h3");
    expect(queries.length - count).toBeLessThanOrEqual(2);
    expect(queries.slice(count).every(query => query.nodes <= 1_400_000)).toBe(true);
    const after = classify({ ...input, quietReply: probe }, engine.name, history)!;
    expect(after.position.quietReply?.lineUci.slice(0, 2)).toEqual(["h2h3", "d6g3"]);
    expect(after.mistake).toEqual(before.mistake);
}, 35_000);
