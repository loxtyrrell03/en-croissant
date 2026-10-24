import { afterAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { makeUci } from "chessops/util";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Public sGGZN's local offer, plus an independently legal forced-capture
// contrast. Source tags do not establish the claim or material result.
const baseFen = "3R4/4r2k/N4ppq/1B3b2/5pP1/7Q/PPr4P/6K1 w - - 4 34";
const line = ["d8h8", "h7h8", "h3h6"];
const report: {
    id: string;
    fen: string;
    pvUci: string[];
    expected: unknown;
    actual: unknown;
    pass: boolean;
}[] = [];
afterAll(() => {
    if (!process.env.TACTICAL_MATERIAL_CLAIM_REPORT) return;
    const source = readFileSync("src/utils/tacticalMotifs/causalTactics.ts", "utf8").replace(
        /\r\n/g,
        "\n",
    );
    writeFileSync(
        process.env.TACTICAL_MATERIAL_CLAIM_REPORT,
        JSON.stringify(
            {
                schemaVersion: 1,
                classifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
                sourceSha256LF: createHash("sha256").update(source).digest("hex"),
                scope: "Public/synthetic root material-proof draw claims. No engine, provider, owner-data or runtime activity.",
                contracts: report.length,
                passed: report.filter((row) => row.pass).length,
                cases: report,
            },
            null,
            2,
        ),
        { flag: "wx" },
    );
});
function input(fen: string, pvUci: string[], reflected: boolean) {
    return {
        fen: reflected ? reflectMixedForkFen(fen) : fen,
        pvUci: reflected ? pvUci.map(reflectMixedForkMove) : pvUci,
    };
}
function atClock(fen: string, clock: number) {
    const fields = fen.split(" ");
    fields[4] = String(clock);
    return fields.join(" ");
}
function record(
    id: string,
    supplied: { fen: string; pvUci: string[] },
    expected: unknown,
    actual: unknown,
) {
    report.push({
        id,
        ...supplied,
        expected,
        actual,
        pass: JSON.stringify(expected) === JSON.stringify(actual),
    });
    expect(actual).toEqual(expected);
}
function mechanisms(supplied: { fen: string; pvUci: string[] }) {
    const result = classifyPositionTacticalMotifs(supplied);
    const selected = (motifs = result.motifs) =>
        motifs.filter((m) => m.ply === 1 && ["deflection", "skewer"].includes(m.id));
    return {
        root: selected()
            .map((m) => ({ id: m.id, value: m.value }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        timeline: [...new Set(selected(result.timeline ?? []).map((m) => m.id))].sort(),
    };
}

for (const reflected of [false, true])
    for (const clock of [97, 98, 99, 100])
        for (const length of [1, 3]) {
            test(`a claim blocks material certification, clock=${clock}, plies=${length}, reflected=${reflected}`, () => {
                const supplied = input(atClock(baseFen, clock), line.slice(0, length), reflected);
                expect(replayTacticalLine(supplied.fen, supplied.pvUci)).toHaveLength(length);
                const ids =
                    clock === 97 ? (length === 3 ? ["deflection", "skewer"] : ["skewer"]) : [];
                record(
                    `root:${clock}:${length}:${reflected}`,
                    supplied,
                    { root: ids.map((id) => ({ id, value: 400 })), timeline: ids },
                    mechanisms(supplied),
                );
            });
        }

test.each([false, true])(
    "announced quiet Kg7 exists before the optional resetting capture, reflected=%s",
    (reflected) => {
        const supplied = input(atClock(baseFen, 98), line, reflected);
        const capture = replayTacticalLine(supplied.fen, supplied.pvUci);
        const quietLine = input(atClock(baseFen, 98), ["d8h8", "h7g7"], reflected);
        const quiet = replayTacticalLine(quietLine.fen, quietLine.pvUci);
        expect(capture).toHaveLength(3);
        expect(quiet).toHaveLength(2);
        const replies = [...capture[0].after.allDests()]
            .flatMap(([from, tos]) => [...tos].map((to) => makeUci({ from, to })))
            .sort();
        expect(replies).toEqual(
            ["h7g7", "h7h8"].map((move) => (reflected ? reflectMixedForkMove(move) : move)).sort(),
        );
        record(
            `announced-choice:${reflected}`,
            supplied,
            { beforeReply: 99, quietReply: 100, captureReply: 0, acceptedCapture: 500 },
            {
                beforeReply: capture[0].after.halfmoves,
                quietReply: quiet[1].after.halfmoves,
                captureReply: capture[1].after.halfmoves,
                acceptedCapture: capture[1].capture,
            },
        );
    },
);

// Replacing Bf5 with a White Nf5 makes Kg7 illegal. At defender clock99 the
// only reply is Kxh8, which resets the clock; at100 a current claim still wins.
for (const reflected of [false, true])
    for (const clock of [98, 99])
        for (const length of [1, 3]) {
            test(`forced capture cannot announce a quiet claim, clock=${clock}, plies=${length}, reflected=${reflected}`, () => {
                const supplied = input(
                    atClock(baseFen.replace("1B3b2", "1B3N2"), clock),
                    line.slice(0, length),
                    reflected,
                );
                const full = input(
                    atClock(baseFen.replace("1B3b2", "1B3N2"), clock),
                    line,
                    reflected,
                );
                const steps = replayTacticalLine(full.fen, full.pvUci);
                expect(steps).toHaveLength(3);
                const replies = [...steps[0].after.allDests()].flatMap(([from, tos]) =>
                    [...tos].map((to) => makeUci({ from, to })),
                );
                expect(replies).toEqual([reflected ? reflectMixedForkMove("h7h8") : "h7h8"]);
                expect(steps[1].after.halfmoves).toBe(0);
                const ids = clock === 98 ? ["skewer"] : [];
                record(
                    `forced-reset:${clock}:${length}:${reflected}`,
                    supplied,
                    { root: ids.map((id) => ({ id, value: 400 })), timeline: ids },
                    mechanisms(supplied),
                );
            });
        }

// Same independently legal control as tacticalFiftyMoveProof: checkmate has
// already ended the game, even at the automatic 75-move boundary.
test.each([false, true])(
    "immediate mate still takes precedence at halfmove150, reflected=%s",
    (reflected) => {
        const supplied = input("7k/8/5KQ1/8/8/8/8/8 w - - 149 1", ["g6g7"], reflected);
        const steps = replayTacticalLine(supplied.fen, supplied.pvUci);
        expect(steps).toHaveLength(1);
        expect(steps[0].after.isCheckmate()).toBe(true);
        expect(steps[0].after.halfmoves).toBe(150);
        const result = classifyPositionTacticalMotifs(supplied);
        record(
            `immediate-mate:${reflected}`,
            supplied,
            { primary: "mateIn1" },
            { primary: result.motifs[0]?.id },
        );
    },
);
