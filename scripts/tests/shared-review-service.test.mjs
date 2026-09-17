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
import { checkingForkCaptureFen } from "../../src/utils/tests/fixtures/checkingForkCaptureDefence.ts";
import { shortMatingThreatCases } from "../../src/utils/tests/fixtures/shortMatingThreat.ts";
import { matingCheckEvasionFen, matingCheckEvasionLine } from "../../src/utils/tests/fixtures/matingCheckEvasion.ts";
import { kingDefenderRemovalCases } from "../../src/utils/tests/fixtures/kingDefenderRemoval.ts";
import { forkCountercaptureFen, forkCountercaptureLine } from "../../src/utils/tests/fixtures/forkCountercapture.ts";
import { captureMateFen } from "../../src/utils/tests/fixtures/captureMate.ts";
import { missedPromotionFen } from "../../src/utils/tests/fixtures/immediatePromotion.ts";
import { promotionCheckFen, promotionCheckMove, quietMatingFinish } from "../../src/utils/tests/fixtures/promotionCheckRetention.ts";

const pgn = '[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.04"]\n\n1. f3 e5 2. g4 Qh4# 0-1';

test("a missed fork retains only the initial pawn through saved review and reload",async()=>{
  const root=await mkdtemp(join(tmpdir(),"en-shared-review-fork-retention-"));
  // Constructed a6 variant. These controlled scores test wiring, not chess strength.
  const fen="2kr1bnr/1qp1pppp/pp6/n2pN3/3P2P1/Q1NPP2P/PP1B1P2/R3K2R w KQ - 0 1";
  const pos=Chess.fromSetup(parseFen(fen).unwrap()).unwrap();pos.play(parseUci("a1c1"));
  const after=makeFen(pos.toSetup());
  const options={root,documentsRoot:join(root,"documents"),engineConfigPath:join(root,"engine.json"),
    fetchGames:async()=>[],lookup:async requested=>{
      assert.ok(requested===fen||requested===after);
      return {depth:18,pvs:requested===fen?[{cp:400,moves:"e5f7"}]:[{cp:50,moves:"e7e6"}]};
    }};
  let service;
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,
      url:"https://example.test/fork-retention",pgn:`[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.17"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "1-0"]\n\n1. Rc1 1-0`}]}));
    service=new SharedReviewService(options);await service.initialize(false);await service.run();
    assert.equal(service.snapshot().error,null);const card=service.snapshot().cards[0];assert.ok(card);
    assert.equal(card.tacticalClassification.missedMotifs[0].id,"fork");
    assert.equal(card.tacticalClassification.missedMotifs[0].value,100);
    assert.match(card.explanation,/forks the rook on d8 and rook on h8/);
    service.close();service=new SharedReviewService(options);await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification,JSON.parse(JSON.stringify(card.tacticalClassification)));
    assert.equal((await service.deck()).positions[0].reason,card.explanation);
  } finally {
    service?.close();const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-fork-retention-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("a missed discovery survives generated review and saved deck reload",async()=>{
  const root=await mkdtemp(join(tmpdir(),"en-shared-review-discovery-recapture-"));
  // Constructed fixture, not an owner game. Scores deliberately test wiring.
  const fen="2kr1b1r/pppbqp2/2n2npp/3pp2P/B2PP3/7N/PPP1NPP1/R1BQK2R b KQ - 1 1";
  const pos=Chess.fromSetup(parseFen(fen).unwrap()).unwrap();pos.play(parseUci("c8b8"));
  const after=makeFen(pos.toSetup());
  const options={root,documentsRoot:join(root,"documents"),engineConfigPath:join(root,"engine.json"),
    fetchGames:async()=>[],lookup:async requested=>{
      assert.ok(requested===fen||requested===after);
      return {depth:18,pvs:requested===fen?[{cp:-300,moves:"c6d4"}]:[{cp:50,moves:"e1g1"}]};
    }};
  let service;
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,
      url:"https://example.test/discovery-recapture",pgn:`[White "Opponent"]\n[Black "Tester"]\n[Date "2026.09.17"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "0-1"]\n\n1... Kb8 0-1`}]}));
    service=new SharedReviewService(options);await service.initialize(false);await service.run();
    assert.equal(service.snapshot().error,null);const card=service.snapshot().cards[0];assert.ok(card);
    assert.equal(card.tacticalClassification.missedMotifs[0].id,"discoveredAttack");
    assert.equal(card.tacticalClassification.missedMotifs[0].value,100);
    assert.match(card.explanation,/uncovering the bishop on d7 against the bishop on a4/);
    service.close();service=new SharedReviewService(options);await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification,JSON.parse(JSON.stringify(card.tacticalClassification)));
    assert.equal((await service.deck()).positions[0].reason,card.explanation);
  } finally {
    service?.close();const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-discovery-recapture-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("a missed pawn counterattack retains preceding-move context in generated saved review",async()=>{
  const root=await mkdtemp(join(tmpdir(),"en-shared-review-liability-capture-"));
  const initial="r2qkb1r/pppb1ppp/2n2n2/1B1pp3/3PP3/P1N2N2/1PP2PPP/R1BQK2R w KQkq - 0 1";
  const pos=Chess.fromSetup(parseFen(initial).unwrap()).unwrap();pos.play(parseUci("f3g5"));
  const fen=makeFen(pos.toSetup());pos.play(parseUci("d8e7"));const after=makeFen(pos.toSetup());
  const options={root,documentsRoot:join(root,"documents"),engineConfigPath:join(root,"engine.json"),
    fetchGames:async()=>[],lookup:async requested=>{
      assert.ok(requested===fen||requested===after);
      // Controlled White-perspective scores test wiring, not chess strength.
      return {depth:16,pvs:requested===fen?[{cp:-190,moves:"c6d4"}]:[{cp:20,moves:"e4d5"}]};
    }};
  let service;
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,
      url:"https://example.test/liability-capture",pgn:`[White "Opponent"]\n[Black "Tester"]\n[Date "2026.09.17"]\n[SetUp "1"]\n[FEN "${initial}"]\n[Result "0-1"]\n\n1. Ng5 Qe7 0-1`}]}));
    service=new SharedReviewService(options);await service.initialize(false);await service.run();
    assert.equal(service.snapshot().error,null);const card=service.snapshot().cards[0];assert.ok(card);
    assert.equal(card.tacticalClassification.missedMotifs[0].label,"Material Gain");
    assert.equal(card.tacticalClassification.missedMotifs[0].value,100);
    assert.match(card.explanation,/counterattack on the bishop on b5/);
    service.close();service=new SharedReviewService(options);await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification,JSON.parse(JSON.stringify(card.tacticalClassification)));
    assert.equal((await service.deck()).positions[0].reason,card.explanation);
  } finally {
    service?.close();const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-liability-capture-"));
    await rm(target,{recursive:true,force:true});
  }
});

