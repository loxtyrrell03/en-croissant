import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import {
  trappedRookFen,
  trapControls,
  unrelatedPayoffTrap,
} from "../../src/utils/tests/fixtures/trapRelevance.ts";

export function buildTrapProbes(trace) {
  const probes = [];
  const add = (id, fen, searchMove, note) => {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    if (searchMove && !pos.isLegal(parseUci(searchMove))) throw new Error(`Illegal witness ${id}`);
    probes.push({ id, fen, ...(searchMove ? { searchMove } : {}), note });
  };
  for (const branch of trace.proof.branches) {
    add(
      `rook-trap:chosen:${branch.replyUci}`,
      branch.fen,
      branch.answerUci,
      "Chosen all-defence root witness, not necessarily the engine's best move.",
    );
    for (const [index, leaf] of (branch.continuation ?? []).entries())
      add(
        `rook-trap:recovery:${index}`,
        leaf.fen,
        leaf.moveUci,
        "Every selected local defender-capture recovery leaf; full-position scores do not equal the local material bound.",
      );
  }
  for (const [id, proof] of [
    ["old-trap", trace.oldProof],
    ...trace.otherTraps.filter((c) => c.proof).map((c) => [c.id, c.proof]),
  ])
    for (const branch of proof.branches.filter(
      (b) => id === "counterplay" || b.gain === proof.gain,
    )) {
      add(
        `${id}:chosen:${branch.replyUci}`,
        branch.fen,
        branch.answerUci,
        "All counterplay branches or changed minimum branches: include off-square compensation. Local material profit does not certify best full-position play.",
      );
      if (id === "counterplay")
        add(
          `${id}:unrestricted:${branch.replyUci}`,
          branch.fen,
          undefined,
          "Compare the local material witness with unrestricted best play, including positional counterplay.",
        );
    }
  const counter = trace.otherTraps.find((c) => c.id === "counterplay");
  const pos = Chess.fromSetup(parseFen(counter.fen).unwrap()).unwrap();
  add(
    "counterplay:root",
    makeFen(pos.toSetup()),
    counter.move,
    "Recheck the old trap claim and overall position, not just the local threshold.",
  );
  for (const [index, move] of [counter.move, "b6b5", "d5a8"].entries()) {
    if (!pos.isLegal(parseUci(move))) throw new Error(`Illegal counterplay ${move}`);
    pos.play(parseUci(move));
    add(
      `counterplay:ply${index + 1}`,
      makeFen(pos.toSetup()),
      index === 2 ? "b5b2" : undefined,
      "The queen can collect a second piece/pawn; inspect whether the smaller trap remains meaningful.",
    );
  }
  add(
    "rook-trap:root",
    trappedRookFen,
    "g1f2",
    "Full-position root estimate, separate from the 180 cp local certificate.",
  );
  add(
    "rook-trap:missed",
    trappedRookFen,
    "f1e1",
    "A legal move missing the king's trapping opportunity.",
  );
  for (const control of trapControls) {
    add(`control:${control.id}:root`, control.fen, "g1f2", control.reason);
    const after = Chess.fromSetup(parseFen(control.fen).unwrap()).unwrap();
    after.play(parseUci("g1f2"));
    add(`control:${control.id}:reply`, makeFen(after.toSetup()), control.reply, control.reason);
  }
  const unrelated = Chess.fromSetup(parseFen(unrelatedPayoffTrap.fen).unwrap()).unwrap();
  unrelated.play(parseUci("c2b2"));
  add(
    "control:unrelated:escape",
    makeFen(unrelated.toSetup()),
    "a1d1",
    "The rook escapes even though Black can take a different queen afterwards.",
  );
  unrelated.play(parseUci("a1d1"));
  add(
    "control:unrelated:payoff",
    makeFen(unrelated.toSetup()),
    "h8h5",
    "This queen win does not make the rook on d1 trapped.",
  );
  return probes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tracePath, output] = process.argv.slice(2);
  const probes = buildTrapProbes(JSON.parse(readFileSync(tracePath, "utf8")));
  writeFileSync(
    output,
    JSON.stringify(
      { samplePath: "benchmarks/tactical-relevance/secondary-theme-development.json", probes },
      null,
      2,
    ),
    { flag: "wx" },
  );
  process.stdout.write(
    `Prepared ${probes.length} independent chosen-witness and contrary searches.\n`,
  );
}
