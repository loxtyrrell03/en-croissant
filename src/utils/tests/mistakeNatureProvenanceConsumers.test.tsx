import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptyCard } from "ts-fsrs";
import { expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import { TacticalScanResult } from "@/components/panels/tactics/TacticalScanResult";
import {
    getMistakeReviewNature,
    getMistakeReviewNatureConfidence,
    getMistakeReviewNatureReason,
    getStoredMistakeReviewNatureClassification,
    migrateMistakeReviewDeckNatureClassifications,
    needsMistakeReviewDeckNatureMigration,
    type MistakeReviewDeck,
} from "../mistakeReview";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const quiet = {
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    answer: "Nf3", answerUci: "g1f3", card: createEmptyCard(),
    mistakeReview: {
        bestMoveUci: "g1f3", playedMoveUci: "h2h3",
        pvUci: ["g1f3", "g8f6", "g2g3", "g7g6"],
        refutationUci: ["g8f6", "g1f3", "g7g6", "g2g3"],
        cpLoss: 60, winProbabilityDrop: 4, reachedDepth: 18,
    },
} satisfies Position;
function deck(positions: Position[]): MistakeReviewDeck {
    // Nature migration only reads positions; no storage/settings API is used.
    return { version: 1, name: "Synthetic consumer regression", positions, logs: [], createdAt: 1, updatedAt: 1 } as unknown as MistakeReviewDeck;
}
async function current(position: Position = quiet) {
    return (await migrateMistakeReviewDeckNatureClassifications(deck([position]))).deck.positions[0];
}

test("complete current classification is kept as one atomic record", async () => {
    const migrated = await current();
    const stored = { ...migrated, mistakeReview: { ...migrated.mistakeReview, natureReason: "Current complete saved estimate." } };
    expect(getStoredMistakeReviewNatureClassification(stored.mistakeReview)).toMatchObject({ nature: "positional", confidence: "medium" });
    expect(getMistakeReviewNature(stored)).toBe("positional");
    expect(getMistakeReviewNatureReason(stored)).toBe("Current complete saved estimate.");
    expect(needsMistakeReviewDeckNatureMigration(deck([stored]))).toBe(false);
});

test("current genuinely missed fork remains tactical", async () => {
    const position = await current({
        fen: "1k1q3r/pppp4/3N3N/8/2B5/8/5PPP/6K1 w - - 0 1",
        answer: "Ndf7", answerUci: "d6f7", card: createEmptyCard(),
        mistakeReview: { bestMoveUci: "d6f7", playedMoveUci: "g1f1", pvUci: ["d6f7"] },
    });
    expect(getStoredMistakeReviewNatureClassification(position.mistakeReview)).toMatchObject({ nature: "tactical", confidence: "high" });
    expect(getMistakeReviewNature(position)).toBe("tactical");
});

test("prereveal stored lookup does not classify unavailable or stale evidence", () => {
    const metadata = {
        nature: "positional", natureConfidence: "high", natureClassifierVersion: 4,
        get pvUci(): string[] { throw new Error("Prereveal must not inspect a continuation"); },
    } as Position["mistakeReview"];
    expect(getStoredMistakeReviewNatureClassification(metadata)).toBeNull();
    expect(getStoredMistakeReviewNatureClassification(undefined)).toBeNull();
});

test("current algorithm with old motif dependency is stale even when motif arrays claim current", async () => {
    const migrated = await current();
    const position = { ...migrated, fen: "invalid", mistakeReview: {
        ...migrated.mistakeReview, natureMotifClassifierVersion: "site-55.adapter-166",
    } };
    expect(getStoredMistakeReviewNatureClassification(position.mistakeReview)).toBeNull();
    expect(getMistakeReviewNature(position)).toBe("unknown");
    expect(getMistakeReviewNatureConfidence(position)).toBe("low");
    expect(needsMistakeReviewDeckNatureMigration(deck([position]))).toBe(true);
});

test.each([
    ["natureConfidence", "certain"], ["natureReason", 42], ["natureReason", "   "],
    ["tacticalSignals", [123]], ["natureAspect", "neither"], ["allowedNature", "maybe"],
] as const)("malformed current record rejects the whole judgment: %s=%s", async (field, value) => {
    const migrated = await current();
    const position = { ...migrated, fen: "invalid", mistakeReview: { ...migrated.mistakeReview, [field]: value } } as Position;
    expect(getStoredMistakeReviewNatureClassification(position.mistakeReview)).toBeNull();
    expect(getMistakeReviewNature(position)).toBe("unknown");
    expect(getMistakeReviewNatureConfidence(position)).toBe("low");
});

test.each([
    { id: "DVs4F", fen: "8/8/k2p4/pp1P4/P2K4/1P6/8/8 b - - 1 50", pvUci: ["a6b6", "a4b5", "b6b5"] },
    { id: "queen-ending promotion", fen: "Q7/4K3/2p5/2P1k3/8/8/3p4/8 b - - 0 53", pvUci: ["d2d1q"] },
])("live empty output is not a positional verdict: $id", input => {
    const scan = buildLiveTacticalScan({ ...input, engineName: "Frozen fixture", depth: 18,
        variations: [{ multipv: 1, depth: 18, pvUci: input.pvUci }],
    });
    expect(scan.motifs).toEqual([]);
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<MantineProvider><TacticalScanResult scan={scan} lastMoveSan={null} /></MantineProvider>);
    expect(container.textContent).toMatch(/No (?:immediate|tactical) theme verified/);
    expect(container.textContent).not.toMatch(/positional|no tactics|no tactic exists/i);
    expect(container.textContent).toMatch(/does not rule out|did not verify a tactical explanation/);
});

test("newly proved Kn14A counterthreat replaces the former empty live result", () => {
    const fen = "1k2b2R/2p5/Qp1p4/3Pp3/N3P3/PK3r2/1P6/1q6 w - - 15 40";
    const pvUci = ["a4c3", "f3c3", "b3c3", "b1c1", "c3b3"];
    const scan = buildLiveTacticalScan({ fen, pvUci, engineName: "Frozen fixture", depth: 18,
        variations: [{ multipv: 1, depth: 18, pvUci, cp: 487 }],
    });
    expect(scan.motifs[0]).toMatchObject({ id: "forcingAttack", label: "Mating Attack", ply: 1, value: 180 });
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<MantineProvider><TacticalScanResult scan={scan} lastMoveSan={null} /></MantineProvider>);
    expect(container.textContent).toContain("Mating Attack found");
    expect(container.textContent).toContain("blocks check and restores the threat Rxe8#");
    expect(container.textContent).toContain("not a forced-mate claim");
    expect(container.textContent).not.toMatch(/No (?:immediate|tactical) theme verified|positional/);
});
