import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";

export const values = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };
export const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
export const legalMoves = (pos) =>
  [...pos.allDests()].flatMap(([from, destinations]) =>
    [...destinations].flatMap((to) =>
      pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
        ? ["queen", "rook", "bishop", "knight"].map((promotion) => ({ from, to, promotion }))
        : [{ from, to }],
    ),
  );
export const balance = (pos, color) =>
  [...pos.board].reduce(
    (sum, [, piece]) => sum + (piece.color === color ? 1 : -1) * values[piece.role],
    0,
  );
export function play(pos, uci) {
  const move = typeof uci === "string" ? parseUci(uci) : uci;
  if (!move || !pos.isLegal(move)) throw Error(`Illegal move ${uci} at ${makeFen(pos.toSetup())}`);
  const next = pos.clone();
  next.play(move);
  return next;
}
export function captureValue(pos, move) {
  if (pos.board.get(move.to)?.color !== pos.turn && pos.board.get(move.to))
    return values[pos.board.get(move.to).role];
  if (pos.board.get(move.from)?.role === "pawn" && move.to === pos.epSquare) return values.pawn;
  return 0;
}

export function enumerateLtbye() {
  const inputs = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/rare-causal-cohort-v2-inputs.json", "utf8"),
  );
  const row = inputs.puzzles.find((r) => r.id === "lichess:Ltbye");
  const root = position(row.startFen),
    after = play(root, row.bestLine[0]);
  const branches = legalMoves(after).map((reply) => {
    const answer = play(after, reply);
    return {
      reply: makeUci(reply),
      san: makeSan(after, reply),
      fen: makeFen(answer.toSetup()),
      check: answer.isCheck(),
      capture: captureValue(after, reply),
      captureCandidates: legalMoves(answer)
        .filter((move) => captureValue(answer, move) > 0)
        .map((move) => ({
          uci: makeUci(move),
          san: makeSan(answer, move),
          capture: captureValue(answer, move),
          gainToHere: balance(play(answer, move), root.turn) - balance(root, root.turn),
        })),
    };
  });
  return {
    schemaVersion: 1,
    scope: "All legal root replies and capture candidates only; not a completed proof",
    id: row.id,
    fen: row.startFen,
    rootMove: row.bestLine[0],
    rootChecks: after.isCheck(),
    previousFen: row.sourceFen,
    previousMove: row.precedingMove,
    previousCapture: captureValue(position(row.sourceFen), parseUci(row.precedingMove)),
    branches,
  };
}

// An independent, finite observation: enumerate EVERY next legal defence to
// each certified first answer and report its actual material delta. This does
// not substitute a fixed-depth material total for the kernel's exchange and
// countercheck proof, and does not assert a game-theoretic win.
export function inspectNextDefences(rootFen, rootMove, leaves, requiredGain = 0) {
  const root = position(rootFen),
    side = root.turn,
    initial = balance(root, side),
    rows = [];
  for (const leaf of leaves) {
    let pos = play(root, rootMove);
    for (const uci of leaf.lineUci) pos = play(pos, uci);
    const replies = legalMoves(pos).map((reply) => {
      const next = play(pos, reply);
      const materialDelta = balance(next, side) - initial;
      const repairs =
        next.isCheck() || materialDelta < requiredGain
          ? legalMoves(next)
              .map((move) => {
                const end = play(next, move);
                return {
                  uci: makeUci(move),
                  san: makeSan(next, move),
                  materialDelta: balance(end, side) - initial,
                };
              })
              .filter((move) => move.materialDelta >= requiredGain)
              .sort((a, b) => b.materialDelta - a.materialDelta)
          : [];
      return {
        uci: makeUci(reply),
        san: makeSan(pos, reply),
        materialDelta,
        check: next.isCheck(),
        checkmate: next.isCheckmate(),
        ...(next.isCheck() || materialDelta < requiredGain
          ? { legalImmediateRepair: repairs[0] ?? null }
          : {}),
      };
    });
    rows.push({
      firstReply: leaf.lineUci[0],
      answer: leaf.moveUci,
      replyCount: replies.length,
      materialFloor: Math.min(...replies.map((reply) => reply.materialDelta)),
      checkingReplies: replies.filter((reply) => reply.check),
      belowRequired: replies.filter((reply) => reply.materialDelta < requiredGain),
      minimumReplies: replies.filter(
        (reply) => reply.materialDelta === Math.min(...replies.map((row) => row.materialDelta)),
      ),
    });
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(enumerateLtbye(), null, 2));
