import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { SharedReviewService, engineLine, BackgroundEngine } from "../generated/shared-review-service.js";
import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { matingEntryDefence } from "../../src/utils/tests/fixtures/matingEntryDefence.ts";

const pgn = '[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.04"]\n\n1. f3 e5 2. g4 Qh4# 0-1';

test("a verified mating-entry defence survives generated review, deck storage and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-mate-defence-"));
  const input = matingEntryDefence;
  const position = Chess.fromSetup(parseFen(input.fen).unwrap()).unwrap();
  position.play(parseUci(input.playedMoveUci));
  const after = makeFen(position.toSetup());
  let service;
  const options = { root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async fen => {
      assert.ok(fen === input.fen || fen === after);
      return {depth: 16, pvs: fen === input.fen
        ? [{cp: -400, moves: input.pvUci.join(" ")}]
        // Stored/cloud scores are White-relative, unlike raw UCI replies.
        : [{mate: -4, moves: input.refutationUci.join(" ")}]};
    }};
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({accounts: {chesscom: "Tester"}}));
    await writeFile(join(root, "games.json"), JSON.stringify({games: [{source: "chesscom", end: 1789387200,
      url: "https://example.test/mate-defence", pgn: `[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${input.fen}"]\n[Result "0-1"]\n\n1. f4 0-1`}]}));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error, null);
    const card = service.snapshot().cards[0]; assert.ok(card);
    const motif = card.tacticalClassification.allowedMotifs[0];
    assert.equal(motif.id, "mateIn4"); assert.equal(motif.comparison, "prevented");
    assert.match(motif.comparisonEvidence, /Nxe2/);
    assert.match(motif.comparisonEvidence, /longer or different attacks/);
    assert.match(card.explanation, /captures the piece/);
    const metadata = (await service.deck()).positions[0].mistakeReview;
    assert.deepEqual(metadata.allowedMotifs, card.tacticalClassification.allowedMotifs);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification, card.tacticalClassification);
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-mate-defence-"));
    await rm(target, {recursive: true, force: true});
  }
});

