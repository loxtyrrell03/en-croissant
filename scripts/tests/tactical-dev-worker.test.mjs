import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { mixedForkFen, mixedForkLine, mixedForkControls } from "../../src/utils/tests/fixtures/mixedTargetFork.ts";
import { quietPieceForkCases, quietPieceForkMove } from "../../src/utils/tests/fixtures/quietPieceFork.ts";
import { discoveryTrapCases } from "../../src/utils/tests/fixtures/discoveryTrap.ts";
import { perpetualMaterialCases, perpetualMaterialLine } from "../../src/utils/tests/fixtures/perpetualMaterial.ts";
import { directThreatFen, directThreatLine } from "../../src/utils/tests/fixtures/directThreatRelevance.ts";
import { compensatedCaptureInput } from "../../src/utils/tests/fixtures/compensatedCapture.ts";
import { forkLocalValueCases } from "../../src/utils/tests/fixtures/forkLocalValue.ts";
import { forkRepairCases } from "../../src/utils/tests/fixtures/forkRepair.ts";
import { checkingExchangeCases } from "../../src/utils/tests/fixtures/checkingExchangeRetention.ts";
import { checkingAlliedRetentionCases, checkingAlliedRetentionLine } from "../../src/utils/tests/fixtures/checkingAlliedRetention.ts";
import { checkingCombinationCases, promotionCaptureForkCases } from "../../src/utils/tests/fixtures/checkingCombinationRecall.ts";
import { checkingPawnRetentionCases } from "../../src/utils/tests/fixtures/checkingPawnRetention.ts";
import { tablebaseCases } from "../../src/utils/tests/fixtures/tablebaseRelevance.ts";
import { directMaterialPayoffCases, reflectPayoff } from "../../src/utils/tests/fixtures/directMaterialPayoff.ts";
import {
  classifyLiveTacticsInWorker,
  TACTICAL_CLASSIFICATION_TIMEOUT_MS,
  TACTICAL_WORKER_STARTUP_TIMEOUT_MS,
} from "../../src/utils/tacticalMotifs/liveTacticsWorker.ts";

// Point only at a local Vite dev server. This does not automate or restart the app.
// node --experimental-vm-modules --test scripts/tests/tactical-dev-worker.test.mjs
const origin = process.env.TACTICAL_DEV_SERVER;
async function runWorker(input) {
  const start = performance.now();
  let bridge;
  const original = globalThis.Worker;
  // Execute the application's actual ownership/deadline controller, replacing
  // only the browser transport with Node's thread and HTTP-module adapter.
  globalThis.Worker = class {
    constructor(url, options) {
      assert.ok(url.pathname.endsWith("/liveTactics.worker.ts"));
      assert.equal(options.type, "module");
      bridge = this;
      this.modules = [];
      this.loadProgress = null;
      this.startedAt = null;
      this.thread = new Worker(new URL("./helpers/tactical-dev-worker.mjs", import.meta.url), {
        workerData: { origin },
      });
      this.thread.on("error", (error) => this.onerror?.({ message: error.message }));
      this.thread.on("message", (message) => {
        if (message.failure) this.onerror?.({ message: message.failure });
        else if (message.loadProgress) this.loadProgress = message.loadProgress;
        else if (message.modules) this.modules = message.modules;
        else {
          if (message.type === "started") this.startedAt = performance.now();
          this.onmessage?.({ data: message });
        }
      });
    }
    postMessage(data) {
      this.thread.postMessage(data);
    }
    terminate() {
      this.terminated = true;
      void this.thread.terminate();
    }
  };
  try {
    const scan = await classifyLiveTacticsInWorker(input, new AbortController().signal);
    const finished = performance.now();
    assert.equal(bridge.terminated, true);
    assert.notEqual(bridge.startedAt, null);
    return {
      scan,
      modules: bridge.modules,
      startupMs: bridge.startedAt - start,
      classificationMs: finished - bridge.startedAt,
      loadProgress: bridge.loadProgress,
    };
  } catch (error) {
    if (process.env.TACTICAL_DEV_WORKER_REPORT)
      writeFileSync(
        process.env.TACTICAL_DEV_WORKER_REPORT,
        JSON.stringify(
          {
            error: error.message,
            elapsedMs: performance.now() - start,
            loadProgress: bridge?.loadProgress,
          },
          null,
          2,
        ),
      );
    throw error;
  } finally {
    globalThis.Worker = original;
  }
}

