import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { compareExchangeConsequence } from "./candidate";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

type Case = DecisionAssessmentInput & { id: string };
type Reference = { id: string; cohort: string; tacticalExchange: boolean | null };

test("compares the existing classifier with the experimental exchange evidence", () => {
    const rows = JSON.parse(
        readFileSync(new URL("./input.json", import.meta.url), "utf8"),
    ) as Case[];
    const results = rows.map(({ id, ...row }) => {
        const leader = row.candidates[0];
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            depth: leader.depth,
            engineName: "Stockfish 19",
            pvUci: leader.pvUci,
            variations: row.candidates,
            tacticalHistory: row.history,
        });
        const rootCertificates = scan?.variations.map((line) => ({
            fen: row.fen,
            moveUci: line.lineUci[0],
            motifs: line.motifs,
        }));
        const report = assessChessDecision({ ...row, rootCertificates });
        const primary = row.comparisonCandidates ?? row.candidates;
        const played = primary.find((line) => line.pvUci[0] === row.playedMoveUci);
        const reply = row.replyProbes?.find((probe) => probe.moveUci === row.playedMoveUci)
            ?.lines[0];
        const exchange =
            played && reply && primary[0].pvUci[0] === leader.pvUci[0]
                ? compareExchangeConsequence(row.fen, primary[0], played, reply)
                : null;
        const bestReply = row.replyProbes?.find((probe) => probe.moveUci === leader.pvUci[0])
            ?.lines[0];
        const crossChecked =
            exchange && played && reply && bestReply
                ? compareExchangeConsequence(row.fen, primary[0], played, reply, bestReply)
                : null;
        return {
            id,
            exchange,
            crossChecked,
            status: report?.mistakeStatus,
            tactical: report?.mistake?.tactical.support === "supported",
            positional: report?.mistake?.positional.support === "supported",
            category: report?.mistake?.category,
        };
    });
    const references = JSON.parse(
        readFileSync(new URL("./reference.json", import.meta.url), "utf8"),
    ) as Reference[];
    const { trials } = JSON.parse(readFileSync(new URL("./results.json", import.meta.url), "utf8"));
    expect(results.map((row) => row.id)).toEqual(references.map((row) => row.id));
    type Replay = (typeof results)[number];
    const arms = {
        existing: (row: Replay) => row.tactical,
        addsExchange: (row: Replay) => row.tactical || !!row.exchange,
        addsCrossChecked: (row: Replay) => row.tactical || !!row.crossChecked,
        exchangeEvidence: (row: Replay) => !!row.exchange,
        crossCheckedEvidence: (row: Replay) => !!row.crossChecked,
    };
    const counts = Object.fromEntries(
        Object.keys(trials).map((cohort) => [
            cohort,
            Object.fromEntries(
                Object.entries(arms).map(([arm, supported]) => {
                    const selected = references.filter(
                        (label, index) => label.cohort === cohort && supported(results[index]),
                    );
                    return [
                        arm,
                        {
                            truePositive: selected.filter((row) => row.tacticalExchange === true)
                                .length,
                            falsePositive: selected.filter((row) => row.tacticalExchange === false)
                                .length,
                            unknownHeldOpen: selected.filter((row) => row.tacticalExchange === null)
                                .length,
                        },
                    ];
                }),
            ),
        ]),
    );
    expect(counts).toEqual(
        Object.fromEntries(Object.keys(trials).map((cohort) => [cohort, trials[cohort].arms])),
    );
    writeFileSync(process.env.EXCHANGE_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 120_000);
