import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { buildLiveTacticalScan, previewLiveTacticalVariation, type LiveTacticalScanInput } from "../tacticalMotifs/liveTactics";
import { nominateTacticalCandidateMoves } from "../tacticalMotifs/tacticalCandidateMoves";

// Fabricated evaluations exercise transport/admission only, not an engine
// judgement that these quiet moves actually outrank the f7 fork.
const supplementalForkInput: LiveTacticalScanInput = {
  fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
  engineName: "Structural test", depth: 16, pvUci: ["h2h3"],
  variations: [
    { multipv: 1, depth: 16, pvUci: ["h2h3"], cp: 450 },
    { multipv: 2, depth: 16, pvUci: ["a2a3"], cp: 440 },
    { multipv: 3, depth: 16, pvUci: ["a2a4"], cp: 430 },
  ],
  supplementalVariations: [{ depth: 16, pvUci: ["e5f7", "d8e8", "f7h8"], cp: 400 }],
};

test("a separately scored immediate tactic becomes the preview without inventing an engine rank", () => {
  const scan = buildLiveTacticalScan(supplementalForkInput);
  expect(scan.preferredReason).toBe("additional-tactical-option");
  expect(scan.preferredMultipv).toBe(4);
  expect(scan.motifs[0].id).toBe("fork");
  expect(scan.variations[0].lineUci).toEqual(["h2h3"]);
  expect(scan.variations[3].origin).toBe("targeted");
  expect(scan.arrows.map(a => a.from + a.to)).toEqual(["e5f7", "f7d8", "f7h8"]);
  expect(previewLiveTacticalVariation(scan, 1).lineUci).toEqual(["h2h3"]);
});

test.each([
  { depth: 15 }, { depth: undefined }, { depth: NaN },
  { cp: undefined }, { cp: NaN }, { cp: Infinity }, { cp: -500 }, { mate: Infinity },
  { pvUci: ["e5e7"] }, { pvUci: [] }, { pvUci: ["h2h3"] },
])("incomplete, inferior, duplicate or illegal supplemental evidence is discarded: %j", change => {
  const scan = buildLiveTacticalScan({ ...supplementalForkInput,
    supplementalVariations: [{ ...supplementalForkInput.supplementalVariations![0], ...change }],
  });
  expect(scan.variations).toHaveLength(3);
  expect(scan.preferredMultipv).toBeUndefined();
});

test("missing main scores, stronger-depth main evidence and forced mates cannot borrow a weaker probe", () => {
  for (const change of [{ cp: undefined }, { depth: 17 }, { mate: 2 }]) {
    const scan = buildLiveTacticalScan({ ...supplementalForkInput,
      variations: [{ ...supplementalForkInput.variations![0], ...change }],
    });
    expect(scan.variations).toHaveLength(1);
  }
});

test("supplemental root uniqueness and the two-candidate cap are independent of main ranks", () => {
  const extra = supplementalForkInput.supplementalVariations![0];
  const scan = buildLiveTacticalScan({ ...supplementalForkInput, supplementalVariations: [
    extra, { ...extra, multipv: 1 },
    { ...extra, pvUci: ["c4f7"] }, { ...extra, pvUci: ["d2d3"] },
  ] });
  expect(scan.variations.map(v => v.multipv)).toEqual([1, 2, 3, 4, 5]);
  expect(scan.variations.filter(v => v.origin === "targeted").map(v => v.lineUci[0])).toEqual(["e5f7", "c4f7"]);
});

test("an existing clear tactic excludes substantially weaker supplemental wins, not close alternatives", () => {
  // Synthetic scores isolate the relevance rule. Both f7 moves have real
  // themes, but the additional lane should not drown an established main one.
  const input = { ...supplementalForkInput,
    variations: [{ depth: 16, multipv: 1, pvUci: ["e5f7"], cp: 500 }],
    supplementalVariations: [{ depth: 16, pvUci: ["c4f7"], cp: 300 }],
  };
  expect(buildLiveTacticalScan(input).variations.map(v => v.lineUci[0])).toEqual(["e5f7"]);
  expect(buildLiveTacticalScan({ ...input, supplementalVariations: [{ ...input.supplementalVariations[0], cp: 450 }] }).variations.map(v => v.lineUci[0])).toEqual(["e5f7", "c4f7"]);
  // Genuine ideas outside a quiet principal line can still preserve a win.
  expect(buildLiveTacticalScan({ ...supplementalForkInput,
    supplementalVariations: [{ ...supplementalForkInput.supplementalVariations![0], cp: 200 }],
  }).motifs[0].id).toBe("fork");
});

test("fresh frozen public searches use the real supplemental path without strengthening tentative pins", () => {
  const receipt = JSON.parse(readFileSync("benchmarks/tactical-relevance/targeted-candidate-stockfish-18.json", "utf8"));
  for (const row of receipt.results) {
    const base = { fen: row.fen, engineName: "Frozen Stockfish 18", depth: 16, pvUci: row.main[0].pvUci, variations: row.main };
    const scan = buildLiveTacticalScan({ ...base, supplementalVariations: row.extra });
    const extra = scan.variations.filter(v => v.origin === "targeted");
    const expected = row.id === "Constructed discovery candidates" ? [["pin", "medium"], ["pin", "medium"]] : [];
    expect(extra.map(v => [v.motifs[0]?.id, v.motifs[0]?.confidence])).toEqual(expected);
    expect(scan.preferredReason).not.toBe("additional-tactical-option");
    expect(scan.variations.filter(v => !v.origin)).toEqual(buildLiveTacticalScan(base).variations);
  }
});

test.skipIf(!process.env.TACTICAL_TARGETED_EXACT_REPLAY || !process.env.TACTICAL_TARGETED_REPLAY_REPORT)(
  "replay complete frozen candidate searches without replacing their engine evidence",
  async () => {
    const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const output = privateReportPath(process.env.TACTICAL_TARGETED_REPLAY_REPORT!);
    expect(existsSync(output)).toBe(false);
    const baseline = JSON.parse(readFileSync(process.env.TACTICAL_TARGETED_EXACT_REPLAY!, "utf8"));
    expect(baseline.results.length).toBeGreaterThan(0);
    const results = baseline.results.map((row: any) => {
      expect(nominateTacticalCandidateMoves(row.fen, row.main.map((v:any) => v.pvUci[0]))).toEqual(row.nominations);
      const start = performance.now();
      const scan = buildLiveTacticalScan(row.scanInput);
      const classificationMs = performance.now() - start;
      const mainScan = buildLiveTacticalScan({...row.scanInput, supplementalVariations: []});
      expect(scan.variations.filter(v => !v.origin)).toEqual(mainScan.variations);
      return {...row, scan, mainScan, classificationMs};
    });
    const changed = results.filter((row:any, i:number) => JSON.stringify(row.scan) !== JSON.stringify(baseline.results[i].scan)).map((row:any) => row.id);
    writeFileSync(output, JSON.stringify({scope:"Exact engine-input replay. No fresh engine searches or held-out accuracy claim.",replayFrom:process.env.TACTICAL_TARGETED_EXACT_REPLAY,results},null,2), {flag:"wx"});
    console.log({count:results.length,changed});
  }, 120000,
);
