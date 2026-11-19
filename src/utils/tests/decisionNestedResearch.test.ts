import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { compareMateConsequence } from "../tacticalMotifs/decisionMateConsequence";
import { compareTacticalMistakeEpisode } from "../tacticalMotifs/tacticalMistakeEpisode";
import type { DecisionAssessment } from "../tacticalMotifs/decisionAssessment";

type FollowupBoard = {
    fen: string;
    prefix: string[];
    continuation: string[];
    targets: { move: string; gain: number; named: string }[];
};
type Reply = { rank: number; lines: DecisionEngineLine[]; queryMs: number };
type Probe = {
    prefix: string[];
    lines: DecisionEngineLine[];
    confirmation: Reply[];
    queryMs: number;
};
type PositionCache = {
    identity: {
        case: {
            id: string;
            reference: {
                tactical: boolean | null;
                positional: boolean | null;
                rationale: string;
            };
            previous: DecisionAssessment;
            boards: FollowupBoard[];
        };
    };
    probes: Probe[];
    requestedNodes: number;
    searchMs: number;
};

function compare(board: FollowupBoard, probe: Probe, entry: Reply) {
    const [good] = probe.lines;
    const bad = probe.lines[entry.rank];
    const [reply] = entry.lines;
    if (
        !good ||
        !bad ||
        !reply ||
        reply.depth < 16 ||
        bad.pvUci[1] !== reply.pvUci[0] ||
        !measureDecisionLine(board.fen, bad) ||
        !measureDecisionLine(board.fen, good)
    )
        return null;
    const [actual] = replayTacticalLine(board.fen, board.continuation.slice(0, 1));
    const result = { rank: entry.rank, reply: reply.pvUci[0], actual: actual.san, replyMs: entry.queryMs };
    const mate = compareMateConsequence(board.fen, good, bad, undefined, reply);
    if (mate?.kind === "allowed")
        return {
            ...result,
            kind: "mate",
            mate,
            lines: [board.prefix.concat(good.pvUci), board.prefix.concat(mate.lineUci)],
            gap: null,
            named: null,
        };

    const [better] = replayTacticalLine(board.fen, good.pvUci.slice(0, 1));
    if (
        !better ||
        good.cp === null ||
        reply.cp === null ||
        bad.cp === null ||
        reply.mate != null ||
        Math.abs(bad.cp + reply.cp) > 90
    )
        return null;
    const goodReply = {
        ...good,
        cp: -good.cp,
        fen: makeFen(better.after.toSetup()),
        pvUci: good.pvUci.slice(1),
    };
    const episode = compareTacticalMistakeEpisode(board.fen, good, bad, reply, goodReply, 5);
    if (!episode) return null;
    const threat = board.targets.find((target) => target.move === reply.pvUci[0]);
    return {
        ...result,
        kind: threat ? "directThreat" : "otherTactic",
        episode,
        lines: [board.prefix.concat(episode.betterLineUci), board.prefix.concat(episode.playedLineUci)],
        gap: good.cp - bad.cp,
        named: threat?.named,
    };
}

const directory = process.env.NESTED_SCREEN;
test.skipIf(!directory)("compares follow-up searches at early defensive choices", () => {
    const output = process.env.NESTED_OUTPUT;
    if (!directory || !output) throw new Error("Provide the nested search cache and a new output file");
    const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const cases = files.map((file) => {
        const result: PositionCache = JSON.parse(readFileSync(join(directory, file), "utf8"));
        const { case: row } = result.identity;
        if (file !== row.id + ".json") throw new Error("Nested search case does not match its cache");
        return {
            id: row.id,
            reference: row.reference,
            previous: row.previous,
            nodes: result.requestedNodes,
            searchMs: result.searchMs,
            boards: result.probes.map((probe) => {
                const board = row.boards.find((item) => item.prefix.join(" ") === probe.prefix.join(" "));
                if (!board) throw new Error("Nested search does not match the recorded moves");
                return {
                    ...board,
                    matching: probe.lines[0]?.pvUci[0] === board.continuation[0],
                    queryMs: probe.queryMs,
                    proven: probe.confirmation
                        .map((entry) => compare(board, probe, entry))
                        .filter((proof) => proof !== null),
                };
            }),
        };
    });
    writeFileSync(output, JSON.stringify(cases, null, 1), { flag: "wx" });
});