for (const row of [
  {id:"immediate",fen:missedPromotionFen,played:"h1g1",best:"a7a8q",reply:"b5a7",gain:800,
    beforeCp:800,afterCp:300,white:"Tester",black:"Opponent",san:"1. Kg1"},
  // Constructed missed choice at the real promotion root. Rd3 is winning, but
  // the separate engine audit finds the stronger Re7+ mate after Rh6.
  {id:"continuing checks",fen:promotionCheckFen,played:"f6h6",best:promotionCheckMove,reply:"g3d3",gain:300,
    beforeCp:-51,afterCp:609,white:"Opponent",black:"Tester",san:"37... Rh6"},
  {id:"mate-first continuing checks",fen:promotionCheckFen,played:"f6h6",best:promotionCheckMove,
    reply:quietMatingFinish.refutationUci.join(" "),gain:300,beforeCp:-51,afterMate:5,
    white:"Opponent",black:"Tester",san:"37... Rh6"},
]) test(`a missed ${row.id} promotion survives generated review and saved deck reload`, async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-promotion-"));
  const fen = row.fen;
  const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap(); position.play(parseUci(row.played));
  const after = makeFen(position.toSetup());
  const options = { root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async requested => {
      assert.ok(requested === fen || requested === after);
      // Controlled scores check wiring; separate engine searches judge chess.
      return { depth: 16, pvs: requested === fen ? [{ cp: row.beforeCp, moves: row.best }] : [{ ...(row.afterMate?{mate:row.afterMate}:{cp:row.afterCp}), moves: row.reply }] };
    } };
  let service;
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({ accounts: { chesscom: "Tester" } }));
    await writeFile(join(root, "games.json"), JSON.stringify({ games: [{ source: "chesscom", end: 1789387200,
      url: "https://example.test/promotion", pgn: `[White "${row.white}"]\n[Black "${row.black}"]\n[Date "2026.09.17"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "0-1"]\n\n${row.san} 0-1` }] }));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error, null); const card = service.snapshot().cards[0]; assert.ok(card);
    assert.equal(card.tacticalClassification.missedMotifs[0].id, "promotion");
    assert.equal(card.tacticalClassification.missedMotifs[0].value, row.gain);
    if(row.afterMate) {
      assert.equal(card.tacticalClassification.allowedMotifs[0].id,"mateIn5");
      assert.equal(card.tacticalClassification.allowedMotifs[0].comparison,"prevented");
      assert.match(card.explanation,/Your move allowed this tactic/);
      assert.match(card.explanation,/You also missed a tactical opportunity \(Promotion\)/);
    }
    assert.match(card.explanation, /not the full-position evaluation/);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification, JSON.parse(JSON.stringify(card.tacticalClassification)));
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-promotion-"));
    await rm(target, { recursive: true, force: true });
  }
});

