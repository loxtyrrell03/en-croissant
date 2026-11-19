import { readFileSync, writeFileSync } from "node:fs";
import { test, vi } from "vitest";
import * as tactical from "@/utils/tacticalMotifs/liveTactics";

const outputPath = process.env.LINE_ROUTE_OUTPUT;
if (!outputPath) throw new Error("Set LINE_ROUTE_OUTPUT to a new output path.");

test.runIf(!process.env.LINE_ROUTE_ARCHIVE)("scores the frozen Stockfish lines", () => {
  const path = process.env.LINE_ROUTE_INPUT ?? new URL("./reserve.json", import.meta.url);
  const rows = JSON.parse(readFileSync(path, "utf8"));
  const results = rows.map(({ id, fen, analysis, history }) => {
    const start = performance.now();
    const scan = tactical.buildLiveTacticalScan({
      fen,
      depth: analysis.depth,
      engineName: "Stockfish 19",
      pvUci: analysis.pvUci,
      variations: [analysis],
      tacticalHistory: history,
    });
    return { id, engine: scan.variations[0].motifs, ms: performance.now() - start };
  });
  writeFileSync(outputPath, JSON.stringify(results), { flag: "wx" });
}, 240_000);

test.runIf(!!process.env.LINE_ROUTE_ARCHIVE)("replays the archived game worker", async () => {
  const rows = JSON.parse(readFileSync(process.env.LINE_ROUTE_ARCHIVE, "utf8"));
  let scan;
  let notices = [];
  const buildScan = tactical.buildLiveTacticalScan;
  const worker = {
    onmessage: null,
    postMessage(message) {
      if (message.type === "result") notices.push(message.report);
    },
  };
  vi.stubGlobal("self", worker);
  vi.spyOn(tactical, "buildLiveTacticalScan").mockImplementation((args) => {
    scan = buildScan(args);
    return scan;
  });
  try {
    await import("@/components/panels/tactics/decisionReport.worker");
    const results = rows.map(({ id, ...input }) => {
      const start = performance.now();
      scan = undefined;
      notices = [];
      worker.onmessage({ data: { input, history: input.history, engineName: "Stockfish 19" } });
      if (notices.length !== 1 || !scan) throw new Error("Unexpected worker state for " + id);
      return {
        id,
        report: notices[0],
        motifs: scan.variations.map(({ lineUci, motifs }) => ({ moveUci: lineUci[0], motifs })),
        ms: performance.now() - start,
      };
    });
    writeFileSync(outputPath, JSON.stringify(results), { flag: "wx" });
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
}, 250_000);
