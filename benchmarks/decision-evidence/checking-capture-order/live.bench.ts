import { expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { queries } from "../stockfish-test-harness";
import {
    gatherCheckingOrder,
    gatherDecisionEvidence,
} from "@/components/panels/tactics/decisionSearch";
import { assessChessDecision } from "@/utils/tacticalMotifs/decisionAssessment";
import { confirmCheckingOrder, findCheckingOrderChoice, nominateCheckingOrder } from "@/utils/tacticalMotifs/decisionCheckingOrder";
import type { LocalEngine } from "@/utils/engines";
import holdout from "../paired-choice-training/holdout.json";

const engine = {
    id: "test-stockfish",
    name: "Stockfish 19",
    type: "local",
    version: "19",
    path: process.env.CHECKING_ORDER_ENGINE!,
    settings: [],
} satisfies LocalEngine;

test.each([
    { id: "00333f3baca7a16487ba", scope: "position", playedMoveUci: undefined, explanation: /Rd1\+.*gxf4/ },
    { id: "00e0309267248002c05d", scope: "mistake", playedMoveUci: "c3d5", explanation: /Qxh2\+.*hxg5\+/ },
] as const)("normal app search exposes the $scope check order", async ({ id, scope, playedMoveUci, explanation }) => {
    const { fen, history } = holdout.find((row) => row.id === id)!;
    const target = { fen, history, playedMoveUci };
    const signal = new AbortController().signal;
    const deadline = Date.now() + 28_000;
    const input = { ...await gatherDecisionEvidence(engine, target, signal, () => {}, deadline), history };
    const first = assessChessDecision(input);
    const branches = input.comparisonCandidates ?? input.candidates;
    const played = branches.find((line) => line.pvUci[0] === playedMoveUci);
    const nominated = scope === "position" ? findCheckingOrderChoice(fen, input.candidates)
        : played && nominateCheckingOrder(fen, branches[0], played);
    expect(nominated, JSON.stringify({ candidates: input.candidates, branches })).toBeTruthy();
    if (!nominated) return;
    const countBefore = queries.length;
    const probe = await gatherCheckingOrder(
        engine, target, input, { position: scope === "position", mistake: scope === "mistake" },
        signal, deadline, () => {},
    );
    expect(probe?.scope).toBe(scope);
    expect(queries.length - countBefore).toBeLessThanOrEqual(1);
    if (queries.length > countBefore) {
        expect(queries.at(-1)).toMatchObject({ nodes: 1_400_000, restricted: nominated.moves });
    }
    const proof = confirmCheckingOrder(fen, nominated, probe!.lines, history);
    expect(proof?.explanation, JSON.stringify({ nominated, probe }, (key, value) =>
        ["before", "after"].includes(key) ? undefined : value)).toMatch(explanation);
    const after = assessChessDecision({ ...input, checkingOrder: probe });
    const initial = scope === "position" ? first?.position : first?.mistake;
    const result = scope === "position" ? after?.position : after?.mistake;
    expect(result?.tactical.support).toBe("supported");
    expect(result?.checkingOrder).toEqual(proof);
    expect(scope === "position" ? after?.mistake : after?.position)
        .toEqual(scope === "position" ? first?.mistake : first?.position);
    if (process.env.CHECKING_ORDER_LIVE_OUTPUT) {
        writeFileSync(`${process.env.CHECKING_ORDER_LIVE_OUTPUT}/${scope}.json`,
            JSON.stringify({ id, scope, input, probe, initial, result, queries: queries.slice(countBefore) }), { flag: "wx" });
    }
}, 35000);
