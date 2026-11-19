import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import fixtures from "../../../benchmarks/decision-evidence/independent-mating-lines/examples.json";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { corroborateMatingLines } from "../tacticalMotifs/decisionMatingLines";

test("a later tactical mechanism cannot displace confirmed mating evidence", () => {
    const report = assessChessDecision(fixtures.rookBishop);
    expect(report?.position.category).toBe("tactical");
    expect(report?.position.tactical.basis).toBe("engine-supported");
    const evidence = report?.position.matingLines;
    expect(evidence?.mateIn).toBe(5);
    expect(evidence?.winner).toBe("white");
    expect(evidence?.rootLineUci[1]).not.toBe(evidence?.replyLineUci[1]);
    expect(report?.moves[0].matingLines).toEqual(evidence);
});

test("both complete searches can confirm a mate beyond six moves", () => {
    const report = assessChessDecision(fixtures.pawnAdvance);
    expect(report?.position.category).toBe("tactical");
    const evidence = report?.position.matingLines;
    expect(evidence?.mateIn).toBe(8);
    expect(evidence?.rootLineUci).toHaveLength(15);
    expect(evidence?.replyLineUci).toHaveLength(15);
    for (const line of [evidence!.rootLineUci, evidence!.replyLineUci]) {
        expect(replayTacticalLine(fixtures.pawnAdvance.fen, line).at(-1)?.after.isCheckmate()).toBe(
            true,
        );
    }
});

test("mate for the opponent is evidence about the position and names the winner", () => {
    const [root] = fixtures.rookBishop.replyProbes[0].lines;
    const [first] = replayTacticalLine(root.fen, root.pvUci.slice(0, 1));
    const reply = {
        ...root,
        fen: makeFen(first.after.toSetup()),
        mate: 4,
        pvUci: root.pvUci.slice(1),
    };
    const report = assessChessDecision({
        fen: root.fen,
        candidates: [root],
        replyProbes: [{ moveUci: first.uci, lines: [reply] }],
    });
    expect(report?.position.category).toBe("tactical");
    expect(report?.position.matingLines).toMatchObject({ winner: "white", mateIn: 4 });
});

test("incomplete lines, incorrect mate distance and stale replies cannot confirm a mate", () => {
    const { fen, candidates, replyProbes } = fixtures.pawnAdvance;
    const [root] = candidates;
    const [reply] = replyProbes[0].lines;
    const invalid = [
        { ...reply, pvUci: reply.pvUci.slice(0, -1) },
        { ...reply, mate: -6 },
        { ...reply, mate: 7 },
        { ...reply, fen },
        { ...reply, upperbound: true },
    ];
    for (const line of invalid) expect(corroborateMatingLines(fen, root, line)).toBeNull();
    expect(
        corroborateMatingLines(
            fen,
            {
                ...root,
                pvUci: root.pvUci.slice(0, -2),
            },
            reply,
        ),
    ).toBeNull();
});
