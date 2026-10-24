import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { proveQuietMatingAttack, replayTacticalLine } from "../../src/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork";

const rows = JSON.parse(readFileSync("benchmarks/tactical-relevance/quiet-trap-adversarial-selection.json", "utf8")).cases
    .filter((row: {id: string}) => ["lichess:2qDuS", "lichess:3LtAI"].includes(row.id)) as
    {id: string; startFen: string; bestLine: string[]}[];
const observations: unknown[] = [];
afterAll(() => {
    if (process.env.QUIET_CLEARANCE_BOUNDARY_REPORT) writeFileSync(process.env.QUIET_CLEARANCE_BOUNDARY_REPORT,
        JSON.stringify({scope: "Two retained public development cases; unresolved root mechanisms, not positional negatives or accuracy labels.",
            ref: process.env.RARE_MECHANISM_PRECISION_REF ?? "9fad2cd685d88d10e962bd80384eb9aaf117072e", observations}, null, 2), {flag: "wx"});
});

for (const row of rows) for (const reflected of [false, true]) {
    const flip = (uci: string) => reflected ? reflectMixedForkMove(uci) : uci;
    const fen = reflected ? reflectMixedForkFen(row.startFen) : row.startFen;
    test(`legal reply inventory and actual bounded outputs: ${row.id}, reflected=${reflected}`, () => {
        const pvUci = row.bestLine.map(flip), steps = replayTacticalLine(fen, pvUci);
        expect(steps).toHaveLength(pvUci.length);
        const replies = [...steps[0].after.allDests()].flatMap(([from, tos]) => [...tos].map(to => ({
            uci: makeUci({from, to}), san: makeSan(steps[0].after, {from, to}),
        })));
        expect(replies).toHaveLength(row.id === "lichess:2qDuS" ? 38 : 30);
        const failures: string[] = [];
        const proof = proveQuietMatingAttack(steps[0], 8192, reason => failures.push(reason));
        observations.push({id: row.id, reflected, fen, pvUci, replies,
            root: classifyPositionTacticalMotifs({fen, pvUci: pvUci.slice(0, 1)}),
            full: classifyPositionTacticalMotifs({fen, pvUci}), proof, failures});
        // Deliberately no empty-output-as-gold assertion. A future sound
        // general proof may recover these roots without invalidating this audit.
    });
}

for (const reflected of [false, true]) {
    const flip = (uci: string) => reflected ? reflectMixedForkMove(uci) : uci;
        test(`the apparent mate has a real queen interposition; reflected=${reflected}`, () => {
            const row=rows.find(candidate=>candidate.id==="lichess:2qDuS")!;
            const fen=reflected?reflectMixedForkFen(row.startFen):row.startFen;
            const line = [...row.bestLine, "f5f8", "e8e4"].map(flip);
            const steps = replayTacticalLine(fen, line);
            expect(steps).toHaveLength(line.length);
            expect(steps[4].after.isCheckmate()).toBe(false);
            expect([...steps[4].after.allDests()].flatMap(([from,tos]) => [...tos].map(to => makeUci({from,to}))))
                .toEqual([flip("f5f8")]);
            expect(steps[6].balance).toBe(-170);
            const proof = proveQuietMatingAttack(steps[6]);
            expect(proof).not.toBeNull();
            observations.push({id:row.id,reflected,scope:"Reached Qe4 only, not root clearance",fen:makeFen(steps[6].before.toSetup()),
                accumulatedMaterial:steps[6].balance,proof:proof && {gain:proof.gain,threat:makeUci(proof.threat),visits:proof.visits,
                    branches:proof.branches}});
        });
        test(`the queen payoff includes the sacrificed knight and rook; reflected=${reflected}`, () => {
            const row=rows.find(candidate=>candidate.id==="lichess:3LtAI")!;
            const fen=reflected?reflectMixedForkFen(row.startFen):row.startFen;
            const line = [...row.bestLine,"e5e1","d1e1"].map(flip), steps=replayTacticalLine(fen,line);
            expect(steps).toHaveLength(line.length);
            expect(steps[1].capture).toBe(320);
            expect(steps[3].capture).toBe(500);
            expect(steps[4].capture).toBe(900);
            expect(steps[4].balance).toBe(80);
            expect(steps[4].after.isCheckmate()).toBe(false);
            const evasions=[...steps[4].after.allDests()].flatMap(([from,tos])=>[...tos].map(to=>makeUci({from,to})));
            expect(evasions).toHaveLength(4);
            observations.push({id:row.id,reflected,scope:"Legal conditional queen-for-rook-and-knight exchange, not a complete strategy",line,
                accumulatedMaterial:steps[4].balance,fen:makeFen(steps[4].after.toSetup()),evasions});
        });
}
