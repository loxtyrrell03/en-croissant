import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
const [output] = process.argv.slice(2);
assert.ok(output && !existsSync(output));
const sample = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/cross-phase-development.json", "utf8"),
);
const row = sample.cases.find((r) => r.id === "lichess:EKWHC");
const before = Chess.fromSetup(parseFen(row.startFen).unwrap()).unwrap(),
  after = before.clone();
after.play(parseUci(row.bestLine[0]));
const pass = after.clone();
pass.turn = "white";
pass.epSquare = undefined;
const alternative = before.clone();
alternative.play(parseUci("g4f3"));
const requests = [
  { id: "root", pos: before },
  { id: "after-Kf4", pos: after },
  { id: "pass-after-Kf4", pos: pass },
  { id: "after-Kf3", pos: alternative },
];
const receipt = {
  scope:
    "Independent six-piece Syzygy development audit. Categories use the side to move in each position; move categories refer to the child, not the parent. This does not add a runtime tablebase dependency or prove general pawn-ending coverage.",
  sourceSha256: sample.sourceSha256,
  sourceId: row.id,
  queries: [],
};
writeFileSync(output, JSON.stringify(receipt, null, 2), { flag: "wx" });
for (const { id, pos } of requests) {
  assert.ok([...pos.board].length <= 7 && !pos.isCheck());
  const fen = makeFen(pos.toSetup()),
    url = `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `Stop on HTTP ${response.status}; do not skip failed queries`);
  const result = await response.json();
  assert.deepEqual(
    new Set(result.moves.map((m) => m.uci)),
    new Set(
      [...pos.allDests()].flatMap(([from, tos]) => [...tos].map((to) => makeUci({ from, to }))),
    ),
  );
  receipt.queries.push({ id, fen, url, checkedAt: new Date().toISOString(), result });
  writeFileSync(output, JSON.stringify(receipt, null, 2));
  console.log(
    id,
    result.category,
    result.moves.length,
    result.moves.map((m) => `${m.uci}:${m.category}`).join(" "),
  );
}
