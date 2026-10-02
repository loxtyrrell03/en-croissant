import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../../src/utils/tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "../../src/utils/tests/fixtures/mixedTargetFork";

const sourceRef = process.env.EPYOT_SOURCE_INDEX
    ? "index"
    : (process.env.RARE_CAUSAL_COHORT_V2_REF ?? "working-source");
const files = [
    "causalTactics.ts",
    "mistakeReviewAdapter.ts",
    "quietIntermediateCapture.ts",
    "historyAwareMate.ts",
    "repetitionHistory.ts",
    "types.ts",
    "liveTactics.ts",
];
const hashes = () =>
    Object.fromEntries(
        files.map((file) => [
            file,
            createHash("sha256")
                .update(
                    sourceRef === "working-source"
                        ? readFileSync(`src/utils/tacticalMotifs/${file}`)
                        : execFileSync("git", [
                              "-c",
                              "safe.directory=C:/Users/Lox/Desktop/repo/en-croissant",
                              "show",
                              `${sourceRef === "index" ? "" : sourceRef}:src/utils/tacticalMotifs/${file}`,
                          ]),
                )
                .digest("hex"),
        ]),
    );
const initialHashes = hashes();
const rows: unknown[] = [];
const original = "r1b2r2/pp4bk/1q1Qp2p/4ppp1/8/2P2NP1/PP2PPBP/1R1R2K1 w - - 2 19";
for (const reflected of [false, true])
    for (const history of [false, true])
        for (const length of [1, 3]) {
            test(`same public API input reflected=${reflected} history=${history} length=${length}`, () => {
                const m = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
                const previousFen = reflected ? reflectMixedForkFen(original) : original;
                const previousMoveUci = m("f3e5");
                const preceding = replayTacticalLine(previousFen, [previousMoveUci]);
                expect(preceding).toHaveLength(1);
                const fen = makeFen(preceding[0].after.toSetup());
                const pvUci = ["b6d6", "d1d6", "g7e5"].slice(0, length).map(m);
                expect(replayTacticalLine(fen, pvUci)).toHaveLength(length);
                const input = {
                    fen,
                    pvUci,
                    ...(history
                        ? {
                              previousFen,
                              previousMoveUci,
                              tacticalHistory: { fen: previousFen, moves: [previousMoveUci] },
                          }
                        : {}),
                };
                const result = classifyPositionTacticalMotifs(input);
                const first = result.motifs[0];
                const payoff =
                    length === 3
                        ? result.timeline?.find(
                              (motif) => motif.ply === 3 && motif.moveUci === pvUci[2],
                          )
                        : undefined;
                const contracts = {
                    namedPrimary:
                        first?.id === "capturingDefender" &&
                        first.label === "Removing the Defender",
                    correctPrimaryBound: first?.value === (history ? 220 : 320),
                    noRearPawnSkewers: !result.motifs.some((motif) => motif.id === "skewer"),
                    payoffNotCountedTwice:
                        length === 1 ||
                        (payoff?.label === "Countercapture Payoff" && payoff.value === undefined),
                };
                expect(
                    sourceRef === "b75c13e2f3a63d69cf60bd9e0b4221f884a9e190"
                        ? MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION === "site-55.adapter-174"
                        : Object.values(contracts).every(Boolean),
                ).toBe(true);
                rows.push({ reflected, history, length, input, result, contracts });
            });
        }
test("retain exact paired API evidence", () => {
    expect(rows).toHaveLength(8);
    expect(hashes()).toEqual(initialHashes);
    if (process.env.EPYOT_API_REPORT)
        writeFileSync(
            process.env.EPYOT_API_REPORT,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    sourceRef,
                    sourceHashes: initialHashes,
                    version: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
                    scope: "Eight fixed public API variants of one development position; contract observations are not population accuracy.",
                    rows,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});
