import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { makeSan } from "chessops/san";
import { SharedReviewService } from "../generated/shared-review-service.js";
import { captureAttractionIdeaFen, captureAttractionIdeaLine } from "../../src/utils/tests/fixtures/captureAttractionIdea.ts";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork.ts";

async function fixture(reflected, playerCp, run) {
  const root = await mkdtemp(join(tmpdir(), "en-shared-score-perspective-"));
  const fen = reflected ? reflectMixedForkFen(captureAttractionIdeaFen) : captureAttractionIdeaFen;
  const flip = move => reflected ? reflectMixedForkMove(move) : move;
  const board = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const played = parseUci(flip("c1d2"));
  assert.ok(played && board.isLegal(played));
  const san = makeSan(board, played);
  board.play(played);
  const afterFen = makeFen(board.toSetup());
  assert.ok(board.isLegal(parseUci(flip("b7c8"))));
  const sign = reflected ? -1 : 1;
  const afterCp = playerCp > 0 ? 0 : -900;
  const options = { root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async requested => {
      assert.ok(requested === fen || requested === afterFen);
      // Controlled White-relative scores exercise transport, not chess truth.
      return {depth:18,pvs:requested === fen
        ? [{cp:sign*playerCp,moves:captureAttractionIdeaLine.map(flip).join(" ")}]
        : [{cp:sign*afterCp,moves:flip("b7c8")}]};
    }};
  let service;
  try {
    const result = reflected ? "1-0" : "0-1";
    const pgn = `[White "${reflected ? "Opponent" : "Tester"}"]\n[Black "${reflected ? "Tester" : "Opponent"}"]\n[Date "2026.10.02"]\n[Result "${result}"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n1${reflected ? "..." : "."} ${san} ${result}`;
    await writeFile(join(root,"config.json"),JSON.stringify({accounts:{chesscom:"Tester"}}));
    await writeFile(join(root,"games.json"),JSON.stringify({games:[{source:"chesscom",pgn,end:1790899200,url:"https://example.test/score-perspective"}]}));
    service = new SharedReviewService(options);
    await service.initialize(false);
    await service.run();
    assert.equal(service.snapshot().error,null);
    assert.equal(service.snapshot().cards.length,1);
    const card = service.snapshot().cards[0];
    const fresh = JSON.parse(JSON.stringify(await service.deck()));
    await run({service,card,fresh,root,expected:{before:sign*playerCp,after:sign*afterCp,loss:playerCp-afterCp},
      deckPath:join(options.documentsRoot,"My online games.mistake-review.json"),
      reload:async()=>{service.close();service=new SharedReviewService(options);await service.initialize(false);return service;}});
  } finally {
    service?.close();
    const target=resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes("en-shared-score-perspective-"));
    await rm(target,{recursive:true,force:true});
  }
}

function assertScores(metadata, expected) {
  assert.equal(metadata.cpPerspective,"white");
  assert.equal(metadata.cpBefore-expected.before,0);
  assert.equal(metadata.cpAfter-expected.after,0);
  assert.equal(metadata.cpLoss,expected.loss);
}

for (const reflected of [false,true]) for (const playerCp of [300,-300]) test(
  `constructor/export/reload preserves White-relative scores: reflected=${reflected}, playerCp=${playerCp}`, async()=>{
    await fixture(reflected,playerCp,async({card,fresh,expected,reload})=>{
      assert.equal(card.tacticalClassification.missedMotifs.some(m=>m.id==="attractionIdea"),playerCp>0);
      assertScores(fresh.positions[0].mistakeReview,expected);
      const reloaded=await reload();
      assertScores((await reloaded.deck()).positions[0].mistakeReview,expected);
    });
  });