test("a root-only capture mate survives generated review and saved deck reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-capture-mate-"));
  const position = Chess.fromSetup(parseFen(captureMateFen).unwrap()).unwrap();
  position.play(parseUci("h5h7"));
  const after = makeFen(position.toSetup());
  const options = { root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async requested => {
      assert.ok(requested === captureMateFen || requested === after);
      // Controlled scores test service wiring, not independent chess strength.
      return { depth: 16, pvs: requested === captureMateFen
        ? [{ mate: 3, moves: "h5h2" }] : [{ cp: -500, moves: "h8h7" }] };
    } };
  let service;
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({ accounts: { chesscom: "Tester" } }));
    await writeFile(join(root, "games.json"), JSON.stringify({ games: [{ source: "chesscom", end: 1789387200,
      url: "https://example.test/capture-mate", pgn: `[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.17"]\n[SetUp "1"]\n[FEN "${captureMateFen}"]\n[Result "0-1"]\n\n1. Qxh7+ 0-1` }] }));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error, null);
    const card = service.snapshot().cards[0]; assert.ok(card);
    assert.equal(card.tacticalClassification.missedMotifs[0].id, "mateIn3");
    assert.match(card.explanation, /Forcing Mate/);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification, JSON.parse(JSON.stringify(card.tacticalClassification)));
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-capture-mate-"));
    await rm(target, { recursive: true, force: true });
  }
});

