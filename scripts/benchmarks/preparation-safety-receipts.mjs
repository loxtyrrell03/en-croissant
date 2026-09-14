import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

const [mode, ...args] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sample = read("benchmarks/tactical-relevance/preparation-safety-development.json");
const write = (path, data) =>
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
const advance = (position, uci) => {
  const move = parseUci(uci);
  assert(move && position.isLegal(move));
  position.play(move);
};
if (mode === "engine") {
  const [input, output] = args,
    bytes = readFileSync(input),
    report = JSON.parse(bytes);
  const allowed = new Set();
  for (const row of sample.cases) {
    const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    allowed.add(makeFen(pos.toSetup()));
    advance(pos, row.root);
    for (const [from, dests] of pos.allDests())
      for (const to of dests) {
        assert(!(pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)));
        const next = pos.clone();
        assert(next.isLegal({ from, to }));
        next.play({ from, to });
        allowed.add(makeFen(next.toSetup()));
      }
    const path = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    for (const move of row.resourceUci ?? []) {
      allowed.add(makeFen(path.toSetup()));
      advance(path, move);
    }
  }
  const ids = new Set();
  const searches = report.searches.map(({ id, fen, searchMove, lines }) => {
    assert(sample.cases.some((row) => id.startsWith(`${row.id}:`)));
    assert(!ids.has(id));
    ids.add(id);
    assert(
      allowed.has(fen),
      "Only reached positions from the public development sample may be published",
    );
    assert(lines.length);
    for (const line of lines) {
      assert.equal(line.depth, 16);
      if (searchMove) assert.equal(line.pvUci[0], searchMove);
      const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
      for (const move of line.pvUci) advance(pos, move);
    }
    return { id, fen, ...(searchMove ? { searchMove } : {}), lines };
  });
  assert.equal(searches.length, report.requested);
  write(output, {
    scope:
      "Final selected-answer audit of public real roots and constructed controls. Whole-position scores are side-to-move estimates, not local gain certificates or accuracy labels.",
    engine: "Stockfish 18, one thread, 32 MB hash, depth 16",
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    searches,
  });
  console.log(`${searches.length} legally verified public searches.`);
} else if (mode === "worker") {
  const [input, gameInput, preparationInput, output] = args;
  const prior = read("benchmarks/tactical-relevance/built-worker-adapter105.json");
  const take = (rows, expectedIds, key) =>
    rows.map((row) => {
      assert(expectedIds.delete(key(row)));
      for (const time of [row.elapsedMs, row.startupMs, row.classificationMs])
        assert(Number.isFinite(time) && time >= 0);
      assert(row.primary.every((theme) => /^[A-Za-z0-9_]+$/.test(theme)));
      if (row.matchesSource !== undefined) assert.equal(row.matchesSource, true);
      return {
        id: row.id,
        ...(row.lane ? { lane: row.lane } : {}),
        elapsedMs: row.elapsedMs,
        startupMs: row.startupMs,
        classificationMs: row.classificationMs,
        primary: row.primary,
      };
    });
  const ids = new Set(prior.cases.map((row) => row.id));
  const contexts = new Set(prior.contexts.map((row) => `${row.id}:${row.lane}`));
  const preparations = new Set(
    sample.cases.flatMap((row) =>
      ["original", "reflected"].flatMap((side) =>
        ["root", "line"].map((lane) => `${row.id}:${side}:${lane}`),
      ),
    ),
  );
  const cases = take(read(input).cases, ids, (row) => row.id);
  const gameCases = take(read(gameInput).cases, contexts, (row) => `${row.id}:${row.lane}`);
  const controls = take(read(preparationInput).cases, preparations, (row) => row.id);
  assert.equal(ids.size + contexts.size + preparations.size, 0);
  const changedPriorHeadlines = prior.cases
    .filter(
      (old) =>
        JSON.stringify(old.primary) !==
        JSON.stringify(cases.find((row) => row.id === old.id).primary),
    )
    .map((row) => row.id);
  const changedContextHeadlines = prior.contexts
    .filter(
      (old) =>
        JSON.stringify(old.primary) !==
        JSON.stringify(gameCases.find((row) => row.id === old.id && row.lane === old.lane).primary),
    )
    .map((row) => `${row.id}:${row.lane}`);
  const rows = [...cases, ...gameCases, ...controls],
    times = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
  const timing = {
    count: times.length,
    medianMs: times[Math.floor(times.length / 2)],
    p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    maxMs: times.at(-1),
    maxComputeMs: Math.max(...rows.map((row) => row.classificationMs)),
  };
  write(output, {
    scope:
      "Allowlisted public production-controller inputs: 808 retained, 63 game contexts and 28 new preparation controls. Excludes engine/UI latency. Stability and source parity are not accuracy.",
    changedPriorHeadlines,
    changedContextHeadlines,
    timing,
    cases,
    contexts: gameCases,
    controls,
  });
  console.log(JSON.stringify({ changedPriorHeadlines, changedContextHeadlines, timing }));
} else throw new Error("Choose engine or worker mode");
