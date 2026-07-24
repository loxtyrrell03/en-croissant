import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// The production home server runs from a stable AppData runtime directory
// while its dependencies remain in the canonical repository. Resolve
// chessops from that repository explicitly instead of relying on ESM's
// module-relative node_modules lookup.
const dependencyRoot = process.env.EN_CROISSANT_REPO_ROOT || process.cwd();
const requireFromRepository = createRequire(join(dependencyRoot, "package.json"));
const { Chess } = requireFromRepository("chessops/chess");
const { makeFen, parseFen } = requireFromRepository("chessops/fen");
const { makeSanAndPlay, parseSan } = requireFromRepository("chessops/san");
const { makeUci, parseUci } = requireFromRepository("chessops/util");

// Chess evidence derived from the already-verified PC Stockfish trace.
// Positions, SAN, material changes, and opening-table matches are deterministic
// facts computed with a real chess library. Tactical/positional labels are a
// conservative evidence-based classification and remain subordinate to the
// concrete engine lines.

const OPENING_TSV_FILES = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"];
const OPENING_SCAN_MAX_PLIES = 80;
const PV_REPLAY_MAX_PLIES = 12;
const KEY_MOMENT_LIMIT = 7;
const TRACE_MOVE_LIMIT = 240;
// Lichess win-probability model: chances = 2/(1+exp(-0.00368208*cp)) - 1.
const WIN_PROB_MULTIPLIER = -0.00368208;
const PIECE_VALUES = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const ROLE_LABELS = {
  pawn: "pawn",
  knight: "knight",
  bishop: "bishop",
  rook: "rook",
  queen: "queen",
  king: "king",
};
const FILE_NAMES = "abcdefgh";

function positionFromFen(fen) {
  try {
    const setup = parseFen(String(fen || "").trim()).unwrap();
    return Chess.fromSetup(setup).unwrap();
  } catch {
    return null;
  }
}

function positionKeys(pos) {
  const epd = makeFen(pos.toSetup(), { epd: true });
  const parts = epd.split(" ");
  if (parts.length !== 4 || parts[3] === "-") return [epd];
  return [epd, [parts[0], parts[1], parts[2], "-"].join(" ")];
}

function squareName(square) {
  return `${FILE_NAMES[square % 8]}${Math.floor(square / 8) + 1}`;
}

