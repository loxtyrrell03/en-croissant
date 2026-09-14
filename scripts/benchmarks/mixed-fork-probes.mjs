import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci, makeUci } from "chessops/util";
import {
  mixedForkFen,
  mixedForkPreviousFen,
  mixedForkControls,
} from "../../src/utils/tests/fixtures/mixedTargetFork.ts";

export function mixedForkProbes(trace) {
  assert.equal(trace.fen, mixedForkFen);
  assert.equal(trace.proof.gain, 100);
  assert.deepEqual(trace.proof.targets, [4, 27, 31]);
  const pos = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const play = (p, uci) => {
    const m = parseUci(uci);
    assert.ok(m && p.isLegal(m));
    p.play(m);
  };
  const probes = [
    { id: "mixed-fork:root", fen: mixedForkFen, searchMove: "d2f3" },
    { id: "mixed-fork:root-choice", fen: mixedForkFen },
    { id: "mixed-fork:missed", fen: mixedForkFen, searchMove: "c6c7" },
  ];
  for (const move of ["b1b2", "b1c2", "b1c1"]) {
    probes.push({ id: "mixed-fork:king:" + move, fen: mixedForkPreviousFen, searchMove: move });
    const p = pos(mixedForkPreviousFen);
    play(p, move);
    if (move !== "b1c2")
      probes.push({
        id: "mixed-fork:after-king:" + move,
        fen: makeFen(p.toSetup()),
        searchMove: "d2f3",
      });
  }
  for (const control of mixedForkControls) {
    probes.push({ id: "mixed-fork:control:" + control.id, fen: control.fen, searchMove: "d2f3" });
    probes.push({ id: "mixed-fork:control-choice:" + control.id, fen: control.fen });
  }
  const forked = pos(mixedForkFen);
  play(forked, "d2f3");
  const replies = [...forked.allDests()].flatMap(([from, tos]) =>
    [...tos].map((to) => makeUci({ from, to })),
  );
  assert.deepEqual(trace.proof.captureBranches.map((b) => b.replyUci).sort(), replies.sort());
  for (const branch of trace.proof.captureBranches) {
    const p = forked.clone();
    play(p, branch.replyUci);
    const fen = makeFen(p.toSetup());
    play(p, branch.answerUci);
    probes.push({ id: "mixed-fork:reply:" + branch.replyUci, fen, searchMove: branch.answerUci });
  }
  return probes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tracePath, output] = process.argv.slice(2);
  const probes = mixedForkProbes(JSON.parse(readFileSync(tracePath, "utf8")));
  writeFileSync(
    output,
    JSON.stringify(
      { samplePath: "benchmarks/tactical-relevance/broader-game-context.json", probes },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    `Prepared ${probes.length} fixed root, comparison, control and selected-capture searches.`,
  );
}
