import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { proveCheckingMate, replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";

const fen = "5r2/bpp2q1k/p2pR1p1/3P4/1PP3QP/P7/1B4P1/7K b - - 3 32";
const pvUci = ["f7f1", "h1h2", "f1g1", "h2h3", "g1h1", "h3g3", "a7f2"];

const developmentExample = (id: string) => {
    const cases = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/checking-mate-development.json", "utf8"),
    ).cases as { id: string; startFen: string; bestLine: string[] }[];
    return cases.find((example) => example.id === `lichess:${id}`)!;
};

test.each(["41frD", "bBtM1", "n48BE", "nUdHj"])(
    "real mating payoffs stay at checkmate and cannot duplicate or displace the root attack: %s",
    (id) => {
        const item = developmentExample(id);
        const steps = replayTacticalLine(item.startFen, item.bestLine);
        const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
        expect(result.motifs[0]).toMatchObject({ label: "Forcing Mate", ply: 1 });
        const events = result.timeline?.filter((m) => /(?:^mate(?:In\d+)?$|Mate$)/.test(m.id));
        expect(events).toHaveLength(2);
        expect(events?.map((m) => m.ply)).toEqual([1, steps.length]);
        expect(events?.[1].evidence).toContain(steps.at(-1)!.san);
    },
);

test("a real en-passant mechanism belongs to the pawn capture, not the final bishop mate", () => {
    const item = developmentExample("OezHt");
    const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
    expect(result.motifs.find((m) => m.id === "enPassant")).toMatchObject({
        ply: 5,
        moveUci: "g5f6",
    });
    expect(result.timeline?.find((m) => m.id === "enPassant")?.evidence).toContain(
        "pawn on f5 en passant",
    );
});

test.skipIf(!process.env.TACTICAL_CHECKING_MATE_SOURCE)(
    "audit all long checking mates in the frozen development corpus without source tags",
    () => {
        const source = readFileSync(process.env.TACTICAL_CHECKING_MATE_SOURCE!, "utf8");
        const candidates = source
            .trim()
            .split(/\r?\n/)
            .map((row) => JSON.parse(row))
            .filter((row) => row.split === "development")
            .map(({ id, startFen, bestLine, sourceGameUrl }) => ({
                id,
                startFen,
                bestLine: bestLine as string[],
                sourceGameUrl,
            }))
            .filter((row) => row.bestLine.length >= 7);
        const results = [];
        for (const candidate of candidates) {
            const steps = replayTacticalLine(candidate.startFen, candidate.bestLine);
            if (
                steps.length !== candidate.bestLine.length ||
                !steps.at(-1)?.after.isCheckmate() ||
                steps.at(-1)?.before.turn !== steps[0].before.turn ||
                !steps[0].after.isCheck()
            )
                continue;
            const started = performance.now();
            const proof = proveCheckingMate(steps);
            const result = classifyPositionTacticalMotifs({
                fen: candidate.startFen,
                pvUci: candidate.bestLine,
            });
            results.push({
                ...candidate,
                san: steps.map((s) => s.san),
                proof,
                result,
                classificationMs: performance.now() - started,
            });
        }
        expect(results.length).toBeGreaterThan(0);
        writeFileSync(
            "benchmarks/tactical-relevance/checking-mate-development.json",
            JSON.stringify(
                {
                    selection:
                        "Every development row whose complete legal line has at least seven plies, starts with check and ends with the attacker's checkmate. No theme/rating/classifier-output selection; no holdout classification. Proof absence remains unresolved, not a correct negative.",
                    sourceSha256: createHash("sha256").update(source).digest("hex"),
                    count: results.length,
                    proved: results.filter((r) => r.proof).length,
                    cases: results,
                },
                null,
                2,
            ),
        );
    },
    180000,
);

test("a real seven-ply mating attack remains recognizable", () => {
    const steps = replayTacticalLine(fen, pvUci);
    expect(steps).toHaveLength(7);
    expect(steps.at(-1)?.after.isCheckmate()).toBe(true);
    expect(proveCheckingMate(steps)).toMatchObject({ maxMoves: 4 });
    const result = classifyPositionTacticalMotifs({ fen, pvUci });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn4", label: "Forcing Mate", ply: 1 });
    expect(result.motifs[0].evidence).toContain("Every legal defence");
    const payoff = result.timeline?.filter((m) => m.ply === 7 && /mate/i.test(m.id));
    expect(payoff).toHaveLength(1);
    expect(payoff?.[0]).toMatchObject({
        id: "mateIn1",
        label: "Checkmate",
        relevance: "secondary",
    });
    expect(payoff?.[0].evidence).toContain("Bf2#");
});