function moveNumberLabel(ply, san) {
  const moveNumber = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${moveNumber}.${san}` : `${moveNumber}...${san}`;
}

function movetextFromSans(sans, startPly = 1) {
  const parts = [];
  for (const [index, san] of sans.entries()) {
    const ply = startPly + index;
    const moveNumber = Math.ceil(ply / 2);
    if (ply % 2 === 1) parts.push(`${moveNumber}. ${san}`);
    else if (index === 0) parts.push(`${moveNumber}... ${san}`);
    else parts.push(san);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Opening identification (transposition-aware, position-keyed)
// ---------------------------------------------------------------------------

export function loadOpeningIdentificationBook(dataDir) {
  const byKey = new Map();
  let entries = 0;
  for (const file of OPENING_TSV_FILES) {
    let text;
    try {
      text = readFileSync(join(String(dataDir || ""), file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const [eco, name, pgn] = line.split("\t");
      if (!eco || !name || !pgn || eco === "eco") continue;
      const pos = Chess.default();
      const uci = [];
      let valid = true;
      for (const token of pgn.trim().split(/\s+/)) {
        if (!token || /^\d+\.+$/.test(token)) continue;
        const move = parseSan(pos, token);
        if (!move) {
          valid = false;
          break;
        }
        uci.push(makeUci(move));
        pos.play(move);
      }
      if (!valid || uci.length === 0) continue;
      const record = { eco: eco.trim(), name: name.trim(), movetext: pgn.trim(), uci };
      for (const key of positionKeys(pos)) {
        const existing = byKey.get(key);
        if (!existing || existing.uci.length > record.uci.length) byKey.set(key, record);
      }
      entries += 1;
    }
  }
  return entries > 0 ? { byKey, entries } : null;
}

let cachedOpeningBook = null;
let cachedOpeningBookDir = "";

export function getOpeningIdentificationBook(dataDir) {
  const dir = String(dataDir || "");
  if (!dir) return null;
  if (cachedOpeningBookDir !== dir) {
    cachedOpeningBookDir = dir;
    cachedOpeningBook = loadOpeningIdentificationBook(dir);
  }
  return cachedOpeningBook;
}

export function identifyOpeningFromMoves(
  { moves = [], currentFen = "", scope = "whole-game" },
  book,
) {
  if (!book?.byKey?.size) return null;
  const records =
    scope === "position" || moves.length === 0
      ? currentFen
        ? [{ ply: null, fen: currentFen, san: "" }]
        : []
      : moves.slice(0, OPENING_SCAN_MAX_PLIES).map((move) => ({
          ply: Number(move.ply),
          fen: String(move.fenAfter || ""),
          san: String(move.san || ""),
          uci: String(move.uci || "").toLowerCase(),
        }));
  let deepest = null;
  for (const record of records) {
    const pos = positionFromFen(record.fen);
    if (!pos) continue;
    for (const key of positionKeys(pos)) {
      const opening = book.byKey.get(key);
      if (opening) {
        deepest = { record, opening };
        break;
      }
    }
  }
  if (!deepest) return null;
  const matchedPly = Number.isInteger(deepest.record.ply) ? deepest.record.ply : null;
  const bookUci = deepest.opening.uci.map((value) => value.toLowerCase());
  let sameMoveOrder = null;
  let gameMovetext = "";
  if (matchedPly !== null) {
    const played = moves.slice(0, matchedPly);
    gameMovetext = movetextFromSans(played.map((move) => String(move.san || "")));
    const playedUci = played.map((move) => String(move.uci || "").toLowerCase());
    if (playedUci.every(Boolean)) {
      sameMoveOrder =
        playedUci.length === bookUci.length &&
        playedUci.every((value, index) => value === bookUci[index]);
    } else {
      const playedSans = played.map((move) => String(move.san || "").replace(/[!?]+$/, ""));
      const bookSans = deepest.opening.movetext
        .split(/\s+/)
        .filter((token) => token && !/^\d+\.+$/.test(token));
      sameMoveOrder =
        playedSans.length === bookSans.length &&
        playedSans.every((value, index) => value === bookSans[index]);
    }
  }
  const nextMove =
    matchedPly === null ? null : moves.find((move) => Number(move.ply) === matchedPly + 1) || null;
  return {
    source: "position-table",
    eco: deepest.opening.eco,
    name: deepest.opening.name,
    matchedPly,
    bookMovetext: deepest.opening.movetext,
    gameMovetext,
    transposed: sameMoveOrder === null ? null : !sameMoveOrder,
    leftNamedTheory: nextMove
      ? { ply: Number(nextMove.ply), san: String(nextMove.san || "") }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Win probability, severity, and evaluation formatting
// ---------------------------------------------------------------------------

export function winProbFromWhiteEvaluation(evaluation) {
  if (!evaluation) return null;
  if (Number.isFinite(evaluation.whiteMate)) {
    const mate = Number(evaluation.whiteMate);
    if (mate === 0) return null;
    return mate > 0 ? 100 : 0;
  }
  if (!Number.isFinite(evaluation.whiteCp)) return null;
  const cp = Math.max(-1500, Math.min(1500, Number(evaluation.whiteCp)));
  return 100 * (0.5 + 0.5 * (2 / (1 + Math.exp(WIN_PROB_MULTIPLIER * cp)) - 1));
}

export function severityFromWinProbLoss(lossPct) {
  if (!Number.isFinite(lossPct)) return null;
  if (lossPct >= 30) return "blunder";
  if (lossPct >= 20) return "mistake";
  if (lossPct >= 10) return "inaccuracy";
  return null;
}

export function evalTextFromEvaluation(evaluation) {
  if (!evaluation) return "n/a";
  if (Number.isFinite(evaluation.whiteMate)) {
    const mate = Number(evaluation.whiteMate);
    return mate >= 0 ? `#${mate}` : `#-${Math.abs(mate)}`;
  }
  if (Number.isFinite(evaluation.whiteCp)) {
    const pawns = Number(evaluation.whiteCp) / 100;
    return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
  }
  return evaluation.terminal ? "game over" : "n/a";
}

