import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const [mode, input, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const report = read(input),
  sample = read("benchmarks/tactical-relevance/quiet-mate-development.json");
let receipt;
if (mode === "engine" || mode === "controls") {
  assert.equal(report.completed, mode === "engine" ? 134 : report.requested);
  const searches = report.searches.map((row) => {
    assert(
      mode === "engine"
        ? sample.cases.some((example) => row.id.startsWith(`${example.id}:`))
        : /^(rook-interposition|extra-diagonal-defender|quiet-king-approach|queen-countercheck|missing-mate-support|checking-resource|bishop-countercheck):/.test(
            row.id,
          ),
    );
    const lines = row.lines.map((line) => ({
      multipv: line.multipv,
      depth: line.depth,
      cp: line.cp,
      mate: line.mate,
      pvUci: line.pvUci,
      pvSan: line.pvSan,
    }));
    if (mode === "engine" || row.mateWithin !== undefined) assert(lines[0].mate > 0);
    if (row.mateWithin !== undefined) assert(lines[0].mate <= row.mateWithin);
    return {
      id: row.id,
      fen: row.fen,
      searchMove: row.searchMove,
      mateWithin: row.mateWithin,
      lines,
    };
  });
  for (const row of mode === "engine" ? sample.cases : [])
    for (const mode of ["root", "best"])
      assert.equal(
        searches.find((search) => search.id === `${row.id}:${mode}`).lines[0].mate,
        Number(row.stratum.at(-1)),
      );
  receipt = {
    scope:
      mode === "engine"
        ? "134 fresh Stockfish 18 depth-16 searches: nine best and fixed roots, every selected attack and terminal mating choice in six complete short-mate certificates. Three longer mates remain classifier coverage gaps. No private data and no population accuracy claim."
        : "Fresh Stockfish 18 depth-16 verification of three complete constructed mating certificates plus four contrary-resource roots. Missing proof is not automatically a losing or quiet position. No private data or population accuracy claim.",
    searches,
  };
} else if (mode === "worker") {
  const prior = read("benchmarks/tactical-relevance/built-worker-adapter103.json");
  const ids = new Set([
    ...prior.cases.map((row) => row.id),
    ...sample.cases.flatMap((row) =>
      [row.id, `${row.id}:reflected`].flatMap((id) =>
        ["short", "full"].map((kind) => `quiet-mate:${id}:${kind}`),
      ),
    ),
    ...sample.cases.map((row) => `quiet-mate-engine:${row.id}:root`),
  ]);
  assert.equal(ids.size, 808);
  assert.equal(report.cases.length, ids.size);
  const cases = report.cases.map((row) => {
    assert(ids.delete(row.id));
    assert.equal(row.matchesSource, true);
    for (const key of ["elapsedMs", "startupMs", "classificationMs"])
      assert(Number.isFinite(row[key]) && row[key] >= 0);
    assert(row.primary.every((id) => /^[a-zA-Z0-9_]+$/.test(id)));
    return {
      id: row.id,
      elapsedMs: row.elapsedMs,
      startupMs: row.startupMs,
      classificationMs: row.classificationMs,
      primary: row.primary,
      matchesSource: true,
    };
  });
  assert.equal(ids.size, 0);
  const changedPriorHeadlines = prior.cases
    .filter(
      (old) =>
        JSON.stringify(old.primary) !==
        JSON.stringify(cases.find((row) => row.id === old.id).primary),
    )
    .map((row) => row.id);
  receipt = {
    scope:
      "Allowlisted public IDs. Actual controller and cold production worker, excluding engine/network/native UI. Source agreement and stability are not accuracy.",
    priorCount: prior.cases.length,
    changedPriorHeadlines,
    cases,
  };
  const times = cases.map((row) => row.elapsedMs).sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      count: cases.length,
      changedPriorHeadlines,
      median: times[Math.floor(times.length / 2)],
      p95: times[Math.ceil(times.length * 0.95) - 1],
      max: times.at(-1),
      maxCompute: Math.max(...cases.map((row) => row.classificationMs)),
    }),
  );
} else throw new Error("Use engine or worker");
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
