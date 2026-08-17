import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import {
  deriveCoachReviewEvidence,
  evalTextFromEvaluation,
  formatCoachTraceForPrompt,
  formatKeyMomentsForPrompt,
  formatOpeningIdentificationForPrompt,
  getOpeningIdentificationBook,
  identifyOpeningFromMoves,
  replayUciLine,
  severityFromWinProbLoss,
  winProbFromWhiteEvaluation,
} from "../chess-coach-derived.mjs";
import {
  buildLibraryPlannerPrompt,
  buildPcCoachAnalysisResult,
  buildCoachPositionRecords,
  buildStructuredPhoneCoachPrompt,
} from "../chess-coach-service.mjs";

const openingBook = getOpeningIdentificationBook("src-tauri/data");

function playGame(sans) {
  const pos = Chess.default();
  const moves = [];
  for (const [index, san] of sans.entries()) {
    const fenBefore = makeFen(pos.toSetup());
    const move = parseSan(pos, san);
    if (!move) throw new Error(`illegal test move ${san}`);
    const uci = makeUci(move);
    pos.play(move);
    moves.push({
      ply: index + 1,
      color: index % 2 === 0 ? "white" : "black",
      san,
      uci,
      fenBefore,
      fenAfter: makeFen(pos.toSetup()),
      annotations: [],
    });
  }
  return moves;
}

function evaluation(overrides) {
  return {
    source: "pc-cloud",
    depth: 22,
    nodes: 1000,
    nps: null,
    terminal: false,
    whiteCp: null,
    whiteMate: null,
    pvUci: [],
    ...overrides,
  };
}

function traceRows(moves, evaluationByPly) {
  return moves.map((move) => {
    const entry = evaluationByPly.get(move.ply) || {};
    return {
      ...move,
      moveNumber: Math.ceil(move.ply / 2),
      before: entry.before || evaluation({ whiteCp: 0 }),
      after: entry.after || evaluation({ whiteCp: 0 }),
      moverLossCp: entry.moverLossCp ?? 0,
      playerLossCp: entry.playerLossCp ?? null,
    };
  });
}