function roundPct(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

// ---------------------------------------------------------------------------
// PV replay: SAN conversion plus material/forcing facts
// ---------------------------------------------------------------------------

export function replayUciLine(fen, uciMoves, maxPlies = PV_REPLAY_MAX_PLIES) {
  const pos = positionFromFen(fen);
  if (!pos) return null;
  const startBalance = materialBalance(pos);
  const sans = [];
  const details = [];
  let balance = startBalance;
  for (const raw of (Array.isArray(uciMoves) ? uciMoves : []).slice(0, maxPlies)) {
    const move = parseUci(String(raw || ""));
    if (!move || move.from === undefined || !pos.isLegal(move)) break;
    const mover = pos.turn;
    const capturedRole =
      pos.board.getRole(move.to) ||
      (pos.board.getRole(move.from) === "pawn" && move.to % 8 !== move.from % 8 ? "pawn" : null);
    const san = makeSanAndPlay(pos, move);
    balance = materialBalance(pos);
    sans.push(san);
    details.push({
      san,
      uci: makeUci(move),
      color: mover,
      to: move.to,
      isCapture: san.includes("x"),
      capturedRole,
      isCheck: san.endsWith("+") || san.endsWith("#"),
      isMate: san.endsWith("#"),
      whiteBalanceAfter: balance,
    });
  }
  if (details.length === 0) return null;
  return {
    startFen: String(fen),
    sans,
    details,
    startWhiteBalance: startBalance,
    endWhiteBalance: balance,
    endsInMate: details[details.length - 1].isMate,
  };
}

function materialBalance(pos) {
  let balance = 0;
  for (const [role, value] of Object.entries(PIECE_VALUES)) {
    if (!value) continue;
    balance +=
      value * (pos.board.pieces("white", role).size() - pos.board.pieces("black", role).size());
  }
  return balance;
}

function perspectiveBalance(whiteBalance, color) {
  return color === "black" ? -whiteBalance : whiteBalance;
}

function forcingMoveCount(replay, color, window = 6) {
  if (!replay) return 0;
  let count = 0;
  for (const detail of replay.details.slice(0, window)) {
    if (detail.color === color && (detail.isCapture || detail.isCheck)) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Phase heuristic
// ---------------------------------------------------------------------------

export function phaseForPosition(fen, ply) {
  const pos = positionFromFen(fen);
  if (pos) {
    let nonPawn = 0;
    for (const [role, value] of Object.entries(PIECE_VALUES)) {
      if (!value || role === "pawn") continue;
      nonPawn +=
        value * (pos.board.pieces("white", role).size() + pos.board.pieces("black", role).size());
    }
    const queens =
      pos.board.pieces("white", "queen").size() + pos.board.pieces("black", "queen").size();
    if (nonPawn <= 13 || (queens === 0 && nonPawn <= 20)) return "endgame";
  }
  return Number(ply) <= 24 ? "opening" : "middlegame";
}

// ---------------------------------------------------------------------------
// Mistake-nature classification
// ---------------------------------------------------------------------------

function mateForColor(evaluation, color) {
  if (!evaluation || !Number.isFinite(evaluation.whiteMate)) return null;
  const mate = Number(evaluation.whiteMate);
  if (mate === 0) return null;
  const forWhite = mate > 0;
  if ((color === "white") === forWhite) return Math.abs(mate);
  return -Math.abs(mate);
}

export function classifyKeyMomentNature({
  color,
  playedTo,
  winProbLoss,
  beforeEval,
  afterEval,
  bestReplay,
  refutationReplay,
}) {
  const motifs = [];
  const facts = [];
  const opponent = color === "white" ? "black" : "white";
  const colorLabel = color === "white" ? "White" : "Black";

  const mateBefore = mateForColor(beforeEval, color);
  const mateAfter = mateForColor(afterEval, color);
  const missedForcedMate =
    mateBefore !== null && mateBefore > 0 && !(mateAfter !== null && mateAfter > 0);
  const allowedForcedMate =
    mateAfter !== null && mateAfter < 0 && !(mateBefore !== null && mateBefore < 0);
  if (missedForcedMate) {
    motifs.push("missed-forced-mate");
    facts.push(
      `Before this move ${colorLabel} had a forced mate in ${mateBefore}; the played move gave it up.`,
    );
  }
  if (allowedForcedMate) {
    motifs.push("allowed-forced-mate");
    facts.push(
      `The played move allowed a forced mate in ${Math.abs(mateAfter)} against ${colorLabel}.`,
    );
  }

  // Material the mover loses across the engine's punishing line after the move.
  let refutationLoss = null;
  if (refutationReplay) {
    refutationLoss =
      perspectiveBalance(refutationReplay.startWhiteBalance, color) -
      perspectiveBalance(refutationReplay.endWhiteBalance, color);
    const first = refutationReplay.details[0];
    if (first && first.isCapture && Number.isInteger(playedTo) && first.to === playedTo) {
      const role = ROLE_LABELS[first.capturedRole] || "piece";
      motifs.push("capture-of-moved-piece");
      facts.push(
        `The engine reply ${first.san} immediately captures the ${role} that just arrived on ${squareName(playedTo)}.`,
      );
    } else if (
      first &&
      first.isCapture &&
      first.capturedRole &&
      PIECE_VALUES[first.capturedRole] >= 3
    ) {
      facts.push(
        `The engine reply ${first.san} wins the ${ROLE_LABELS[first.capturedRole]} on ${squareName(first.to)}.`,
      );
    }
    if (Number.isFinite(refutationLoss) && refutationLoss >= 1.7 && !refutationReplay.endsInMate) {
      motifs.push("loses-material");
      facts.push(
        `The punishing engine line wins about ${formatPawns(refutationLoss)} of material from ${colorLabel} (net swing from the position after the move).`,
      );
    }
    if (refutationReplay.endsInMate) {
      const finalMover = refutationReplay.details[refutationReplay.details.length - 1].color;
      if (finalMover === opponent) {
        if (!motifs.includes("allowed-forced-mate")) motifs.push("allowed-forced-mate");
        facts.push(`The punishing engine line ends in checkmate against ${colorLabel}.`);
      }
    }
  }

  // Material the mover could have won with the engine's preferred move instead.
  let missedGain = null;
  if (bestReplay) {
    missedGain =
      perspectiveBalance(bestReplay.endWhiteBalance, color) -
      perspectiveBalance(bestReplay.startWhiteBalance, color);
    if (Number.isFinite(missedGain) && missedGain >= 1.7 && !missedForcedMate) {
      motifs.push("missed-material-win");
      facts.push(
        `The engine's preferred line instead wins about ${formatPawns(missedGain)} of material for ${colorLabel}.`,
      );
    }
  }

  const opponentForcing = forcingMoveCount(refutationReplay, opponent);
  if (opponentForcing >= 2 && !motifs.includes("loses-material") && !allowedForcedMate) {
    motifs.push("forcing-refutation");
  }

  const directTacticalSignal =
    missedForcedMate || allowedForcedMate || motifs.includes("capture-of-moved-piece");
  const materialSignal =
    (Number.isFinite(refutationLoss) && refutationLoss >= 1.7) ||
    (Number.isFinite(missedGain) && missedGain >= 1.7);
  const minorMaterialSignal =
    (Number.isFinite(refutationLoss) && refutationLoss >= 0.9) ||
    (Number.isFinite(missedGain) && missedGain >= 0.9);

  let nature = "positional";
  let confidence = "medium";
  if (directTacticalSignal) {
    nature = "tactical";
    confidence = "high";
  } else if (materialSignal) {
    nature = "tactical";
    confidence = "medium";
  } else if (opponentForcing >= 2 && Number.isFinite(winProbLoss) && winProbLoss >= 20) {
    nature = "tactical";
    confidence = "medium";
  } else if (minorMaterialSignal) {
    nature = "mixed";
    confidence = "medium";
  } else if (
    Number.isFinite(refutationLoss) &&
    refutationLoss <= 0.5 &&
    (!Number.isFinite(missedGain) || missedGain <= 0.5) &&
    opponentForcing === 0 &&
    Number.isFinite(winProbLoss) &&
    winProbLoss < 20
  ) {
    nature = "positional";
    confidence = "medium";
    facts.push(
      "No immediate material loss, forced mate, check, or capture appears in the supplied engine continuations; inspect the structure, activity, king safety, and plan to explain the evaluation drop.",
    );
  } else {
    nature = "mixed";
    confidence = "low";
  }
  return { nature, confidence, motifs, facts, refutationLoss, missedGain };
}

function formatPawns(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} pawn${Math.abs(rounded - 1) < 0.001 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Whole-review derivation
// ---------------------------------------------------------------------------

export function deriveCoachReviewEvidence({
  moveAnalysis = [],
  playerColor = "white",
  scope = "whole-game",
  currentFen = "",
  openingBook = null,
}) {
  const rows = (Array.isArray(moveAnalysis) ? moveAnalysis : []).filter(
    (row) => row && Number.isInteger(Number(row.ply)) && row.fenBefore && row.fenAfter,
  );
  const selectedColor = playerColor === "black" ? "black" : "white";
  const openingIdentification = identifyOpeningFromMoves(
    { moves: rows, currentFen, scope },
    openingBook,
  );

  const perMove = rows.map((row) => {
    const color = row.color === "black" ? "black" : "white";
    const whiteBefore = winProbFromWhiteEvaluation(row.before);
    const whiteAfter = winProbFromWhiteEvaluation(row.after);
    const moverBefore = color === "black" && whiteBefore !== null ? 100 - whiteBefore : whiteBefore;
    const moverAfter = color === "black" && whiteAfter !== null ? 100 - whiteAfter : whiteAfter;
    const winProbLoss =
      moverBefore !== null && moverAfter !== null ? Math.max(0, moverBefore - moverAfter) : null;
    const bestMoveSan = replayUciLine(row.fenBefore, row.before?.pvUci, 1)?.sans[0] || null;
    const replyMoveSan = replayUciLine(row.fenAfter, row.after?.pvUci, 1)?.sans[0] || null;
    return {
      ply: Number(row.ply),
      color,
      san: String(row.san || ""),
      phase: phaseForPosition(row.fenBefore, Number(row.ply)),
      winProbBefore: roundPct(moverBefore),
      winProbAfter: roundPct(moverAfter),
      winProbLoss: roundPct(winProbLoss),
      severity: severityFromWinProbLoss(winProbLoss),
      bestMoveSan,
      replyMoveSan,
    };
  });
  const derivedByPly = new Map(perMove.map((entry) => [entry.ply, entry]));

  const keyMoments = [];
  for (const [index, row] of rows.entries()) {
    const entry = derivedByPly.get(Number(row.ply));
    if (!entry || entry.color !== selectedColor) continue;
    const beforeEval = row.before || null;
    const afterEval = row.after || null;
    const mateBefore = mateForColor(beforeEval, entry.color);
    const mateAfter = mateForColor(afterEval, entry.color);
    const mateMotif =
      (mateBefore !== null && mateBefore > 0 && !(mateAfter !== null && mateAfter > 0)) ||
      (mateAfter !== null && mateAfter < 0 && !(mateBefore !== null && mateBefore < 0));
    if (!mateMotif && (entry.winProbLoss === null || entry.winProbLoss < 8)) continue;

    const playedMove = parseUci(String(row.uci || ""));
    const bestUci = Array.isArray(beforeEval?.pvUci) ? beforeEval.pvUci : [];
    const playedWasBest =
      playedMove && bestUci[0] ? makeUci(playedMove) === String(bestUci[0]).toLowerCase() : false;
    const bestReplay = playedWasBest ? null : replayUciLine(row.fenBefore, bestUci);
    const refutationReplay = replayUciLine(row.fenAfter, afterEval?.pvUci);
    const natureAssessment = classifyKeyMomentNature({
      color: entry.color,
      playedTo: playedMove && playedMove.to !== undefined ? playedMove.to : null,
      winProbLoss: entry.winProbLoss,
      beforeEval,
      afterEval,
      bestReplay,
      refutationReplay,
    });

    const previous = index > 0 ? rows[index - 1] : null;
    const previousEntry = previous ? derivedByPly.get(Number(previous.ply)) : null;
    const missedPunish =
      previousEntry &&
      previousEntry.color !== selectedColor &&
      Number.isFinite(previousEntry.winProbLoss) &&
      previousEntry.winProbLoss >= 15 &&
      Number.isFinite(entry.winProbLoss) &&
      entry.winProbLoss >= 10;
    if (missedPunish) {
      natureAssessment.motifs.push("missed-punishment");
      natureAssessment.facts.push(
        `The opponent's previous move ${moveNumberLabel(previousEntry.ply, previousEntry.san)} was itself a serious error; this reply gave the advantage back.`,
      );
    }
    const alreadyLosing = Number.isFinite(entry.winProbBefore) && entry.winProbBefore <= 12;
    const decisiveSwing =
      Number.isFinite(entry.winProbBefore) &&
      Number.isFinite(entry.winProbAfter) &&
      entry.winProbBefore >= 40 &&
      entry.winProbAfter <= 20;

    keyMoments.push({
      ply: entry.ply,
      san: entry.san,
      moveLabel: moveNumberLabel(entry.ply, entry.san),
      color: entry.color,
      phase: entry.phase,
      severity: entry.severity || (mateMotif ? "blunder" : null),
      evalBefore: evalTextFromEvaluation(beforeEval),
      evalAfter: evalTextFromEvaluation(afterEval),
      lossCp: Number.isFinite(row.moverLossCp) ? Number(row.moverLossCp) : null,
      winProbBefore: entry.winProbBefore,
      winProbAfter: entry.winProbAfter,
      winProbLoss: entry.winProbLoss,
      bestMoveSan: bestReplay ? bestReplay.sans[0] : playedWasBest ? entry.san : null,
      bestLineSan: bestReplay ? movetextFromSans(bestReplay.sans, entry.ply) : null,
      refutationLineSan: refutationReplay
        ? movetextFromSans(refutationReplay.sans, entry.ply + 1)
        : null,
      natureAssessment,
      openingRelated:
        openingIdentification?.matchedPly != null &&
        entry.ply <= openingIdentification.matchedPly + 2,
      alreadyLosing,
      decisiveSwing,
    });
  }
  keyMoments.sort((left, right) => {
    const leftScore =
      (left.decisiveSwing ? 1000 : 0) + (left.winProbLoss ?? 0) - (left.alreadyLosing ? 500 : 0);
    const rightScore =
      (right.decisiveSwing ? 1000 : 0) + (right.winProbLoss ?? 0) - (right.alreadyLosing ? 500 : 0);
    return rightScore - leftScore || left.ply - right.ply;
  });
  const limitedKeyMoments = keyMoments.slice(0, KEY_MOMENT_LIMIT).sort((a, b) => a.ply - b.ply);

  const playerEntries = perMove.filter((entry) => entry.color === selectedColor);
  const summary = {
    playerColor: selectedColor,
    playerMoveCount: playerEntries.length,
    mistakesByPhase: countByPhase(playerEntries, ["mistake", "blunder"]),
    inaccuraciesByPhase: countByPhase(playerEntries, ["inaccuracy"]),
  };

  return {
    openingIdentification,
    moves: perMove,
    keyMoments: limitedKeyMoments,
    summary,
  };
}

function countByPhase(entries, severities) {
  const counts = { opening: 0, middlegame: 0, endgame: 0 };
  for (const entry of entries) {
    if (severities.includes(entry.severity)) counts[entry.phase] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

export function formatOpeningIdentificationForPrompt(openingIdentification) {
  if (!openingIdentification) {
    return "No named opening position from the reference position table matched this game. Do not force an opening label; classify from the pawn structure and piece placement instead.";
  }
  const lines = [
    `Deepest named opening position actually reached: ${openingIdentification.eco} ${openingIdentification.name} (after ply ${openingIdentification.matchedPly ?? "?"}).`,
    `Reference move order for that named position: ${openingIdentification.bookMovetext}`,
  ];
  if (openingIdentification.gameMovetext) {
    lines.push(`This game's move order to that position: ${openingIdentification.gameMovetext}`);
  }
  if (openingIdentification.transposed === true) {
    lines.push(
      "The game TRANSPOSED into this opening: the position matches exactly, but the move order differs from the reference line. Name and coach the resulting opening family, not the first-move label.",
    );
  } else if (openingIdentification.transposed === false) {
    lines.push("The game followed this exact move order (no transposition).");
  } else {
    lines.push("Move-order comparison was unavailable; the position match itself is exact.");
  }
  if (openingIdentification.leftNamedTheory) {
    lines.push(
      `The game left the named-opening table with ${moveNumberLabel(openingIdentification.leftNamedTheory.ply, openingIdentification.leftNamedTheory.san)} (ply ${openingIdentification.leftNamedTheory.ply}). Leaving the table is not automatically an error; judge it with the engine trace.`,
    );
  }
  lines.push(
    "This exact-position match is a transposition-aware opening-family anchor. The coach may refine it to a compatible sub-variation from later structure and book evidence, but must not replace it with a first-move label.",
  );
  return lines.join("\n");
}

export function formatCoachTraceForPrompt(moveAnalysis, derived) {
  const rawRows = Array.isArray(moveAnalysis) ? moveAnalysis : [];
  const rows = rawRows.filter((row) => row && Number.isInteger(Number(row.ply)));
  if (rows.length === 0) {
    const current = rawRows.find((row) => row?.kind === "current-position");
    if (current) {
      return `Current position evaluation (White-relative): ${evalTextFromEvaluation(current.evaluation)}${current.evaluation?.depth ? ` at depth ${current.evaluation.depth}` : ""} (${current.evaluation?.source || "pc"}).`;
    }
    return "No move-by-move trace was supplied.";
  }
  const derivedByPly = new Map((derived?.moves || []).map((entry) => [entry.ply, entry]));
  const important = new Set(
    (derived?.moves || []).filter((entry) => entry.severity).map((entry) => entry.ply),
  );
  const includeAll = rows.length <= TRACE_MOVE_LIMIT;
  const lines = [
    "Columns: move | played by | eval before -> after (White-relative) | centipawn loss for the mover | mover win-probability before -> after | severity | engine's best move before the move | engine's reply after the move | evaluation source/depth.",
  ];
  let elided = 0;
  for (const [index, row] of rows.entries()) {
    const ply = Number(row.ply);
    const keep = includeAll || index < 30 || index >= rows.length - 20 || important.has(ply);
    if (!keep) {
      elided += 1;
      continue;
    }
    if (elided > 0) {
      lines.push(`(… ${elided} quieter moves elided …)`);
      elided = 0;
    }
    const entry = derivedByPly.get(ply);
    const sourceBefore = row.before
      ? `${row.before.source || "pc"} d${row.before.depth ?? "?"}`
      : "n/a";
    const sourceAfter = row.after
      ? `${row.after.source || "pc"} d${row.after.depth ?? "?"}`
      : "n/a";
    const winProb =
      entry && entry.winProbBefore !== null && entry.winProbAfter !== null
        ? `${entry.winProbBefore}% -> ${entry.winProbAfter}%`
        : "n/a";
    const loss = Number.isFinite(row.moverLossCp) ? `${row.moverLossCp}cp` : "n/a";
    lines.push(
      `${moveNumberLabel(ply, String(row.san || ""))} | ${row.color} | ${evalTextFromEvaluation(row.before)} -> ${evalTextFromEvaluation(row.after)} | loss ${loss} | winprob ${winProb} | ${entry?.severity || "ok"} | best ${entry?.bestMoveSan || "n/a"} | reply ${entry?.replyMoveSan || "n/a"} | ${sourceBefore} -> ${sourceAfter}`,
    );
  }
  if (elided > 0) lines.push(`(… ${elided} quieter moves elided …)`);
  return lines.join("\n");
}

export function formatKeyMomentsForPrompt(derived) {
  const moments = derived?.keyMoments || [];
  if (moments.length === 0) {
    return "No key moments crossed the win-probability thresholds for the reviewed player.";
  }
  const blocks = moments.map((moment) => {
    const lines = [
      `KEY MOMENT — ${moment.moveLabel} by ${moment.color} (${moment.severity || "notable"}, ${moment.phase}${moment.openingRelated ? ", opening-related" : ""}):`,
      `  Eval ${moment.evalBefore} -> ${moment.evalAfter} (mover loss ${moment.lossCp ?? "n/a"}cp; win prob ${moment.winProbBefore ?? "?"}% -> ${moment.winProbAfter ?? "?"}%).`,
    ];
    if (moment.bestLineSan) {
      lines.push(`  Engine-preferred continuation instead: ${moment.bestLineSan}`);
    } else if (moment.bestMoveSan) {
      lines.push(
        `  The played move matched the engine's first choice; the loss came from the position, not this move.`,
      );
    }
    if (moment.refutationLineSan) {
      lines.push(`  Engine's punishing line after the played move: ${moment.refutationLineSan}`);
    }
    const nature = moment.natureAssessment;
    if (nature) {
      lines.push(
        `  Evidence-based nature assessment: ${nature.nature} (confidence ${nature.confidence}${nature.motifs.length ? `; motifs: ${nature.motifs.join(", ")}` : ""}).`,
      );
      for (const fact of nature.facts) lines.push(`  Fact: ${fact}`);
    }
    if (moment.alreadyLosing) {
      lines.push(
        "  Context: the position was already lost before this move; weigh this lesson below decisive moments.",
      );
    }
    if (moment.decisiveSwing) {
      lines.push("  Context: this single move turned a holdable position into a losing one.");
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

export function formatDerivedSummaryForPrompt(derived) {
  const summary = derived?.summary;
  if (!summary) return "";
  const phaseText = (counts) =>
    `opening ${counts.opening}, middlegame ${counts.middlegame}, endgame ${counts.endgame}`;
  return [
    `Reviewed player: ${summary.playerColor} (${summary.playerMoveCount} moves).`,
    `Mistakes/blunders by phase (win-probability based): ${phaseText(summary.mistakesByPhase)}.`,
    `Inaccuracies by phase: ${phaseText(summary.inaccuraciesByPhase)}.`,
    "Phases use a simple deterministic heuristic (ply and remaining material).",
  ].join("\n");
}

// Public JSON view for the analyze-game endpoint so the native coach can reuse
// the same derived evidence without recomputing it.
export function publicDerivedEvidence(derived) {
  if (!derived) return null;
  return {
    openingIdentification: derived.openingIdentification,
    keyMoments: derived.keyMoments,
    moves: derived.moves,
    summary: derived.summary,
  };
}
