import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { test } from "vitest";
import { observeCaptureAttractionIdea, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { captureAttractionIdeaFen, captureAttractionIdeaLine } from "./fixtures/captureAttractionIdea";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

test.skipIf(!process.env.TACTICAL_ATTRACTION_INPUT || !process.env.TACTICAL_ATTRACTION_REPORT || !process.env.TACTICAL_ATTRACTION_PROBES)(
    "export conditional attraction witnesses and fresh legal branch probes privately",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const rows = JSON.parse(readFileSync(process.env.TACTICAL_ATTRACTION_INPUT!, "utf8")).results;
        const cases: {id: string; fen: string; line: string[]}[] = [{id: "constructed", fen: captureAttractionIdeaFen, line: captureAttractionIdeaLine}];
        for (const row of rows) for (const [i, candidate] of row.before.entries()) {
            if (observeCaptureAttractionIdea(replayTacticalLine(row.fen, candidate.pvUci)))
                cases.push({id: `${row.id}:line${i + 1}`, fen: row.fen, line: candidate.pvUci});
        }
        assert.ok(cases.length > 1, "The full owner input must contain an actual recovered observation");
        const originals = cases.slice();
        for (const row of originals) cases.push({id: `${row.id}:reflected`, fen: reflectMixedForkFen(row.fen), line: row.line.map(reflectMixedForkMove)});
        const probes: {id: string; fen: string; searchMove?: string; depth: number}[] = [];
        const seen = new Set<string>();
        const add = (id: string, fen: string, searchMove?: string) => {
            const key = `${fen}:${searchMove ?? "unrestricted"}`;
            if (seen.has(key)) return;
            seen.add(key); probes.push({id, fen, searchMove, depth: 18});
        };
        const witnesses = cases.map(row => {
            const steps = replayTacticalLine(row.fen, row.line);
            const observation = observeCaptureAttractionIdea(steps);
            assert.ok(observation, row.id);
            const reached = makeFen(steps[4].after.toSetup());
            add(`${row.id}:root`, row.fen);
            add(`${row.id}:held-root`, row.fen, steps[0].uci);
            add(`${row.id}:premature-entry`, row.fen, steps[2].uci);
            for (const flight of observation.proof.flights) {
                const afterFlight = replayTacticalLine(reached, [flight.reply])[0];
                add(`${row.id}:flight-${flight.reply}`, reached, flight.reply);
                add(`${row.id}:payoff-${flight.reply}`, makeFen(afterFlight.after.toSetup()), flight.capture);
            }
            return {...row, reached, observation};
        });
        for (const [name, fen] of [
            ["extra-recapturer", captureAttractionIdeaFen.replace("r2qk3", "rr1qk3")],
            ["already-loose", captureAttractionIdeaFen.replace("r2qk3", "r3k3")],
            ["checking-counterplay", captureAttractionIdeaFen.replace("pbp1p3", "1b6").replace("np6", "n7")],
            ["alternative-rook-acceptance", captureAttractionIdeaFen.replace("pbp1p3", "1bp1p3").replace("np6", "n7")],
            ["stronger-fork", captureAttractionIdeaFen.replace("np6", "n7")],
            ["queen-offer", captureAttractionIdeaFen.replace("1B2", "1Q2")],
        ]) {
            add(`control:${name}:root`, fen);
            add(`control:${name}:held-root`, fen, captureAttractionIdeaLine[0]);
        }
        writeFileSync(privateReportPath(process.env.TACTICAL_ATTRACTION_REPORT!), JSON.stringify({
            scope: "Conditional exchange ideas and complete direct retreats, not forced root wins or a held-out accuracy set.",
            witnesses,
        }, null, 2), {flag: "wx"});
        writeFileSync(privateReportPath(process.env.TACTICAL_ATTRACTION_PROBES!), JSON.stringify({probes}, null, 2), {flag: "wx"});
    }, 120000,
);