test("a missed connected capture retains its mechanism and compensation after reload",async()=>{
  const root=await mkdtemp(join(tmpdir(),"en-shared-review-connected-capture-"));
  const pos=Chess.fromSetup(parseFen(forkCountercaptureFen).unwrap()).unwrap();
  for(const move of forkCountercaptureLine.slice(0,2))pos.play(parseUci(move));
  const fen=makeFen(pos.toSetup());pos.play(parseUci("f7h8"));const after=makeFen(pos.toSetup());
  const options={root,documentsRoot:join(root,"documents"),engineConfigPath:join(root,"engine.json"),
    fetchGames:async()=>[],lookup:async requested=>{
      assert.ok(requested===fen||requested===after);
      // Controlled scores verify wiring; separate engine receipts judge chess.
      return {depth:16,pvs:requested===fen?[{cp:500,moves:forkCountercaptureLine.slice(2).join(" ")}]:[{cp:-300,moves:"f8a3"}]};
    }};
  let service;
  try{
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,
      url:"https://example.test/connected-capture",pgn:`[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.17"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "0-1"]\n\n2. Nxh8 0-1`}]}));
    service=new SharedReviewService(options);await service.initialize(false);await service.run();
    assert.equal(service.snapshot().error,null);const card=service.snapshot().cards[0];assert.ok(card);
    assert.equal(card.tacticalClassification.missedMotifs[0].label,"Material Gain");
    assert.match(card.explanation,/counterattack on the queen/);
    const payoff=card.tacticalClassification.missedTimeline.find(m=>m.label==="Countercapture Payoff");
    assert.ok(payoff);assert.equal(payoff.ply,3);assert.equal(payoff.value,undefined);
    service.close();service=new SharedReviewService(options);await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification,JSON.parse(JSON.stringify(card.tacticalClassification)));
    assert.equal((await service.deck()).positions[0].reason,card.explanation);
  }finally{
    service?.close();const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-connected-capture-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("connected fork countercaptures survive generated review and saved deck reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-fork-collection-"));
  const fen = forkCountercaptureFen;
  const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  position.play(parseUci("e5g4"));
  const after = makeFen(position.toSetup());
  const options = {root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async requested => {
      assert.ok(requested === fen || requested === after);
      // Synthetic scores exercise service integration, not move-strength validation.
      return {depth:16,pvs:requested===fen ? [{cp:400,moves:forkCountercaptureLine.join(" ")}]
        : [{cp:0,moves:"e7e6"}]};
    }};
  let service;
  try {
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",end:1789387200,
      url:"https://example.test/fork-collection",pgn:`[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "1/2-1/2"]\n\n1. Ng4 1/2-1/2`}]}));
    service=new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error,null);
    const card=service.snapshot().cards[0]; assert.ok(card);
    assert.equal(card.tacticalClassification.missedMotifs[0].id,"fork");
    assert.match(card.explanation,/connected follow-up/);
    const payoff=card.tacticalClassification.missedTimeline.find(m=>m.label==="Fork Countercapture");
    assert.ok(payoff); assert.equal(payoff.ply,5); assert.equal(payoff.value,undefined);
    service.close(); service=new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification,JSON.parse(JSON.stringify(card.tacticalClassification)));
    assert.equal((await service.deck()).positions[0].reason,card.explanation);
  } finally {
    service?.close(); const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-review-fork-collection-"));
    await rm(target,{recursive:true,force:true});
  }
});

test("king-safe defender removal survives generated mistake review, storage and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-king-removal-"));
  const {fen} = kingDefenderRemovalCases[0];
  const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  position.play(parseUci("a1b1"));
  const after = makeFen(position.toSetup());
  const options = {root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async requested => {
      assert.ok(requested === fen || requested === after);
      // Synthetic score loss exercises persistence; real move strength and
      // selected defensive answers have separate fresh engine receipts.
      return {depth: 16, pvs: requested === fen
        ? [{cp: 400, moves: "h6d6 c7d6 g3f4"}] : [{cp: 0, moves: "f4f8"}]};
    }};
  let service;
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({accounts: {chesscom: "Tester"}}));
    await writeFile(join(root, "games.json"), JSON.stringify({games: [{source: "chesscom", end: 1789387200,
      url: "https://example.test/king-removal", pgn: `[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "1/2-1/2"]\n\n1. Rab1 1/2-1/2`}]}));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error, null);
    const card = service.snapshot().cards[0]; assert.ok(card);
    assert.equal(card.tacticalClassification.missedMotifs[0].id, "capturingDefender");
    assert.equal(card.tacticalClassification.missedMotifs[0].ply, 1);
    assert.match(card.explanation, /Removing the Defender|removes the bishop/);
    assert.match(card.explanation, /could not legally take/);
    assert.deepEqual((await service.deck()).positions[0].mistakeReview.missedMotifs,
      card.tacticalClassification.missedMotifs);
    const payoff = card.tacticalClassification.missedTimeline.find(m => m.label === "Defender Removal Payoff");
    assert.ok(payoff); assert.equal(payoff.ply, 3); assert.equal(payoff.value, undefined);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    // JSON persistence omits undefined optional fields. The contextual payoff
    // must keep its label and ply without acquiring a second profit value.
    const saved = service.snapshot().cards[0].tacticalClassification;
    assert.deepEqual(saved, JSON.parse(JSON.stringify(card.tacticalClassification)));
    const savedPayoff = saved.missedTimeline.find(m => m.label === "Defender Removal Payoff");
    assert.ok(savedPayoff); assert.equal(savedPayoff.ply, 3); assert.equal(savedPayoff.value, undefined);
    assert.equal((await service.deck()).positions[0].reason, card.explanation);
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-king-removal-"));
    await rm(target, {recursive: true, force: true});
  }
});