test("complete history survives the actual generated background service, saved deck and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-history-"));
  const moves = ["e2e4", "e7e5", "g1f3", "b8c6", "a2a3", "g8f6", "f1c4", "f8e7", "d2d3"];
  const position = Chess.fromSetup(parseFen(INITIAL_FEN).unwrap()).unwrap();
  const lines = new Map();
  for (const [index, uci] of moves.entries()) {
    lines.set(makeFen(position.toSetup()), {depth:16,pvs:[{cp:index===7?-150:0,moves:index===7?"f6e4":uci}]});
    const move = parseUci(uci); assert.ok(move && position.isLegal(move)); position.play(move);
  }
  const options = {root, documentsRoot:join(root,"documents"), engineConfigPath:join(root,"engine.json"),
    fetchGames:async()=>[], lookup:async(fen)=>{assert.ok(lines.has(fen));return lines.get(fen);}};
  let service;
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,url:"https://example.test/history",
      pgn:'[White "Opponent"]\n[Black "Tester"]\n[Date "2026.09.16"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. a3 Nf6 4. Bc4 Be7 5. d3 1-0'}]}));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error,null);
    const cards = service.snapshot().cards; assert.equal(cards.length,1);
    assert.match(cards[0].explanation,/Hanging Pawn/);
    const history = {fen:INITIAL_FEN,moves:moves.slice(0,7)};
    assert.deepEqual(cards[0].tacticalHistory,history);
    assert.deepEqual((await service.deck()).positions[0].mistakeReview.tacticalHistory,history);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalHistory,history);
    assert.deepEqual((await service.deck()).positions[0].mistakeReview.tacticalHistory,history);
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("a compensated missed capture survives shared-review storage with its actual local bound", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-compensated-"));
  const fen = "r5k1/p5pp/5p2/3n2B1/8/2N2N2/P5PP/R5K1 w - - 0 1";
  const after = "r5k1/p5pp/5p2/3n2B1/4N3/5N2/P5PP/R5K1 b - - 1 1";
  const options = {root, documentsRoot:join(root,"documents"), engineConfigPath:join(root,"engine.json"),
    fetchGames:async()=>[], lookup:async(board)=>{
      assert.ok(board === fen || board === after);
      // Synthetic nomination scores exercise persistence, not chess strength.
      return {depth:16,pvs:board===fen ? [{cp:150,moves:"c3d5 f6g5 f3g5"}] : [{cp:0,moves:"d5e7"}]};
    }};
  let service;
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,url:"https://example.test/compensated",
      pgn:`[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "0-1"]\n\n1. Ne4 0-1`}]}));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error,null);
    const card = service.snapshot().cards[0]; assert.ok(card);
    assert.match(card.explanation,/Material Gain/); assert.match(card.explanation,/0.9 pawns/);
    assert.equal(card.tacticalClassification.missedMotifs[0].value,90);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification,card.tacticalClassification);
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("new pawn exposure retains the preceding board through background review and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-pawn-"));
  const previous = "r5k1/p3p1pp/8/8/3P4/8/P5PP/R5K1 b - - 0 1";
  const fen = "r5k1/p5pp/8/4p3/3P4/8/P5PP/R5K1 w - - 0 2";
  const after = "r5k1/p5pp/8/4p3/3P4/8/P5PP/1R4K1 b - - 1 2";
  const options = {root, documentsRoot:join(root,"documents"), engineConfigPath:join(root,"engine.json"),
    fetchGames:async()=>[], lookup:async(board)=>{
      assert.ok(board === fen || board === after);
      return {depth:16,pvs:board===fen ? [{cp:150,moves:"d4e5"}] : [{cp:0,moves:"e5d4"}]};
    }};
  let service;
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,url:"https://example.test/pawn",
      pgn:`[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${previous}"]\n[Result "0-1"]\n\n1... e5 2. Rb1 0-1`}]}));
    service=new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error,null);
    const card=service.snapshot().cards[0]; assert.ok(card);
    assert.match(card.explanation,/Hanging Pawn/);
    assert.equal(card.previousFen,previous); assert.equal(card.previousMoveUci,"e7e5");
    const metadata=(await service.deck()).positions[0].mistakeReview;
    assert.equal(metadata.previousFen,previous); assert.equal(metadata.previousMoveUci,"e7e5");
    service.close(); service=new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification,card.tacticalClassification);
  } finally {
    service?.close(); const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("explicit local candidate upgrade reuses cache identity and never repeats cloud lookup", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-candidate-cache-"));
  const fen = "4kb2/8/8/4q3/4P3/NPPP1P2/P7/R2QK3 b Q - 1 1";
  let lookups = 0, searches = 0;
  const service = new SharedReviewService({root, documentsRoot:join(root,"documents"),
    engineConfigPath:join(root,"engine.json"), fetchGames:async()=>[],
    lookup:async()=>{ lookups++; return {depth:16,pvs:[{cp:-200,moves:"e5c3"}]}; }});
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await service.initialize(false);
    await service.evaluate(fen);
    // Without a configured engine the usable legacy line remains available.
    await service.evaluate(fen,true,true); assert.equal(lookups,1);
    service.enginePath = "test-only-fake-engine";
    service.engine = {close(){}, async analyze(board, width){
      searches++; assert.equal(board,fen); assert.equal(width,3);
      // Fewer returned lines must not cause repeated upgrades after a completed request.
      return {...engineLine(fen,16,{type:"cp",value:-200},["e5c3"]),
        tacticalCandidatesRequested:3,tacticalCandidates:[{fen,cp:200,depth:16,pvUci:["e5c3"]}]};
    }};
    await service.evaluate(fen,true); assert.equal(searches,0);
    const upgraded = await service.evaluate(fen,true,true);
    assert.equal(upgraded.tacticalCandidatesRequested,3);
    await service.evaluate(fen,true,true); await service.evaluate(fen);
    assert.equal(searches,1); assert.equal(lookups,1);
  } finally {
    service.close(); const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("missed alternative survives background selection, shared desktop deck and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-missed-alternative-"));
  const fen = "4kb2/8/8/4q3/4P3/NPPP1P2/P7/R2QK3 b Q - 1 1";
  const options = {root, documentsRoot:join(root,"documents"), engineConfigPath:join(root,"engine.json"),
    fetchGames:async()=>[], lookup:async(board)=>({depth:16,pvs:board===fen
      ? [{cp:-200,moves:"e5c3"},{cp:-160,moves:"f8a3"}] : [{cp:0,moves:"d3d4"}]})};
  let service;
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,url:"https://example.test/missed-alternative",
      pgn:`[White "Opponent"]\n[Black "Tester"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "0-1"]\n\n1... Kf7 0-1`}]}));
    service=new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error,null);
    const card=service.snapshot().cards[0]; assert.ok(card);
    assert.match(card.explanation,/Another stronger move.*Bxa3/);
    assert.equal(card.best,"e5c3"); assert.equal(card.bestCandidates[1].cp,160);
    assert.equal(card.tacticalClassification.missedMotifs[0].alternativeLine.uci[0],"f8a3");
    const metadata=(await service.deck()).positions[0].mistakeReview;
    assert.deepEqual(metadata.bestCandidates,card.bestCandidates);
    assert.ok(!metadata.missedTimeline.some(m=>m.alternativeLine));
    service.close(); service=new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification,card.tacticalClassification);
  } finally {
    service?.close(); const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("real background engine retains rank one and three side-correct candidates", {skip:!process.env.TACTICAL_JUDGEMENT_ENGINE}, async()=>{
  const engine=new BackgroundEngine(process.env.TACTICAL_JUDGEMENT_ENGINE);
  try {
    for(const fen of ["4kb2/8/8/4q3/4P3/1PPP1P2/P7/RN1QK3 w Q - 0 1","4kb2/8/8/4q3/4P3/NPPP1P2/P7/R2QK3 b Q - 1 1"]){
      const line=await engine.analyze(fen,3);
      assert.equal(line.depth,16); assert.equal(line.multipv,1);
      assert.equal(line.tacticalCandidates.length,3);
      assert.deepEqual(line.tacticalCandidates[0].pvUci,line.uciMoves);
      assert.equal(line.tacticalCandidates[0].cp,line.score.value*(fen.split(" ")[1]==="b"?-1:1));
      for(const candidate of line.tacticalCandidates){
        assert.equal(candidate.fen,fen);assert.equal(candidate.depth,16);
        assert.equal(engineLine(fen,16,{type:"cp",value:0},candidate.pvUci).uciMoves.length,candidate.pvUci.length);
      }
    }
  } finally {engine.close();}
});

test("separate capture cause survives same-search candidates, shared deck and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-alternative-"));
  const fen = "4kb2/8/8/4q3/4P3/1PPP1P2/P7/RN1QK3 w Q - 0 1";
  const after = "4kb2/8/8/4q3/4P3/NPPP1P2/P7/R2QK3 b Q - 1 1";
  // Constructed board; scores exercise nomination, not an engine-strength claim.
  const options = {root, documentsRoot:join(root,"documents"), engineConfigPath:join(root,"engine.json"),
    fetchGames:async()=>[], lookup:async(board)=>{
      assert.ok(board===fen || board===after);
      return {depth:16,pvs:board===fen ? [{cp:-320,moves:"b1d2"}] : [{cp:-640,moves:"e5c3"},{cp:-600,moves:"f8a3"}]};
    }};
  let service;
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,url:"https://example.test/alternative",
      pgn:`[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "0-1"]\n\n1. Na3 0-1`}]}));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error,null);
    const card=service.snapshot().cards[0];
    assert.ok(card); assert.match(card.explanation,/Bxa3 wins the loose knight/);
    assert.equal(card.alternativeReply.moveUci,"f8a3");
    assert.equal(card.refutationCandidates[1].cp,600);
    assert.equal(card.refutationUci[0],"e5c3");
    assert.ok(!card.refutationTimeline.some(m=>m.alternativeLine));
    const review=(await service.deck()).positions[0].mistakeReview;
    assert.equal(review.allowedMotifs[0].alternativeLine.fen,after);
    assert.deepEqual(review.refutationCandidates,card.refutationCandidates);
    service.close(); service=new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].alternativeReply,card.alternativeReply);
  } finally {
    service?.close(); const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("comparable capture qualifications survive the built service, shared deck and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-capture-choice-"));
  const evidence = JSON.parse(
    await readFile(
      new URL(
        "../../benchmarks/tactical-relevance/quiet-game-context-stockfish-18.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const before = evidence.searches.find((s) => s.id === "context:C9q6jvtW:ply41:best");
  const after = evidence.searches.find((s) => s.id === "context:C9q6jvtW:ply41:reply");
  assert.ok(before && after);
  const options = {
    root,
    documentsRoot: join(root, "documents"),
    engineConfigPath: join(root, "engine.json"),
    lookup: async (fen) => {
      const row = [before, after].find((r) => r.fen === fen);
      assert.ok(row, `Unexpected position: ${fen}`);
      return {
        depth: 16,
        pvs: row.lines.map((line) => ({
          cp: line.cp * (fen.split(" ")[1] === "b" ? -1 : 1),
          moves: line.pvUci.join(" "),
        })),
      };
    },
    fetchGames: async () => [],
  };
  let service;
  try {
    await writeFile(
      join(root, "config.json"),
      JSON.stringify({ accounts: { chesscom: "Tester" } }),
    );
    const game = `[White "Opponent"]\n[Black "Tester"]\n[Date "2026.09.14"]\n[SetUp "1"]\n[FEN "${before.fen}"]\n[Result "1-0"]\n\n21... fxg4 1-0`;
    await writeFile(
      join(root, "games.json"),
      JSON.stringify({
        games: [
          {
            source: "chesscom",
            pgn: game,
            end: 1789387200,
            url: "https://example.test/game/capture-choice",
          },
        ],
      }),
    );
    service = new SharedReviewService(options);
    await service.initialize(false);
    await service.run();
    assert.equal(service.snapshot().error, null);
    assert.equal(service.snapshot().cards.length, 1);
    const card = service.snapshot().cards[0];
    assert.match(card.explanation, /^Capture in the better line:/);
    assert.match(card.explanation, /not a verified explanation/);
    assert.equal(card.bestTimeline[0].alternativeCapture, true);
    assert.equal((await service.deck()).positions[0].reason, card.explanation);
    service.close();
    service = new SharedReviewService(options);
    await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].bestTimeline, card.bestTimeline);
    assert.equal((await service.deck()).positions[0].reason, card.explanation);
  } finally {
    service?.close();
    const target = resolve(root);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep) &&
        target.includes("en-shared-review-capture-choice-"),
    );
    await rm(target, { recursive: true, force: true });
  }
});