test("openings table identifies transpositions by exact position, not move order", () => {
  assert.ok(openingBook, "src-tauri/data openings TSVs must load");
  const transposed = identifyOpeningFromMoves(
    { moves: playGame(["Nf3", "d5", "d4"]) },
    openingBook,
  );
  assert.equal(transposed.eco, "D02");
  assert.equal(transposed.name, "Queen's Pawn Game: Zukertort Variation");
  assert.equal(transposed.matchedPly, 3);
  assert.equal(transposed.transposed, true);

  const najdorf = identifyOpeningFromMoves(
    { moves: playGame(["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]) },
    openingBook,
  );
  assert.equal(najdorf.eco, "B90");
  assert.equal(najdorf.transposed, false);
  assert.equal(najdorf.matchedPly, 10);

  assert.equal(
    identifyOpeningFromMoves(
      { moves: [{ ply: 1, fenAfter: "not-a-fen", san: "e4", uci: "e2e4" }] },
      openingBook,
    ),
    null,
  );
  assert.match(formatOpeningIdentificationForPrompt(null), /Do not force an opening label/);
  assert.match(formatOpeningIdentificationForPrompt(transposed), /TRANSPOSED/);
});

test("win probability, severity, and eval text follow the documented conventions", () => {
  assert.equal(Math.round(winProbFromWhiteEvaluation({ whiteCp: 0 })), 50);
  assert.equal(Math.round(winProbFromWhiteEvaluation({ whiteCp: 100 }) * 10) / 10, 59.1);
  assert.equal(winProbFromWhiteEvaluation({ whiteMate: 2 }), 100);
  assert.equal(winProbFromWhiteEvaluation({ whiteMate: -2 }), 0);
  assert.equal(winProbFromWhiteEvaluation(null), null);

  assert.equal(severityFromWinProbLoss(9.9), null);
  assert.equal(severityFromWinProbLoss(10), "inaccuracy");
  assert.equal(severityFromWinProbLoss(20), "mistake");
  assert.equal(severityFromWinProbLoss(30), "blunder");

  assert.equal(evalTextFromEvaluation({ whiteCp: -85 }), "-0.85");
  assert.equal(evalTextFromEvaluation({ whiteCp: 40 }), "+0.40");
  assert.equal(evalTextFromEvaluation({ whiteMate: 4 }), "#4");
  assert.equal(evalTextFromEvaluation({ whiteMate: -3 }), "#-3");
});

test("PV replay converts UCI to SAN, tracks material, and truncates at illegal moves", () => {
  const replay = replayUciLine(
    "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
    ["g8f6", "f3g5", "d7d5", "e4d5", "f6d5", "g5f7"],
  );
  assert.deepEqual(replay.sans, ["Nf6", "Ng5", "d5", "exd5", "Nxd5", "Nxf7"]);
  assert.equal(replay.startWhiteBalance, 0);
  assert.equal(replay.endWhiteBalance, 1);

  const truncated = replayUciLine("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", [
    "e2e4",
    "e7e5",
    "a1a8",
  ]);
  assert.deepEqual(truncated.sans, ["e4", "e5"]);
  assert.equal(replayUciLine("garbage", ["e2e4"]), null);
});

test("a hanging piece is classified tactically with the concrete refutation facts", () => {
  const moves = playGame(["e4", "e5", "Nf3", "Nc6", "Nxe5", "Nxe5"]);
  const evaluations = new Map([
    [
      5,
      {
        before: evaluation({ whiteCp: 30, pvUci: ["f1b5", "a7a6"] }),
        after: evaluation({ whiteCp: -260, pvUci: ["c6e5", "d2d4", "e5c6"] }),
        moverLossCp: 290,
        playerLossCp: 290,
      },
    ],
  ]);
  const derived = deriveCoachReviewEvidence({
    moveAnalysis: traceRows(moves, evaluations),
    playerColor: "white",
    scope: "whole-game",
    currentFen: moves.at(-1).fenAfter,
    openingBook,
  });
  const moment = derived.keyMoments.find((entry) => entry.ply === 5);
  assert.ok(moment, "the material-losing move must be a key moment");
  assert.equal(moment.natureAssessment.nature, "tactical");
  assert.equal(moment.natureAssessment.confidence, "high");
  assert.ok(moment.natureAssessment.motifs.includes("capture-of-moved-piece"));
  assert.ok(moment.natureAssessment.motifs.includes("loses-material"));
  assert.match(moment.refutationLineSan, /3\.\.\. Nxe5/);
  assert.match(moment.bestLineSan, /3\. Bb5/);
  assert.ok(
    moment.natureAssessment.facts.some((fact) => fact.includes("captures the knight")),
    "facts must name the hanging piece capture",
  );
});

test("allowing a forced mate is always a tactical key moment with the mating line", () => {
  const moves = playGame(["f3", "e5", "g4", "Qh4#"]);
  const evaluations = new Map([
    [
      3,
      {
        before: evaluation({ whiteCp: -80, pvUci: ["d2d4", "e5d4"] }),
        after: evaluation({ whiteMate: -1, pvUci: ["d8h4"] }),
        moverLossCp: 9920,
        playerLossCp: 9920,
      },
    ],
  ]);
  const derived = deriveCoachReviewEvidence({
    moveAnalysis: traceRows(moves, evaluations),
    playerColor: "white",
    scope: "whole-game",
    currentFen: moves.at(-1).fenAfter,
    openingBook,
  });
  const moment = derived.keyMoments.find((entry) => entry.ply === 3);
  assert.ok(moment);
  assert.equal(moment.natureAssessment.nature, "tactical");
  assert.ok(moment.natureAssessment.motifs.includes("allowed-forced-mate"));
  assert.match(moment.refutationLineSan, /Qh4#/);
});

test("a quiet eval drop with quiet engine lines is classified positionally", () => {
  const moves = playGame(["e4", "e6", "d4", "d5", "e5", "c5", "c3", "Nc6", "Nf3", "c4"]);
  const evaluations = new Map([
    [
      10,
      {
        before: evaluation({ whiteCp: -10, pvUci: ["c5d4", "c3d4", "g8e7"] }),
        after: evaluation({ whiteCp: 85, pvUci: ["f1e2", "g8e7", "e1g1"] }),
        moverLossCp: 95,
        playerLossCp: 95,
      },
    ],
  ]);
  const derived = deriveCoachReviewEvidence({
    moveAnalysis: traceRows(moves, evaluations),
    playerColor: "black",
    scope: "whole-game",
    currentFen: moves.at(-1).fenAfter,
    openingBook,
  });
  const moment = derived.keyMoments.find((entry) => entry.ply === 10);
  assert.ok(moment, "the positional concession must be a key moment");
  assert.equal(moment.natureAssessment.nature, "positional");
  assert.equal(moment.natureAssessment.confidence, "medium");
  assert.ok(
    moment.natureAssessment.facts.some((fact) => fact.includes("inspect the structure")),
    "positional classification must direct the coach to the non-tactical costs",
  );
});

test("ignoring a winning capture is flagged as a missed material win", () => {
  const moves = playGame(["e4", "e5", "Qh5", "g6", "Nf3"]);
  const evaluations = new Map([
    [
      5,
      {
        before: evaluation({ whiteCp: 350, pvUci: ["h5e5", "d8e7", "e5h8"] }),
        after: evaluation({ whiteCp: 30, pvUci: ["g8f6"] }),
        moverLossCp: 320,
        playerLossCp: 320,
      },
    ],
  ]);
  const derived = deriveCoachReviewEvidence({
    moveAnalysis: traceRows(moves, evaluations),
    playerColor: "white",
    scope: "whole-game",
    currentFen: moves.at(-1).fenAfter,
    openingBook,
  });
  const moment = derived.keyMoments.find((entry) => entry.ply === 5);
  assert.ok(moment);
  assert.equal(moment.natureAssessment.nature, "tactical");
  assert.ok(moment.natureAssessment.motifs.includes("missed-material-win"));
  assert.match(moment.bestLineSan, /3\. Qxe5\+ Qe7 4\. Qxh8/);
});

test("critical moments rank decisive swings above noise in already-lost positions", () => {
  const moves = playGame(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6"]);
  const evaluations = new Map();
  const positions = buildCoachPositionRecords({
    moves,
    scope: "whole-game",
    currentFen: moves.at(-1).fenAfter,
  });
  const evalByKey = new Map();
  const setPositionEval = (fen, entry) => {
    evalByKey.set(fen.split(/\s+/).slice(0, 4).join(" "), evaluation(entry));
  };
  // Neutral fill for every position, then two white mistakes:
  for (const position of positions) evalByKey.set(position.key, evaluation({ whiteCp: 0 }));
  // Ply 3 (2.Nf3 here): a 150cp drop from equal — decisive, winprob 50% -> ~31%.
  setPositionEval(moves[2].fenBefore, { whiteCp: 0, pvUci: ["b1c3"] });
  setPositionEval(moves[2].fenAfter, { whiteCp: -150, pvUci: ["b8c6"] });
  // Ply 7 (4.d3 here): a 400cp further collapse in a lost position (-800 -> -1200).
  setPositionEval(moves[6].fenBefore, { whiteCp: -800, pvUci: ["b1c3"] });
  setPositionEval(moves[6].fenAfter, { whiteCp: -1200, pvUci: ["b8a5"] });
  // Positions are shared between consecutive moves, so rebuild coherent rows:
  for (const position of positions) {
    evaluations.set(position.key, evalByKey.get(position.key));
  }
  const result = buildPcCoachAnalysisResult({
    scope: "whole-game",
    currentFen: moves.at(-1).fenAfter,
    moves,
    positions,
    evaluations,
    playerColor: "white",
    cloudHits: positions.length,
    liveAnalyses: 0,
    liveDepth: 18,
    openingBook,
  });
  const [first] = result.criticalMoments;
  assert.equal(
    first.ply,
    3,
    "the 150cp decisive swing must outrank the 400cp collapse in a lost position",
  );
  assert.ok(first.winProbLoss > (result.criticalMoments[1]?.winProbLoss ?? 0));
  assert.ok(result.derived, "analysis result must carry derived evidence");
});

test("both phone prompts carry the deterministic evidence sections and rules", () => {
  const moves = playGame(["Nf3", "d5", "d4"]);
  const evaluations = new Map([
    [
      3,
      {
        before: evaluation({ whiteCp: 20, pvUci: ["d2d4", "g8f6"] }),
        after: evaluation({ whiteCp: 25, pvUci: ["g8f6"] }),
        moverLossCp: -5,
      },
    ],
  ]);
  const rows = traceRows(moves, evaluations);
  const derived = deriveCoachReviewEvidence({
    moveAnalysis: rows,
    playerColor: "white",
    scope: "whole-game",
    currentFen: moves.at(-1).fenAfter,
    openingBook,
  });
  const plannerPrompt = buildLibraryPlannerPrompt({
    question: "Review the opening",
    pgn: "1. Nf3 d5 2. d4",
    playerColor: "white",
    scope: "whole-game",
    currentFen: moves.at(-1).fenAfter,
    moveAnalysis: rows,
    inventory: { books: [], chapters: [] },
    exactOpeningMatches: [],
    derivedEvidence: derived,
  });
  assert.match(plannerPrompt, /Exact-position opening-family anchor/);
  assert.match(plannerPrompt, /Queen's Pawn Game: Zukertort Variation/);
  assert.match(plannerPrompt, /TRANSPOSED/);
  assert.match(plannerPrompt, /evidence-based tactical\/positional\/mixed assessment/);
  assert.match(plannerPrompt, /2\.d4 \| white \| \+0\.20 -> \+0\.25/);

  const structuredPrompt = buildStructuredPhoneCoachPrompt({
    question: "Review",
    pgn: "1. Nf3 d5 2. d4",
    playerColor: "white",
    currentFen: moves.at(-1).fenAfter,
    scope: "whole-game",
    moveAnalysis: rows,
    analysisCoverage: { totalPositions: 4, cloudHits: 4, liveAnalyses: 0 },
    libraryPlan: {
      overview: "test",
      openingClassification: {
        relevant: true,
        initialMoveOrder: "1.Nf3",
        resultingFamily: "Queen's Pawn Game",
        classificationPly: 3,
        transposition: true,
        explanation: "d4/c4 centre",
      },
      categories: [
        {
          id: "opening",
          label: "Opening",
          reason: "Transposition awareness",
          keyPlies: [3],
          bookIds: [],
          chapterIds: [],
          searchQueries: ["queen's pawn"],
        },
      ],
    },
    bookPassages: [],
    categoryPassageIds: { opening: [] },
    derivedEvidence: derived,
    exactOpeningMatches: [],
  });
  assert.match(structuredPrompt, /Exact-position opening-family anchor/);
  assert.match(structuredPrompt, /controls the family actually reached/);
  assert.match(structuredPrompt, /explain a tactical mistake tactically/i);
  assert.match(structuredPrompt, /name the structural or planning cost/);
  assert.match(structuredPrompt, /Exact position matches in indexed opening-book lines/);
  assert.match(structuredPrompt, /anchor every lesson to this game's exact squares/);
  assert.match(formatCoachTraceForPrompt(rows, derived), /\| best d4 \| reply Nf6 \|/);
});

test("the compact trace elides quiet middles of very long games but keeps tagged moves", () => {
  const rows = [];
  for (let ply = 1; ply <= 300; ply += 1) {
    rows.push({
      ply,
      color: ply % 2 === 1 ? "white" : "black",
      san: ply % 2 === 1 ? "Nf3" : "Nf6",
      uci: "",
      fenBefore: `fake-${ply} w - - 0 1`,
      fenAfter: `fake-${ply + 1} b - - 0 1`,
      before: evaluation({ whiteCp: 0 }),
      after: evaluation({ whiteCp: 0 }),
      moverLossCp: 0,
      playerLossCp: null,
    });
  }
  const text = formatCoachTraceForPrompt(rows, { moves: [] });
  assert.match(text, /quieter moves elided/);
  assert.ok(text.split("\n").length < 120);
  assert.match(formatKeyMomentsForPrompt(null), /No key moments crossed/);
});