test("settled exchanges keep the full queen loss through generated review and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-settled-exchange-"));
  // Public constructed complete-material origin. Synthetic scores exercise
  // storage/wiring, not the independently recorded strength of these moves.
  const origin = "rnbrq1k1/ppp1ppbp/1n4pp/8/3B1P2/6N1/PPP1PPPP/RNBQ2KR b - - 0 1";
  const position = Chess.fromSetup(parseFen(origin).unwrap()).unwrap();
  position.play(parseUci("g7d4"));
  const before = makeFen(position.toSetup());
  assert.ok(position.isLegal(parseUci("d1e1")));
  position.play(parseUci("d1d4"));
  const after = makeFen(position.toSetup());
  const options = {root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async fen => {
      assert.ok(fen === before || fen === after);
      return {depth: 16, pvs: fen === before
        ? [{cp: 0, moves: "d1e1"}] : [{cp: -720, moves: "d8d4"}]};
    }};
  let service;
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({accounts: {chesscom: "Tester"}}));
    await writeFile(join(root, "games.json"), JSON.stringify({games: [{source: "chesscom", end: 1789387200,
      url: "https://example.test/settled-exchange", pgn: `[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${origin}"]\n[Result "0-1"]\n\n1... Bxd4 2. Qxd4 0-1`}]}));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error, null);
    const card = service.snapshot().cards[0]; assert.ok(card);
    assert.deepEqual(card.tacticalHistory, {fen: origin, moves: ["g7d4"]});
    const capture = card.tacticalClassification.allowedMotifs.find(m => m.moveUci === "d8d4");
    assert.equal(capture?.value, 900);
    assert.equal(capture?.comparison, "prevented");
    assert.match(card.explanation, /earlier losses.*9 pawns/);
    assert.deepEqual((await service.deck()).positions[0].mistakeReview.allowedMotifs,
      card.tacticalClassification.allowedMotifs);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification, card.tacticalClassification);
    assert.equal((await service.deck()).positions[0].reason, card.explanation);
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-settled-exchange-"));
    await rm(target, {recursive: true, force: true});
  }
});

test("a missed mating attack with defensive check evasions survives generated review and storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-mating-evasion-"));
  const position = Chess.fromSetup(parseFen(matingCheckEvasionFen).unwrap()).unwrap();
  position.play(parseUci("e4a8"));
  const after = makeFen(position.toSetup());
  const options = {root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async fen => {
      assert.ok(fen === matingCheckEvasionFen || fen === after);
      // Controlled nomination evidence tests wiring. Fresh engine receipts and
      // an independent complete strategy check validate the actual chess.
      return {depth: 16, pvs: fen === matingCheckEvasionFen
        ? [{mate: -7, moves: matingCheckEvasionLine.join(" ")}] : [{cp: 0, moves: "b8a8"}]};
    }};
  let service;
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({accounts: {chesscom: "Tester"}}));
    await writeFile(join(root, "games.json"), JSON.stringify({games: [{source: "chesscom", end: 1789387200,
      url: "https://example.test/mating-evasion", pgn: `[White "Opponent"]\n[Black "Tester"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${matingCheckEvasionFen}"]\n[Result "1/2-1/2"]\n\n1... Qxa8+ 1/2-1/2`}]}));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error, null);
    const card = service.snapshot().cards[0]; assert.ok(card);
    assert.equal(card.tacticalClassification.missedMotifs[0].id, "mateIn7");
    assert.equal(card.tacticalClassification.allowedMotifs.length, 0);
    assert.deepEqual((await service.deck()).positions[0].mistakeReview.missedMotifs,
      card.tacticalClassification.missedMotifs);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification, card.tacticalClassification);
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-mating-evasion-"));
    await rm(target, {recursive: true, force: true});
  }
});

