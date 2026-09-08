import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { auditTacticalMotifs, replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";

type Example = { id: string; startFen: string; bestLine: string[]; sourceGameUrl: string };
const fixturePath = "benchmarks/tactical-relevance/expanded-development.json";
const example = (id: string) =>
    (JSON.parse(readFileSync(fixturePath, "utf8")).cases as Example[]).find(
        (item) => item.id === `lichess:${id}`,
    )!;

test.skipIf(!process.env.TACTICAL_EXPANSION_SOURCE)(
    "freeze a tag-blind development-only expansion",
    () => {
        const existing = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/real-puzzle-development.json", "utf8"),
        ).cases as Example[];
        const excluded = new Set(existing.map((item) => item.id));
        const sourceBody = readFileSync(process.env.TACTICAL_EXPANSION_SOURCE!, "utf8");
        const rows = sourceBody
            .trim()
            .split(/\r?\n/)
            .map((row) => JSON.parse(row));
        const salt = "tactical-relevance-expansion-1";
        const hash = (id: string) => createHash("sha256").update(`${salt}:${id}`).digest("hex");
        const selected = rows
            .filter((row) => row.split === "development" && !excluded.has(row.id))
            .sort((a, b) => hash(a.id).localeCompare(hash(b.id)))
            .slice(0, 32)
            .map(({ id, startFen, bestLine, sourceGameUrl }) => ({
                id,
                startFen,
                bestLine,
                sourceGameUrl,
            }));
        expect(selected).toHaveLength(32);
        writeFileSync(
            fixturePath,
            JSON.stringify(
                {
                    selection:
                        "Lowest 32 SHA-256(salt:id) development rows, excluding the first twelve-game diagnostic. No theme, rating, line-length or classifier-output filtering. No holdout rows classified. Source tags deliberately omitted; this is a diagnostic sample, not an accuracy estimate.",
                    salt,
                    sourceFixture:
                        "chessmistaketrainer/benchmarks/tactical-classifier/lichess-2026-08-02-fixture-v1.jsonl",
                    sourceSha256: createHash("sha256").update(sourceBody).digest("hex"),
                    cases: selected,
                },
                null,
                2,
            ),
        );
    },
);

test.each(["GIB50", "vztmO", "wh6Ac"])(
    "checkmate is the primary lesson, with one generic mate badge: %s",
    (id) => {
        const item = example(id);
        const steps = replayTacticalLine(item.startFen, item.bestLine);
        expect(steps[0].after.isCheckmate()).toBe(true);
        const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
        expect(result.motifs).toHaveLength(1);
        expect(result.motifs[0]).toMatchObject({
            id: "mateIn1",
            label: "Checkmate",
            confidence: "high",
            ply: 1,
        });
        expect(result.motifs[0].evidence).toContain(steps[0].san);
        expect(result.timeline).toHaveLength(1);
        expect(result.timeline?.[0].relevance).toBe("primary");
    },
);

test("legal mate does not depend on the legacy classifier proposing a mate tag", () => {
    const item = example("GIB50");
    expect(auditTacticalMotifs(item.startFen, item.bestLine, [])).toEqual([
        expect.objectContaining({ id: "mateIn1", relevance: "primary" }),
    ]);
});

test("a real en-passant capture cannot crash the defensive-ray audit", () => {
    const item = example("fVRuW");
    const steps = replayTacticalLine(item.startFen, item.bestLine);
    expect(steps[0].capture).toBe(100);
    expect(steps[0].before.board.get(29)?.role).toBe("pawn");
    expect(steps[0].after.board.get(29)).toBeUndefined();
    expect(() =>
        classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine }),
    ).not.toThrow();
    // Crash freedom is not a claim that the longer combination is explained.
});

test("a king cannot be skewered for material after it is checkmated", () => {
    const item = example("ouIHI");
    const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
    expect(replayTacticalLine(item.startFen, item.bestLine)[2].after.isCheckmate()).toBe(true);
    expect(result.timeline?.some((motif) => motif.id === "skewer" && motif.ply === 3)).toBe(false);
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "operaMate", ply: 3 }));
});

test("deflecting a defender is not given an overlapping move-order badge for the same gain", () => {
    const item = example("JaKHo");
    const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
    expect(result.motifs.map((motif) => motif.id)).toEqual(["deflection"]);
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "hangingPiece", ply: 3 }));
});

test("the knight-promotion fork keeps the specific underpromotion without a duplicate promotion badge", () => {
    const item = example("erSYy");
    const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
    expect(result.motifs[0]?.id).toBe("fork");
    expect(result.motifs.map((m) => m.id)).toContain("underPromotion");
    expect(result.motifs.map((m) => m.id)).not.toContain("promotion");
});

test("record the expanded real-game sample without claiming every headline is correct", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { cases: Example[] };
    const report = fixture.cases.map((item) => {
        const steps = replayTacticalLine(item.startFen, item.bestLine);
        expect(steps).toHaveLength(item.bestLine.length);
        const started = performance.now();
        try {
            const result = classifyPositionTacticalMotifs({
                fen: item.startFen,
                pvUci: item.bestLine,
            });
            return {
                ...item,
                san: steps.map((step) => step.san),
                result,
                classificationMs: performance.now() - started,
            };
        } catch (error) {
            return { ...item, san: steps.map((step) => step.san), error: String(error) };
        }
    });
    expect(report).toHaveLength(32);
    if (process.env.TACTICAL_EXPANSION_REPORT)
        writeFileSync(process.env.TACTICAL_EXPANSION_REPORT, JSON.stringify(report, null, 2));
    expect(report.filter((item) => "error" in item)).toEqual([]);
});
