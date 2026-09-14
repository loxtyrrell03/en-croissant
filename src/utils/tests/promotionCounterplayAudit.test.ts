import { writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    provePromotionCombination,
    replayTacticalLine,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    promotionCounterplayBase,
    promotionCounterplayCases,
    promotionCounterplayLine,
    promotionCounterplayEngineLine,
    pawnRaceRefutations,
    skeweredPromotionLine,
} from "./fixtures/promotionCounterplay";

const key = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
const root = () => replayTacticalLine(promotionCounterplayBase, ["f4e4"])[0];

test("recapturing a queen's capturer does not settle a losing counterpromotion race", () => {
    const row = promotionCounterplayCases().find((item) => item.id === "king-12")!;
    expect(provePromotionCombination(replayTacticalLine(row.fen, ["f4e4"])[0])).toBeNull();
});

test("the rejected promotion witness loses its new queen to a checking skewer", () => {
    const row = pawnRaceRefutations.find((item) => item.id === "king-24")!;
    const steps = replayTacticalLine(row.fen, skeweredPromotionLine);
    expect(steps).toHaveLength(skeweredPromotionLine.length);
    const checked = steps.at(-1)!.after;
    expect(checked.isCheck()).toBe(true);
    let replies = 0;
    for (const [from, tos] of checked.allDests())
        for (const to of tos) {
            const after = checked.clone();
            after.play({ from, to });
            expect(tacticalExchangeGain(after, { from: 58, to: 2 })).toBe(900);
            replies++;
        }
    expect(replies).toBeGreaterThan(0);
});

test.each(pawnRaceRefutations)(
    "$id cannot fund a promotion lesson with an unverified pawn ending",
    ({ fen, historicalLine }) => {
        const step = replayTacticalLine(fen, ["f4e4"])[0];
        expect(step).toBeDefined();
        expect(provePromotionCombination(step)).toBeNull();
        expect(replayTacticalLine(fen, historicalLine)).toHaveLength(historicalLine.length);
        for (const pvUci of [["f4e4"], historicalLine]) {
            expect(
                classifyPositionTacticalMotifs({ fen, pvUci }).motifs.some(
                    (m) => m.id === "promotionCombination",
                ),
            ).toBe(false);
            expect(
                buildLiveTacticalScan({
                    fen,
                    pvUci,
                    depth: 16,
                    engineName: "Regression",
                }).labels.some((m) => m.id === "promotionCombination"),
            ).toBe(false);
        }
    },
);

test("the retained real proof covers every pawn-ending reply with an actual legal promotion", () => {
    const proof = provePromotionCombination(root(), 262144, undefined, true)!;
    expect(proof).toMatchObject({ gain: 220, replyCount: 21 });
    expect(proof.examinedMoves).toBeLessThanOrEqual(262144);
    const decisions = [
        ...new Map(proof.decisions!.map((d) => [key(d.fen) + ":" + d.moveUci, d])).values(),
    ];
    const promotions = new Map(
        decisions.filter((d) => d.stage === "pawn-ending-promotion").map((d) => [key(d.fen), d]),
    );
    let endings = 0;
    for (const decision of decisions) {
        const pos = Chess.fromSetup(parseFen(decision.fen).unwrap()).unwrap();
        const move = parseUci(decision.moveUci)!;
        expect(pos.isLegal(move)).toBe(true);
        pos.play(move);
        if (
            decision.stage !== "settle" ||
            ![...pos.board.occupied].every((sq) =>
                ["king", "pawn"].includes(pos.board.get(sq)!.role),
            )
        )
            continue;
        endings++;
        expect(pos.isEnd()).toBe(false);
        for (const [from, tos] of pos.allDests())
            for (const to of tos) {
                expect(pos.board.get(from)?.role !== "pawn" || (to >= 8 && to < 56)).toBe(true);
                const next = pos.clone();
                next.play({ from, to });
                const witness = promotions.get(key(makeFen(next.toSetup())));
                expect(witness).toBeDefined();
                const promotion = parseUci(witness!.moveUci)!;
                expect("promotion" in promotion && promotion.promotion).toBeTruthy();
                expect(next.isLegal(promotion)).toBe(true);
            }
    }
    expect(endings).toBeGreaterThan(0);
});

test("the real lesson survives root-only input and keeps actual promotion at its own ply", () => {
    for (const pvUci of [["f4e4"], promotionCounterplayLine]) {
        const scan = buildLiveTacticalScan({
            fen: promotionCounterplayBase,
            pvUci,
            depth: 16,
            engineName: "Regression",
        });
        expect(scan.motifs[0]).toMatchObject({ id: "promotionCombination", ply: 1, value: 220 });
        expect(scan.labels.some((m) => m.id === "promotion")).toBe(false);
    }
});

test("accepting a proved promotion sacrifice is not a separate winning-recapture lesson", () => {
    for (const pvUci of [
        promotionCounterplayLine.slice(0, 2),
        promotionCounterplayLine,
        promotionCounterplayEngineLine,
    ]) {
        const result = classifyPositionTacticalMotifs({ fen: promotionCounterplayBase, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "promotionCombination", ply: 1 });
        expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
        const scan = buildLiveTacticalScan({
            fen: promotionCounterplayBase,
            pvUci,
            depth: 16,
            engineName: "Regression",
        });
        expect(
            scan.variations[0].timeline.some((m) => m.ply === 2 && m.id === "hangingPiece"),
        ).toBe(false);
    }
    const result = classifyPositionTacticalMotifs({
        fen: promotionCounterplayBase,
        pvUci: promotionCounterplayLine,
    });
    expect(result.timeline?.find((m) => m.id === "promotion")).toMatchObject({
        ply: 5,
        actor: "black",
    });
});

test.each([0, 1, 16, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "a cached success cannot bypass the %s operation limit",
    (limit) => {
        expect(provePromotionCombination(root())).not.toBeNull();
        expect(provePromotionCombination(root(), limit)).toBeNull();
    },
);

test.skipIf(!process.env.TACTICAL_PROMOTION_TRACE)(
    "inspect the retained real promotion proof",
    () => {
        const errors: string[] = [];
        const selected = process.env.TACTICAL_PROMOTION_TRACE_FEN
            ? replayTacticalLine(process.env.TACTICAL_PROMOTION_TRACE_FEN, ["f4e4"])[0]
            : root();
        expect(selected).toBeDefined();
        const proof = provePromotionCombination(
            selected,
            Number(process.env.TACTICAL_PROMOTION_TRACE_LIMIT ?? 262144),
            (message) => errors.push(message),
            true,
        );
        writeFileSync(
            process.env.TACTICAL_PROMOTION_TRACE!,
            JSON.stringify({ proof, errors }, null, 2),
            { flag: "wx" },
        );
    },
);

test.skipIf(!process.env.TACTICAL_PROMOTION_COUNTERPLAY_REPORT)(
    "inspect promotion counterplay without assuming a winning whole position",
    () => {
        const cases = promotionCounterplayCases().map((row) => {
            const started = performance.now();
            const proof = provePromotionCombination(replayTacticalLine(row.fen, ["f4e4"])[0]);
            return { ...row, proof, elapsedMs: performance.now() - started };
        });
        writeFileSync(
            process.env.TACTICAL_PROMOTION_COUNTERPLAY_REPORT!,
            JSON.stringify(
                {
                    scope: "Constructed counterplay probes; accepted local bounds are not full-position wins.",
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        expect(cases).toHaveLength(116);
    },
    120000,
);
