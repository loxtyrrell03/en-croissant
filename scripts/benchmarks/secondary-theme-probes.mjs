import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci, parseSquare } from "chessops/util";

const samplePath = "benchmarks/tactical-relevance/secondary-theme-development.json";
const fixture = JSON.parse(readFileSync(samplePath, "utf8"));
const probes = [];
function position(id, count = 0) {
  const row = fixture.cases.find((r) => r.id === `lichess:${id}`);
  const pos = Chess.fromSetup(parseFen(row.startFen).unwrap()).unwrap();
  for (const uci of row.bestLine.slice(0, count)) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) throw new Error(`Illegal ${id} ${uci}`);
    pos.play(move);
  }
  return pos;
}
const add = (id, pos, searchMove, note) => {
  if (searchMove && !pos.isLegal(parseUci(searchMove))) throw new Error(`Illegal probe ${id}`);
  probes.push({ id, fen: makeFen(pos.toSetup()), ...(searchMove ? { searchMove } : {}), note });
};
for (const id of ["xxDaj", "sKDBG", "SD5oo"]) {
  const pos = position(id, 1),
    ctx = pos.ctx();
  for (const [from, tos] of pos.allDests(ctx))
    for (const to of tos) {
      const move = { from, to },
        next = pos.clone();
      next.play(move);
      add(
        `${id}:reply:${makeUci(move)}`,
        next,
        undefined,
        "Every legal root defence; score is for the original attacker.",
      );
    }
}
for (const count of [1, 2, 3, 4])
  add(
    `qQG5v:ply${count}`,
    position("qQG5v", count),
    undefined,
    "Forced king-hunt decision; not another primary theme.",
  );
const old = position("qQG5v", 3);
old.turn = "white";
old.epSquare = undefined;
old.play(parseUci("h8g7"));
add(
  "qQG5v:old-guard",
  old,
  "g4g7",
  "Turn-swapped protection probe, not a playable variation: the old queen recaptures.",
);
for (const square of ["g4", "e7"]) {
  const pos = position("qQG5v", 3);
  pos.board.take(parseSquare(square));
  pos.play(parseUci("h6g5"));
  add(
    `qQG5v:missing-${square}`,
    pos,
    "h8g7",
    "Constructed control: no old guard or an extra king flight.",
  );
}
const guarded = position("qQG5v", 3);
guarded.board.set(parseSquare("g8"), { color: "black", role: "rook" });
guarded.play(parseUci("h6g5"));
add("qQG5v:second-guard", guarded, "h8g7", "Constructed additional rook can recapture on g7.");
const liability = position("xxDaj");
liability.board.take(parseSquare("g2"));
liability.board.take(parseSquare("e6"));
liability.board.set(parseSquare("g1"), { color: "white", role: "king" });
liability.board.set(parseSquare("f5"), { color: "white", role: "bishop" });
add(
  "xxDaj:off-square-liability",
  liability,
  "b2c2",
  "Constructed unchecking capture permits Bxc8; local rook gain is not retained.",
);
for (const piece of ["q", "r", "b", "n"])
  add(
    `oSj8l:promotion-${piece}`,
    position("oSj8l"),
    `b7b8${piece}`,
    "Compare every legal promotion choice before calling the underpromotion necessary.",
  );
for (const id of ["nkeLA", "BvWlf", "vMQ3b", "pV2Bd"]) {
  const real = position(id, 1);
  add(
    `${id}:after`,
    real,
    undefined,
    "Real reached pawn ending; engine estimate, not exact zugzwang proof.",
  );
  real.turn = real.turn === "white" ? "black" : "white";
  real.epSquare = undefined;
  add(
    `${id}:pass`,
    real,
    undefined,
    "Counterfactual side-to-move swap; not a legal line and not a tablebase certificate.",
  );
}
add(
  "i2SLh:after-queening",
  position("i2SLh", 7),
  undefined,
  "Do not equate queening first with winning; inspect the opponent's promotion and queen ending.",
);
writeFileSync(process.argv[2], JSON.stringify({ samplePath, probes }, null, 2), { flag: "wx" });
process.stdout.write(
  `Prepared ${probes.length} public-only decision and contrary-control searches.\n`,
);