test("a seven-ply cooperative mate cannot hide a queen-capturing defence", () => {
    const position = fen.replace("7K", "2R4K");
    const steps = replayTacticalLine(position, pvUci);
    expect(steps).toHaveLength(7);
    expect(steps.at(-1)?.after.isCheckmate()).toBe(true);
    expect(replayTacticalLine(position, ["f7f1", "c1f1"])).toHaveLength(2);
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci });
    expect(result.motifs.filter((m) => /mate/i.test(m.id))).toEqual([]);
});

test("a warmed mating proof cache does not bypass the caller's node budget", () => {
    const steps = replayTacticalLine(fen, pvUci);
    expect(proveCheckingMate(steps)).not.toBeNull();
    expect(proveCheckingMate(steps, 0)).toBeNull();
});

test("the alternate king defence has a different mating move, not a compulsory bishop pattern", () => {
    const alternate = ["f7f1", "h1h2", "f1g1", "h2g3", "a7f2", "g3h3", "g1h1"];
    const steps = replayTacticalLine(fen, alternate);
    expect(steps).toHaveLength(7);
    expect(steps.at(-1)?.san).toBe("Qh1#");
    const result = classifyPositionTacticalMotifs({ fen, pvUci: alternate });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn4", ply: 1 });
    const payoff = result.timeline?.filter((m) => m.ply === 7 && /mate/i.test(m.id));
    expect(payoff).toHaveLength(1);
    expect(payoff?.[0].evidence).toContain("Qh1#");
});

test("mistake review teaches the missed checking attack rather than two distant mate names", () => {
    const classification = classifyMistakeReviewMotifs({
        fen,
        pvUci,
        bestMoveUci: "f7f1",
        playedMoveUci: "h7g7",
        cpLoss: 500,
    });
    const explanation = buildMistakeReviewTacticalExplanation(classification);
    expect(explanation).toMatchObject({ source: "missed", primary: { id: "mateIn4", ply: 1 } });
    expect(explanation?.text).toContain("Qf1+");
});

test("a single named pattern and generic checkmate are not two timeline tactics", () => {
    const result = classifyPositionTacticalMotifs({
        fen: "8/5p2/1R6/6p1/1P2N1rk/4K2n/8/8 w - - 1 57",
        pvUci: ["b6h6"],
    });
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline?.[0]).toMatchObject({ id: "anastasiaMate", relevance: "primary" });
    expect(result.timeline?.[0].evidence).toContain("Rh6# is checkmate");
});

test("a mating attack already present after both choices is not blamed on one pawn move", () => {
    const result = classifyMistakeReviewMotifs({
        fen: fen.replace(" b ", " w "),
        bestMoveUci: "a3a4",
        playedMoveUci: "b4b5",
        pvUci: ["a3a4", ...pvUci],
        refutationUci: pvUci,
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "mateIn4", comparison: "persists" });
    expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain(
        "does not explain the difference",
    );
});

test.each([false, true])(
    "the same proof and counterexample work with White attacking: blocked=%s",
    (blocked) => {
        const original = blocked ? fen.replace("7K", "2R4K") : fen;
        const parts = original.split(" ");
        const reflected = parts[0]
            .split("/")
            .reverse()
            .join("/")
            .replace(/[a-zA-Z]/g, (piece) =>
                piece === piece.toLowerCase() ? piece.toUpperCase() : piece.toLowerCase(),
            );
        const position = `${reflected} w - - 3 32`;
        const moves = pvUci.map((uci) => uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank))));
        const steps = replayTacticalLine(position, moves);
        expect(steps).toHaveLength(7);
        expect(steps.at(-1)?.after.isCheckmate()).toBe(true);
        const result = classifyPositionTacticalMotifs({ fen: position, pvUci: moves });
        expect(result.motifs.find((m) => /mate/i.test(m.id))?.id).toBe(
            blocked ? undefined : "mateIn4",
        );
    },
);