test("built review service publishes and reloads the constructive fork-preparation cause", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-acceptance-"));
  const evidence = JSON.parse(
    await readFile(
      new URL(
        "../../benchmarks/tactical-relevance/capture-acceptance-stockfish-18.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const before = evidence.searches.find((s) => s.kind === "choice" && s.move === "f1f4");
  const after = evidence.searches.find((s) => s.kind === "reached" && s.move === "f1f2");
  assert.ok(before && after);
  const options = {
    root,
    documentsRoot: join(root, "documents"),
    engineConfigPath: join(root, "engine.json"),
    lookup: async (fen) => {
      const row = [before, after].find((r) => r.fen === fen);
      assert.ok(row, `Unexpected position: ${fen}`);
      const line = row.lines[0];
      return {
        depth: line.depth,
        pvs: [{ cp: line.cp * (fen.split(" ")[1] === "b" ? -1 : 1), moves: line.pvUci.join(" ") }],
      };
    },
    fetchGames: async () => [],
  };
  let service;
  try {
    await writeFile(
      join(root, "config.json"),
      JSON.stringify({ accounts: { chesscom: "Tester" } }),
    );
    const game = `[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.09"]\n[SetUp "1"]\n[FEN "${before.fen}"]\n[Result "0-1"]\n\n1. Rf2 Rxh4+ 0-1`;
    await writeFile(
      join(root, "games.json"),
      JSON.stringify({
        games: [
          {
            source: "chesscom",
            pgn: game,
            end: 1788912000,
            url: "https://example.test/game/capture-acceptance",
          },
        ],
      }),
    );
    service = new SharedReviewService(options);
    await service.initialize(false);
    await service.run();
    assert.equal(service.snapshot().error, null);
    assert.equal(service.snapshot().cards.length, 1);
    const deck = await service.deck();
    const card = service.snapshot().cards[0];
    const preparation = card.refutationTimeline.find((m) => m.id === "forkPreparation");
    assert.equal(preparation.comparison, "prevented");
    assert.match(preparation.comparisonEvidence, /After Rf4, gxh4/);
    assert.match(card.explanation, /After Rf4, gxh4/);
    // The shared deck publishes this text as reason; desktop motif metadata
    // is populated lazily on reveal rather than stored by this producer.
    assert.equal(deck.positions[0].reason, card.explanation);
    service.close();
    service = new SharedReviewService(options);
    await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].refutationTimeline, card.refutationTimeline);
    assert.equal((await service.deck()).positions[0].reason, card.explanation);
  } finally {
    service?.close();
    const target = resolve(root);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-acceptance-"),
    );
    await rm(target, { recursive: true, force: true });
  }
});