test("a missed short mating attack survives generated review, storage and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-short-threat-"));
  const input = shortMatingThreatCases[0];
  const position = Chess.fromSetup(parseFen(input.fen).unwrap()).unwrap();
  position.play(parseUci("e1f1"));
  const after = makeFen(position.toSetup());
  const options = {root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async fen => {
      assert.ok(fen === input.fen || fen === after);
      // Synthetic nomination scores exercise the generated service and storage,
      // not the independently recorded strength of this constructed position.
      return {depth: 16, pvs: fen === input.fen
        ? [{cp: 800, moves: input.move}] : [{cp: 200, moves: "f7f6"}]};
    }};
  let service;
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({accounts: {chesscom: "Tester"}}));
    await writeFile(join(root, "games.json"), JSON.stringify({games: [{source: "chesscom", end: 1789387200,
      url: "https://example.test/short-threat", pgn: `[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${input.fen}"]\n[Result "0-1"]\n\n1. Kf1 0-1`}]}));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error, null);
    const card = service.snapshot().cards[0]; assert.ok(card);
    const motif = card.tacticalClassification.missedMotifs.find(m => m.label === "Mating Attack");
    assert.ok(motif); assert.equal(motif.ply, 1); assert.equal(motif.value, 130);
    assert.match(motif.evidence, /mate in two if unanswered/);
    assert.deepEqual((await service.deck()).positions[0].mistakeReview.missedMotifs,
      card.tacticalClassification.missedMotifs);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification, card.tacticalClassification);
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-short-threat-"));
    await rm(target, {recursive: true, force: true});
  }
});

test("a newly defended fork gains its cause in generated review and saved cards", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-fork-guard-"));
  const position = Chess.fromSetup(parseFen(checkingForkCaptureFen).unwrap()).unwrap();
  position.play(parseUci("e7c5"));
  const after = makeFen(position.toSetup());
  const options = {root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async fen => {
      assert.ok(fen === checkingForkCaptureFen || fen === after);
      // Synthetic nomination scores test storage/wiring, not the strength of
      // this deliberately stripped-down position. Scores are White-relative.
      return {depth: 16, pvs: fen === checkingForkCaptureFen
        ? [{cp: 0, moves: "e7d6 d5e3"}]
        : [{cp: 500, moves: "d5c7 e8d8 c7a8"}]};
    }};
  let service;
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({accounts: {chesscom: "Tester"}}));
    await writeFile(join(root, "games.json"), JSON.stringify({games: [{source: "chesscom", end: 1789387200,
      url: "https://example.test/fork-guard", pgn: `[White "Opponent"]\n[Black "Tester"]\n[Date "2026.09.16"]\n[SetUp "1"]\n[FEN "${checkingForkCaptureFen}"]\n[Result "1-0"]\n\n1... Qc5 1-0`}]}));
    service = new SharedReviewService(options); await service.initialize(false); await service.run();
    assert.equal(service.snapshot().error, null);
    const card = service.snapshot().cards[0]; assert.ok(card);
    const fork = card.tacticalClassification.allowedMotifs.find(m => m.id === "fork");
    assert.equal(fork?.comparison, "prevented");
    assert.match(fork.comparisonEvidence, /Qxc7/);
    assert.match(card.explanation, /captures the forking knight/);
    assert.deepEqual((await service.deck()).positions[0].mistakeReview.allowedMotifs,
      card.tacticalClassification.allowedMotifs);
    service.close(); service = new SharedReviewService(options); await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification, card.tacticalClassification);
  } finally {
    service?.close(); const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-fork-guard-"));
    await rm(target, {recursive: true, force: true});
  }
});

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