test("exact legacy Black export is repaired without changing progress, notes or logs; stale save cannot undo it",async()=>{
  await fixture(true,300,async({service,fresh,expected,deckPath,reload})=>{
    const legacy=structuredClone(fresh), old=legacy.positions[0];
    delete old.mistakeReview.cpPerspective;
    old.mistakeReview.cpBefore=300; old.mistakeReview.cpAfter=0;
    old.mistakeReview.nature="tactical";
    old.mistakeReview.natureClassifierVersion=0;
    old.mistakeReview.natureMotifClassifierVersion="legacy-motif";
    old.comment="Keep my analysis"; old.annotations=["!?" ];
    old.shapes=[{orig:"c1",dest:"d2",brush:"green"}];
    old.reviewTree={fixture:"saved tree"};
    old.card={...old.card,reps:7,lapses:2,last_review:"2026-10-02T12:00:00.000Z",due:"2026-10-12T12:00:00.000Z"};
    legacy.logs=[{fixture:"original review log"}];
    await writeFile(deckPath,JSON.stringify(legacy));
    const repaired=await service.deck();
    assertScores(repaired.positions[0].mistakeReview,expected);
    for(const field of ["motifClassifierVersion","natureClassifierVersion","natureMotifClassifierVersion"])
      assert.equal(repaired.positions[0].mistakeReview[field],undefined);
    for(const field of ["allowedMotifs","missedMotifs","allowedTimeline","missedTimeline"])
      assert.deepEqual(repaired.positions[0].mistakeReview[field],[]);
    assert.deepEqual(repaired.positions[0].mistakeReview.pvUci,old.mistakeReview.pvUci);
    assert.deepEqual(repaired.positions[0].mistakeReview.refutationUci,old.mistakeReview.refutationUci);
    for(const field of ["comment","annotations","shapes","reviewTree","card"])
      assert.deepEqual(repaired.positions[0][field],old[field]);
    assert.deepEqual(repaired.logs,legacy.logs);
    const saved=await service.saveDeck(legacy);
    assertScores(saved.positions[0].mistakeReview,expected);
    assert.deepEqual(saved.positions[0].card,old.card);
    assert.deepEqual(saved.logs,legacy.logs);
    assertScores(JSON.parse(await readFile(deckPath,"utf8")).positions[0].mistakeReview,expected);
    const reloaded=await reload();
    assertScores((await reloaded.deck()).positions[0].mistakeReview,expected);
  });
});

test("colliding or incomplete identities do not authorize legacy score repair",async()=>{
  await fixture(true,300,async({service,fresh,deckPath})=>{
    const changes=[p=>{p.fen=p.fen.replace(" b "," w ");},p=>{p.sideToMove="white";},
      p=>{p.mistakeReview.playerColor="white";},p=>{p.mistakeReview.playedMoveUci="c8b8";},
      p=>{p.mistakeReview.bestMoveUci="f8b4";},p=>{delete p.mistakeReview.playedMoveUci;},
      p=>{p.answerUci="f8b4";}];
    for(const change of changes){
      const legacy=structuredClone(fresh),old=legacy.positions[0];
      delete old.mistakeReview.cpPerspective;
      old.mistakeReview.cpBefore=300;old.mistakeReview.cpAfter=0;
      change(old);
      await writeFile(deckPath,JSON.stringify(legacy));
      const result=(await service.deck()).positions[0];
      assert.deepEqual(result.mistakeReview,old.mistakeReview);
    }
  });
});

test("a marked desktop reanalysis is not overwritten by its older phone card",async()=>{
  await fixture(true,300,async({service,fresh,deckPath})=>{
    fresh.positions[0].mistakeReview.cpBefore=-425;
    fresh.positions[0].mistakeReview.cpAfter=-30;
    await writeFile(deckPath,JSON.stringify(fresh));
    assert.deepEqual((await service.deck()).positions[0].mistakeReview,fresh.positions[0].mistakeReview);
  });
});

test("unmarked desktop scores or newer-depth analysis are not guessed to be old exports",async()=>{
  await fixture(true,300,async({service,fresh,deckPath})=>{
    for(const scores of [{cpBefore:-425,cpAfter:-30,reachedDepth:16},
      {cpBefore:300,cpAfter:0,reachedDepth:24}]){
      const saved=structuredClone(fresh);
      delete saved.positions[0].mistakeReview.cpPerspective;
      Object.assign(saved.positions[0].mistakeReview,scores);
      await writeFile(deckPath,JSON.stringify(saved));
      assert.deepEqual((await service.deck()).positions[0].mistakeReview,saved.positions[0].mistakeReview);
    }
  });
});