test("archived games become shared cards without rewriting analysis; progress survives retries and restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-"));
  let service;
  let lookups = 0;
  const options = {
    root,
    documentsRoot: join(root, "documents"),
    engineConfigPath: join(root, "engine.json"),
    lookup: async (fen) => {
      lookups++;
      const black = fen.split(" ")[1] === "b";
      return {
        depth: 18,
        pvs: [
          {
            cp: black ? -400 : 50,
            moves: black ? (fen.includes("4p3") ? "d8h4" : "e7e5") : "e2e4",
          },
        ],
      };
    },
    fetchGames: async () => [],
  };
  try {
    await writeFile(
      join(root, "config.json"),
      "\uFEFF" + JSON.stringify({ accounts: { chesscom: "Tester" } }),
    );
    const original = JSON.stringify({
      entries: [{ key: "existing-deep-analysis", stats: { accuracy: 87 } }],
    });
    await writeFile(join(root, "entries.json"), original);
    await writeFile(
      join(root, "games.json"),
      JSON.stringify({
        games: [{ source: "chesscom", pgn, end: 1788550000, url: "https://example.test/game/1" }],
      }),
    );
    service = new SharedReviewService(options);
    await service.initialize(false);
    await service.run();
    const ready = service.snapshot();
    assert.equal(ready.error, null);
    assert.equal(ready.savedAnalysisSummaries, 1);
    assert.equal(ready.reviewedGames, 1);
    assert.equal(ready.cards.length, 1);
    assert.equal(await readFile(join(root, "entries.json"), "utf8"), original);
    const id = ready.cards[0].id;
    const staleDeck = await service.deck();
    await service.grade(id, "good", 0);
    await service.grade(id, "good", 0);
    assert.equal(service.snapshot().cards[0].reviews, 1);
    await service.saveDeck(staleDeck);
    assert.equal(service.snapshot().cards[0].reviews, 1);
    const count = lookups;
    await service.run();
    assert.equal(lookups, count);
    assert.equal(service.snapshot().cards.length, 1);
    service.close();
    service = new SharedReviewService(options);
    await service.initialize(false);
    assert.equal(service.snapshot().cards[0].reviews, 1);
    const desktop = await service.deck();
    desktop.positions[0].card.last_review = new Date(Date.now() + 1000).toISOString();
    desktop.positions[0].card.due = new Date(Date.now() + 86400000).toISOString();
    desktop.positions[0].card.reps = 2;
    desktop.positions[0].comment = "My saved note";
    await service.saveDeck(desktop);
    assert.equal(service.snapshot().cards[0].reviews, 2);
    assert.equal((await service.deck()).positions[0].comment, "My saved note");
    await service.grade(id, "hide", 2);
    assert.ok(new Date((await service.deck()).positions[0].card.due).getFullYear() === 9999);
    assert.equal(service.snapshot().cards[0].hidden, true);
  } finally {
    service?.close();
    const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-"));
    await rm(target, { recursive: true, force: true });
  }
});

test("PV conversion verifies moves against their actual position", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const line = engineLine(fen, 16, { type: "cp", value: 30 }, ["e2e4", "e7e5", "e2e3"]);
  assert.deepEqual(line.uciMoves, ["e2e4", "e7e5"]);
  assert.deepEqual(line.sanMoves, ["e4", "e5"]);
});