test(
  "bundled development worker loads and classifies without UI dependencies",
  { skip: !origin },
  async (t) => {
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
    const { castlingAliasCases } = await import("../../src/utils/tests/fixtures/castlingRelevance.ts");
    const { matingInterferenceCases, reflectMatingInterference } = await import("../../src/utils/tests/fixtures/matingInterference.ts");
    const cases = [
      ...checkingPawnRetentionCases.map(row => ({...row,name:`checking pawn retention: ${row.id}`,variations:[{pvUci:row.pvUci,cp:0,depth:16}],expectedPrimary:row.positive?["hangingPiece"]:[],expectedArrows:row.positive?[["c7","c6"]]:[]})),
      ...forkLocalValueCases.map(row => ({...row,name:`local fork value: ${row.id}`,expectedPrimary:row.gain === null ? [] : ["fork"]})),
      ...forkRepairCases.map(row => ({...row,name:`quiet fork repair: ${row.id}`,expectedPrimary:row.positive ? ["fork"] : []})),
      ...checkingExchangeCases.map(row => ({...row,name:`checking exchange: ${row.id}`,variations:[{pvUci:row.pvUci,cp:0,depth:16}],expectedPrimary:row.positive ? ["hangingPiece"] : []})),
      ...checkingAlliedRetentionCases.map(row => ({...row,pvUci:checkingAlliedRetentionLine,name:`allied checking retention: ${row.id}`,variations:[{pvUci:checkingAlliedRetentionLine,cp:0,depth:16}],expectedPrimary:row.positive ? ["hangingPiece"] : []})),
      ...checkingCombinationCases.map(row => ({...row,name:`checking combination: ${row.id}`,expectedPrimary:row.positive ? ["forcingAttack"] : []})),
      ...promotionCaptureForkCases.map(row => ({...row,name:`promotion capture fork: ${row.id}`,expectedPrimary:row.positive ? ["fork"] : []})),
      {name:"compensated capture retains its sub-pawn bound",...compensatedCaptureInput,expectedPrimary:["hangingPiece"]},
      {name:"missing recapture cannot fund a gain",...compensatedCaptureInput,fen:compensatedCaptureInput.fen.replace("2N2N2","2N5"),pvUci:["c3d5"],expectedPrimary:[]},
      {name:"off-square rook loss prevents a material headline",...compensatedCaptureInput,fen:compensatedCaptureInput.fen.replace("P5PP","Pb4PP"),pvUci:["c3d5"],expectedPrimary:[]},
      {name:"newly exposed pawn",fen:"r5k1/p5pp/8/4p3/3P4/8/P5PP/R5K1 w - - 0 2",previousFen:"r5k1/p3p1pp/8/8/3P4/8/P5PP/R5K1 b - - 0 1",previousMoveUci:"e7e5",pvUci:["d4e5"],expectedPrimary:["hangingPiece"]},
      {name:"history-free pawn capture stays unclassified",fen:"r5k1/p5pp/8/4p3/3P4/8/P5PP/R5K1 w - - 0 2",pvUci:["d4e5"],expectedPrimary:[]},
      {name:"piece gain leads over pawn gain",fen:"4kb2/8/8/4q3/4P3/NPPP1P2/P7/R2QK3 b Q - 1 1",previousFen:"4kb2/8/8/4q3/4P3/1PPP1P2/P7/RN1QK3 w Q - 0 1",previousMoveUci:"b1a3",pvUci:["e5c3"],variations:[{multipv:1,depth:16,cp:640,pvUci:["e5c3"]},{multipv:2,depth:16,cp:600,pvUci:["f8a3"]}],expectedPrimary:["hangingPiece"],expectedLabels:["hangingPiece"],expectedArrows:[["f8","a3"]]},
      ...perpetualMaterialCases.map(row => {
        const pvUci = row.move ? [row.move] : perpetualMaterialLine;
        return { name: `saving perpetual: ${row.id}`, fen: row.fen, pvUci,
          variations: [{ pvUci, cp: row.cp }], expectedPrimary: row.expected ? [row.expected] : [] };
      }),
      ...quietPieceForkCases.map(row=>({name:`quiet piece fork: ${row.id}`,fen:row.fen,pvUci:[quietPieceForkMove],expectedPrimary:row.positive?["fork"]:[]})),
      ...discoveryTrapCases.map(row=>({name:`discovered trap: ${row.id}`,fen:row.fen,pvUci:["e2e4"],expectedPrimary:row.positive?["discoveredAttack"]:[]})),
      ...matingInterferenceCases.filter(row => row.id !== "already-blocked-defence").flatMap(row => [row, { ...reflectMatingInterference(row), id: `${row.id}:black` }]).map(row => ({ name: `mating interference: ${row.id}`, fen: row.fen, pvUci: [row.move], expectedPrimary: row.expected || row.id.startsWith("extra-diagonal-defender") ? ["mateIn3"] : [], expectedTimeline: row.expected ? { id: "interference", ply: 1, actor: row.id.endsWith(":black") ? "black" : "white" } : undefined })),
      ...JSON.parse(readFileSync("benchmarks/tactical-relevance/quiet-mate-development.json", "utf8")).cases.flatMap(row => [1, row.bestLine.length].map(length => ({
        name: `quiet mate: ${row.id}:${length}`, fen: row.startFen, pvUci: row.bestLine.slice(0, length),
        expectedPrimary: row.stratum === "mateIn2" ? ["mateThreat"] : row.stratum === "mateIn3" ? ["mateIn3"] : row.id === "lichess:0rcU4" ? ["forcingAttack"] : [],
        expectedArrows: row.stratum !== "mateIn4" ? [[row.bestLine[0].slice(0, 2), row.bestLine[0].slice(2, 4)]] : row.id === "lichess:0rcU4" ? undefined : [],
      }))),
      ...castlingAliasCases.map(row => ({ name: `castling: ${row.id}`, fen: row.fen, pvUci: row.pvUci, expectedPrimary: row.mate ? ["mateIn1"] : row.id.includes("check-not-mate") ? [] : undefined, expectedArrows: row.mate ? [[row.pvUci[0].slice(0, 2), row.kingTo], [row.rookFrom, row.rookTo]] : undefined, expectedSquare: row.mate ? row.kingTo : undefined })),
      ...[...directMaterialPayoffCases, ...directMaterialPayoffCases.map(reflectPayoff)].map(row => ({ name: `direct payoff: ${row.id}`, fen: row.fen, pvUci: row.pvUci, expectedPrimary: [row.theme], expectedPayoff: row.label })),
      ...tablebaseCases.filter(row => ["EKWHC:g4f4", "EKWHC-reciprocal-draw"].includes(row.id)).map(row => ({ name: row.id, fen: row.fen, pvUci: [row.move], tablebaseEvidence: row.evidence, expectedPrimary: ["zugzwang"], expectedLabels: ["zugzwang"] })),
      { name: "discovered check suppresses its duplicate direct threat", fen: directThreatFen, pvUci: directThreatLine, expectedPrimary: ["discoveredCheck"], expectedLabels: ["discoveredCheck"] },
      { name: "quiet mixed-target fork", fen: mixedForkFen, pvUci: ["d2f3"], expectedPrimary: ["fork"] },
      { name: "mixed fork keeps its later pin", fen: mixedForkFen, pvUci: mixedForkLine, expectedPrimary: ["fork"] },
      { name: "unpinning answers the immediate fork", fen: mixedForkControls[0].fen, pvUci: ["d2f3"], expectedPrimary: [] },
      { name: "a second pawn guard answers the fork", fen: mixedForkControls[2].fen, pvUci: ["d2f3"], expectedPrimary: [] },
      {
        name: "reported Reti position",
        fen: "rnbqkbnr/ppp1pppp/8/3p4/2P5/5N2/PP1PPPPP/RNBQKB1R b KQkq - 0 2",
        pvUci: ["d5d4", "e2e3", "c7c5"],
      },
      {
        name: "f7 fork and checking bishop alternative",
        expectedF7Alternatives: true,
        fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
        pvUci: ["e5f7", "d8e8", "f7h8"],
        variations: [
          { multipv: 1, pvUci: ["e5f7", "d8e8", "f7h8"], cp: 460 },
          { multipv: 2, pvUci: ["c4f7", "e8f8", "f7b3"], cp: 350 },
        ],
      },
      {
        name: "promotion combination survives complete pawn-race verification",
        fen: "3R4/5k2/6p1/p7/3pNr2/2p2P1P/P5PK/8 b - - 3 41",
        pvUci: ["f4e4"],
        expectedPrimary: ["promotionCombination"],
      },
      {
        name: "a losing counterpromotion race cannot fund a promotion lesson",
        fen: "3R4/8/6p1/p7/3pNr2/2p2P1P/P3k1PK/8 b - - 3 41",
        pvUci: ["f4e4"],
        expectedPrimary: [],
      },
      {
        name: "exact KPK zugzwang",
        fen: "8/8/8/5k2/8/4K3/5P2/8 w - - 1 69",
        pvUci: ["e3f3"],
        expectedPrimary: ["zugzwang"],
      },
      {
        name: "mating clearance and compact supporting board geometry",
        fen: "8/8/2k1B3/2b4r/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 3 34",
        pvUci: ["c5e3", "f2e3", "h5c5", "e6c4", "c5c4", "c1b1", "e2d3"],
        expectedPrimary: ["mateIn4"],
        expectedLabels: ["mateIn4", "clearance"],
        expectedArrowCount: 2,
      },
      {
        name: "quiet mating attack with actual-ply deflection",
        fen: "8/pp4k1/3P2p1/8/2PbB2p/6qP/PP6/5Q1K b - - 0 35",
        pvUci: ["d4e5", "f1g2", "g3e1", "g2g1", "e1e4"],
        expectedPrimary: ["forcingAttack"],
        expectedLabels: ["forcingAttack"],
        expectedArrowCount: 2,
      },
      {
        name: "pawn-ending entry with a claimable draw",
        fen: "8/8/6k1/8/4p1K1/8/5P2/8 w - - 98 67",
        pvUci: ["g4f4"],
        expectedPrimary: [],
      },
      {
        name: "drawing KPK opposition",
        fen: "8/2k5/8/8/2K5/2P5/8/8 b - - 0 1",
        pvUci: ["c7c6"],
        expectedPrimary: ["zugzwang"],
        expectedLabels: ["zugzwang"],
        expectedArrowCount: 1,
      },
      {
        name: "opening discovered check with independently verified continuations",
        fen: "rnbqkbnr/pppp2pp/5p2/4P3/8/2N5/PP2QPPP/R1B1KBNR w KQkq - 0 7",
        pvUci: ["e5f6"],
        expectedPrimary: ["discoveredCheck"],
        expectedLabels: ["discoveredCheck"],
      },
      {
        name: "forced mate retains x-ray support instead of an intermediate-capture headline",
        fen: "4r1k1/pp1b1pbp/2p3p1/8/1qNp4/1P1P1Q2/P1P1RPPP/4R1K1 b - - 6 23",
        pvUci: ["b4e1", "e2e1", "e8e1"],
        expectedPrimary: ["mateIn2"],
        expectedLabels: ["mateIn2", "xRayAttack"],
        expectedArrowCount: 3,
      },
      {
        name: "mating self-interference stays on the defender's actual ply",
        fen: "8/p3NQpk/1p6/1P2p2p/6q1/6P1/P1rr1P2/5RK1 w - - 1 33",
        pvUci: ["f7g8", "h7h6", "g8h8", "h6g5", "h8g7"],
        expectedPrimary: ["mateIn3"],
        expectedLabels: ["mateIn3"],
        expectedTimeline: { id: "selfInterference", ply: 4, actor: "black" },
      },
      {
        name: "king trap independently includes defender removal without future arrows",
        fen: "3r2k1/pp2bpp1/2p4p/8/3PN3/P2Pr2P/1P4P1/3R1RK1 w - - 2 23",
        pvUci: ["g1f2"],
        expectedPrimary: ["trappedPiece"],
        expectedLabels: ["trappedPiece"],
        expectedArrowCount: 2,
      },
      {
        name: "an open escape file defeats the rook-trap claim",
        fen: "3r2k1/pp2bpp1/2p4p/8/4N3/P2Pr2P/1P4P1/3R1RK1 w - - 2 23",
        pvUci: ["g1f2"],
        expectedPrimary: [],
      },
      {
        name: "the first interference explains the repeated cut without future arrows",
        fen: "1r1q1rk1/pp1Nbpp1/7p/n2p4/Q7/2PP4/PP3PPP/R1B2RK1 b - - 1 15",
        pvUci: ["b7b5", "a4g4", "f7f5", "g4g3", "d8d7"],
        expectedPrimary: ["interference"],
        expectedLabels: ["interference"],
        expectedArrowCount: 4,
      },
      {
        name: "the bishop's interference includes the reinforcing defender",
        fen: "4r2k/1bq1rpp1/p4p2/1pn2N2/8/2P4P/PPQ1BPP1/R3R1K1 b - - 5 21",
        pvUci: ["b7e4"],
        expectedPrimary: ["interference"],
        expectedLabels: ["interference"],
        expectedArrowCount: 4,
      },
      {
        name: "a material interference claim cannot ignore immediate mate",
        fen: "3k4/1r5q/3PP3/8/8/1p6/1rb5/K6Q w - - 0 1",
        pvUci: ["e6e7"],
        expectedPrimary: [],
      },
      {
        name: "the quiet pawn clearance owns the root without future fork arrows",
        fen: "8/8/1RP5/p3n3/8/1P5k/r6p/5N1K w - - 3 61",
        pvUci: ["c6c7","a2c2","b6h6","h3g4","f1e3","g4g5","e3c2","g5h6","c7c8q"],
        expectedPrimary: ["clearance"],expectedLabels:["clearance"],expectedArrowCount:2,
      },
      {
        name: "mating deflection supports mate without a whole future line on the board",
        fen:"4r2k/3R4/1q2rp1p/8/1p5P/p4QP1/7K/4R3 w - - 0 43",
        pvUci:["f3f6","e6f6","e1e8","f6f8","e8f8"],
        expectedPrimary:["mateIn3"],expectedLabels:["mateIn3"],expectedArrowCount:2,
      },
      {
        name:"mating self-interference remains the king evasion's secondary mechanism",
        fen:"8/4R1p1/p4k2/1b1p1p1p/1P4r1/2P3P1/3K4/4R3 w - - 2 49",
        pvUci:["e1e6","f6g5","e7g7"],expectedPrimary:["mateIn2"],expectedLabels:["mateIn2"],
      },
      {
        name: "an extra promotion guard defeats the quiet clearance claim",
        fen: "r7/8/1RP5/p3n3/8/1P5k/r6p/5N1K w - - 3 61",
        pvUci: ["c6c7"],expectedPrimary:[],
      },
      {
        name: "the fresh opening recapture retains its compensation context",
        fen:"rn1q1rk1/5ppp/p3pn2/1pp2bB1/3P4/PBb1PN2/1P3PPP/2RQ1RK1 w - - 0 13",
        previousFen:"rn1q1rk1/5ppp/p3pn2/1pp2bB1/1b1P4/PBN1PN2/1P3PPP/2RQ1RK1 b - - 0 12",
        previousMoveUci:"b4c3",pvUci:["c1c3","c5d4","f3d4"],expectedPrimary:[],
      },
    ];
    const report = [];
    for (const item of cases) {
      const result = await runWorker({ ...item, engineName: "Worker regression", depth: 16 });
      assert.ok(result.startupMs < TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
      assert.ok(result.classificationMs < TACTICAL_CLASSIFICATION_TIMEOUT_MS);
      assert.equal(result.modules.length, 1, "development must serve a self-contained verifier");
      if (item.expectedPayoff)
        assert.equal(result.scan.variations[0].timeline.find(motif => motif.ply === 3)?.label, item.expectedPayoff);
      if (item.expectedPrimary)
        assert.deepEqual(result.scan.motifs.map((motif) => motif.id), item.expectedPrimary);
      if (item.expectedArrows) assert.deepEqual(result.scan.arrows.map(arrow => [arrow.from, arrow.to]), item.expectedArrows);
      if (item.expectedSquare) assert.equal(result.scan.labels[0].square, item.expectedSquare);
      if (item.expectedLabels)
        assert.deepEqual(result.scan.labels.map((label) => label.id), item.expectedLabels);
      if (item.expectedArrowCount !== undefined)
        assert.equal(result.scan.arrows.length, item.expectedArrowCount);
      if (item.expectedTimeline) {
        const entry = result.scan.variations[0].timeline.find(motif => motif.id === item.expectedTimeline.id);
        assert.ok(entry);
        assert.equal(entry.ply, item.expectedTimeline.ply);
        assert.equal(entry.actor, item.expectedTimeline.actor);
      }
      assert.deepEqual(
        result.modules.filter((url) =>
          /engines\.ts|unwrap\.tsx|tauri|react|mantine|@vite\/client/.test(url),
        ),
        [],
      );
      if (item.expectedF7Alternatives) {
        assert.equal(result.scan.motifs[0].id, "fork");
        assert.ok(result.scan.arrows.some((arrow) => arrow.from === "f7" && arrow.to === "d8"));
        assert.ok(result.scan.arrows.some((arrow) => arrow.from === "f7" && arrow.to === "h8"));
        assert.ok(result.scan.variations[1].motifs.some((motif) => motif.id === "attackingF2F7"));
      }
      t.diagnostic(
        `${item.name}: ${result.modules.length} modules; startup ${Math.round(result.startupMs)} ms; classification/transfer ${Math.round(result.classificationMs)} ms`,
      );
      report.push({
        name: item.name,
        startupMs: result.startupMs,
        classificationMs: result.classificationMs,
        modules: result.modules.length,
        primary: result.scan.motifs.map((motif) => motif.id),
        loadProgress: result.loadProgress,
      });
    }
    if (process.env.TACTICAL_DEV_WORKER_REPORT)
      writeFileSync(
        process.env.TACTICAL_DEV_WORKER_REPORT,
        JSON.stringify(
          {
            scope:
              "Actual application worker controller with an isolated Vite HTTP graph and Node thread/VM transport. This is not a WebView/CSP or physical UI test.",
            startupDeadlineMs: TACTICAL_WORKER_STARTUP_TIMEOUT_MS,
            classificationDeadlineMs: TACTICAL_CLASSIFICATION_TIMEOUT_MS,
            serverStartupMs: Number(process.env.TACTICAL_DEV_SERVER_STARTUP_MS) || null,
            cases: report,
          },
          null,
          2,
        ),
      );
  },
);
