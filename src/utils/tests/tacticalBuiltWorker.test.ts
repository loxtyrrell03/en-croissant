import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test, vi } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { pawnExposureInput, pawnExposureAlternateInput } from "./fixtures/pawnExposure";
import { compensatedCaptureInput } from "./fixtures/compensatedCapture";
import { forkLocalValueCases } from "./fixtures/forkLocalValue";
import { forkRepairCases } from "./fixtures/forkRepair";
import { checkingExchangeCases } from "./fixtures/checkingExchangeRetention";
import { checkingAlliedRetentionCases, checkingAlliedRetentionLine } from "./fixtures/checkingAlliedRetention";
import { relativePinnedCaptureCases } from "./fixtures/relativePinnedCapture";
import { costlyPawnRecaptureCases, costlyPawnRecaptureInput } from "./fixtures/costlyPawnRecapture";
import { capturingPawnGuardCases, capturingPawnGuardInput } from "./fixtures/capturingPawnGuard";
import { quietRootMateCases } from "./fixtures/quietRootMate";
import { checkingCombinationCases, promotionCaptureForkCases } from "./fixtures/checkingCombinationRecall";
import { mixedForkFen, mixedForkLine, mixedForkControls } from "./fixtures/mixedTargetFork";
import { quietPieceForkCases, quietPieceForkMove } from "./fixtures/quietPieceFork";
import { checkingPawnRetentionCases } from "./fixtures/checkingPawnRetention";
import { checkingPawnHistoryCases } from "./fixtures/checkingPawnHistory";
import { settledPawnHistoryCases } from "./fixtures/settledPawnHistory";
import { countercheckCaptureCases, countercheckCaptureLine } from "./fixtures/checkingCountercheckCapture";
import { shortMatingThreatCases } from "./fixtures/shortMatingThreat";
import { matingCheckEvasionCases } from "./fixtures/matingCheckEvasion";
import { settledRootExchangeCases } from "./fixtures/settledRootExchange";
import { discoveredPinPriorityFen, discoveredPinPriorityLine, discoveredPinPriorityControls } from "./fixtures/discoveredPinPriority";
import { checkingPawnFollowupCases, checkingPawnFollowupLine } from "./fixtures/checkingPawnFollowup";
import { discoveryTrapCases } from "./fixtures/discoveryTrap";
import { perpetualMaterialCases, perpetualMaterialLine } from "./fixtures/perpetualMaterial";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { directThreatFen, directThreatLine, directThreatControls } from "./fixtures/directThreatRelevance";
import { tablebaseCases } from "./fixtures/tablebaseRelevance";
import { drawingCaptureEvidenceCases } from "./fixtures/drawingCaptureEvidence";
import { directMaterialPayoffCases, reflectPayoff } from "./fixtures/directMaterialPayoff";
import { captureGainLiabilityCases, reflectCaptureLiability } from "./fixtures/captureGainLiability";
import { castlingAliasCases } from "./fixtures/castlingRelevance";
import { matingInterferenceCases, reflectMatingInterference } from "./fixtures/matingInterference";
import { counterplayFen, counterplayPreviousFen, counterplayLine } from "./fixtures/tacticalCounterplay";
import { trappedRookFen, trapControls, unrelatedPayoffTrap } from "./fixtures/trapRelevance";
import { interferenceExamples, interferenceControls, compensatedInterference } from "./fixtures/interferenceRelevance";
import { promotionClearanceFen, promotionClearanceLine, promotionClearanceControls } from "./fixtures/promotionClearance";
import { matingMechanismExamples, matingMechanismControls } from "./fixtures/matingMechanismRelevance";
import { promotionCounterplayBase, promotionCounterplayLine, promotionCounterplayEngineLine, pawnRaceRefutations } from "./fixtures/promotionCounterplay";
import {
    buildLiveTacticalScan,
    type LiveTacticalScanInput,
    type LiveTacticalVariationInput,
} from "../tacticalMotifs/liveTactics";
import {
    TACTICAL_CLASSIFICATION_TIMEOUT_MS,
    TACTICAL_WORKER_STARTUP_TIMEOUT_MS,
    classifyLiveTacticsInWorker,
    type TacticalWorkerMessage,
} from "../tacticalMotifs/liveTacticsWorker";

/** Execute the actual Vite artifact with only a browser message bridge. No DOM,
 * Tauri, localStorage or source transpiler is supplied to the worker. */
async function runBuiltWorker(path: string, input: LiveTacticalScanInput) {
    const start = performance.now();
    const bridges: BrowserWorker[] = [];
    class BrowserWorker {
        startedAt: number | null = null;
        termination?: Promise<number>;
        onmessage: ((event: { data: TacticalWorkerMessage }) => void) | null = null;
        onerror: ((event: { message: string }) => void) | null = null;
        onmessageerror: (() => void) | null = null;
        thread = new NodeWorker(
            `
    const { parentPort } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = data => parentPort.postMessage(data);
    import(${JSON.stringify(pathToFileURL(resolve(path)).href)}).then(() => {
      parentPort.on('message', data => globalThis.onmessage({ data }));
    });
  `,
            { eval: true },
        );
        constructor(url: URL, options: WorkerOptions) {
            bridges.push(this);
            expect(url.pathname).toMatch(/liveTactics\.worker\.ts$/);
            expect(options.type).toBe("module");
            this.thread.on("error", (error) => this.onerror?.({ message: error.message }));
            this.thread.on("message", (data: TacticalWorkerMessage) => {
                if ("type" in data && data.type === "started") this.startedAt = performance.now();
                this.onmessage?.({ data });
            });
        }
        postMessage(data: LiveTacticalScanInput) {
            this.thread.postMessage(data);
        }
        terminate() {
            this.termination = this.thread.terminate();
        }
    }
    vi.stubGlobal("Worker", BrowserWorker);
    try {
        const scan = await classifyLiveTacticsInWorker(input, new AbortController().signal);
        const bridge = bridges[0];
        const end = performance.now();
        expect(bridge.startedAt).not.toBeNull();
        expect(bridge.termination).toBeDefined();
        await bridge.termination;
        return {
            scan,
            elapsedMs: end - start,
            startupMs: bridge.startedAt! - start,
            classificationMs: end - bridge.startedAt!,
        };
    } finally {
        vi.unstubAllGlobals();
    }
}

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("capturable counterchecks preserve checking combinations in the compiled worker", async () => {
    for (const row of countercheckCaptureCases) for (const reflected of [false, true]) {
        const input = {fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: reflected ? countercheckCaptureLine.map(reflectMixedForkMove) : countercheckCaptureLine,
            depth: 16, engineName: "Constructed checking-attack mechanism"};
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(!row.proved || (result.scan.motifs[0]?.id === "forcingAttack" && result.scan.motifs[0].ply === 1)).toBe(true);
        expect(!row.proved || result.scan.arrows.every(arrow => arrow.ply === 1)).toBe(true);
        expect(row.id !== "capturable-battery-rook" || !result.scan.motifs.some(m => m.id === "forcingAttack")).toBe(true);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("settled capture chains preserve real pawn opportunities in the compiled worker", async () => {
    for (const row of settledPawnHistoryCases) {
        const input = {...row, depth: 16, engineName: "Constructed history, synthetic selection score",
            variations: [{pvUci: row.pvUci, depth: 16, cp: 100}]};
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs.map(m => m.label)).toEqual(row.positive ? ["Hanging Pawn"] : []);
        expect(result.scan.arrows.every(arrow => arrow.ply === 1)).toBe(true);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("settled root exchange gains survive the production controller", async () => {
    for (const row of settledRootExchangeCases) {
        const input = { ...row, depth: 16, engineName: "Constructed exchange, synthetic selection score",
            variations: [{ depth: 16, pvUci: row.pvUci, cp: 100 }] };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs.find(m => m.id === "hangingPiece")?.value ?? null).toBe(row.gain);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("mating check evasions retain exact certificates in the production controller", async () => {
    for (const row of matingCheckEvasionCases) for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
            engineName: "Constructed mating proof", depth: 16 };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs.some(m => m.id === "mateIn7")).toBe(row.positive);
        expect(!row.positive || JSON.stringify(result.scan.arrows.map(a => a.from + a.to)) === JSON.stringify([input.pvUci[0]])).toBe(true);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("short mating threats retain their actual-ply lesson through the production controller", async () => {
    for (const row of shortMatingThreatCases) for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: [reflected ? reflectMixedForkMove(row.move) : row.move],
            engineName: "Constructed short-threat mechanism", depth: 16 };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs.some(m => m.label === "Mating Attack")).toBe(row.positive);
        expect(!row.positive || (result.scan.motifs[0].value === 130 &&
            result.scan.labels.length === 1 && result.scan.arrows.length === 2)).toBe(true);
    }
});

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("revealed pins retain their discovery headline in the production controller", async () => {
    for (const row of [{fen: discoveredPinPriorityFen, expected: true}, ...discoveredPinPriorityControls.map(row => ({...row, expected: false}))]) {
        for (const reflected of [false, true]) {
            const input = {fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
                pvUci: reflected ? discoveredPinPriorityLine.map(reflectMixedForkMove) : discoveredPinPriorityLine,
                depth: 16, engineName: "Constructed local mechanism, not an engine recommendation"};
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
            expect(result.scan).toEqual(buildLiveTacticalScan(input));
            const discovery = result.scan.motifs.find(m => m.id === "discoveredAttack" && m.confidence === "high");
            expect(discovery ? [result.scan.motifs[0].id, discovery.value] : null).toEqual(row.expected ? ["discoveredAttack", 250] : null);
        }
    }
});

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("checking pawn history retains capture lessons without creating forks in the production controller", async () => {
    for (const input of checkingPawnHistoryCases) {
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs.some(m=>m.id==="hangingPiece" && m.label==="Hanging Pawn")).toBe(input.gain);
        // The sacrifice-recovery control has a separate real king/rook fork;
        // rejecting its generic pawn-gain claim must not erase that tactic.
        expect(result.scan.motifs.some(m=>m.id==="fork")).toBe(input.id.startsWith("checking-sacrifice-recovery"));
    }
},120000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_TARGETED_REPLAY)("targeted candidate scans survive the compiled production controller", async () => {
    const report = JSON.parse(readFileSync(process.env.TACTICAL_TARGETED_REPLAY!, "utf8"));
    expect(report.results.length).toBeGreaterThan(0);
    const observed = [];
    for (const row of report.results) {
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, row.scanInput);
        expect(result.scan).toEqual(buildLiveTacticalScan(row.scanInput));
        expect(result.scan).toEqual(row.scan);
        expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
        observed.push({ id: row.id, startupMs: result.startupMs, classificationMs: result.classificationMs,
            primary: result.scan.motifs.map(m => m.id), extra: result.scan.variations.filter(v => v.origin === "targeted").map(v => v.motifs.map(m => m.id)) });
    }
    if (process.env.TACTICAL_TARGETED_WORKER_REPORT) {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        writeFileSync(privateReportPath(process.env.TACTICAL_TARGETED_WORKER_REPORT), JSON.stringify({
            scope: "Actual compiled worker/controller parity; timings exclude engine, HTTP loading and native UI.",
            workerSha256: createHash("sha256").update(readFileSync(process.env.TACTICAL_BUILT_WORKER!)).digest("hex"),
            replayFrom: process.env.TACTICAL_TARGETED_REPLAY, cases: observed,
        }, null, 2), {flag:"wx"});
    }
    console.log({ count: observed.length, maxStartupMs: Math.max(...observed.map(r => r.startupMs)),
        maxClassificationMs: Math.max(...observed.map(r => r.classificationMs)) });
}, 120000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("costly pawn recaptures survive the production controller", async () => {
    for (const row of costlyPawnRecaptureCases) for (const reflected of [false, true]) {
        const context = costlyPawnRecaptureInput(row);
        const previousFen = reflected ? reflectMixedForkFen(context.previousFen) : context.previousFen;
        const previousMoveUci = reflected ? reflectMixedForkMove(context.previousMoveUci) : context.previousMoveUci;
        const fen = makeFen(replayTacticalLine(previousFen, [previousMoveUci])[0].after.toSetup());
        const pvUci = reflected ? context.pvUci.map(reflectMixedForkMove) : context.pvUci;
        const input = { fen, pvUci, previousFen, previousMoveUci, depth: 16, engineName: "Constructed" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        if (!row.positive) continue;
        expect(scan.motifs[0]).toMatchObject({ id: "hangingPiece", value: 100, ply: 1 });
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("captures by pawn guards retain exposure and compensation through the production controller", async () => {
    for (const row of capturingPawnGuardCases) for (const reflected of [false, true]) {
        const context = capturingPawnGuardInput(row);
        const previousFen = reflected ? reflectMixedForkFen(context.previousFen) : context.previousFen;
        const previousMoveUci = reflected ? reflectMixedForkMove(context.previousMoveUci) : context.previousMoveUci;
        const fen = makeFen(replayTacticalLine(previousFen, [previousMoveUci])[0].after.toSetup());
        const pvUci = reflected ? context.pvUci.map(reflectMixedForkMove) : context.pvUci;
        const input = { fen, previousFen, previousMoveUci, pvUci, depth: 16, engineName: "Constructed" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs.map(m => m.label)).toEqual(row.visible ? ["Hanging Pawn"] : []);
        expect(scan.arrows.every(arrow => arrow.ply === 1)).toBe(true);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("relative pin captures survive the production controller", async () => {
    for (const row of relativePinnedCaptureCases) for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const pvUci = [reflected ? reflectMixedForkMove(row.move) : row.move];
        const input = { fen, pvUci, depth: 16, engineName: "Constructed" };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        if (!row.positive) continue;
        expect(result.scan.motifs[0]).toMatchObject({ id: "pin", ply: 1 });
        expect(result.scan.arrows.every(arrow => arrow.ply === 1)).toBe(true);
    }
}, 60000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("nonchecking root mates survive the production controller without ghost mates", async () => {
    for (const row of quietRootMateCases) for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
            depth: 16, engineName: "Public quiet-mate controls" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs.some(motif => motif.id === "mateIn4")).toBe(row.positive);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_QUIET_ROOT_PRIVATE_REPLAY)("the recovered course mate survives the production controller in both colours", async () => {
    const report = JSON.parse(readFileSync(process.env.TACTICAL_QUIET_ROOT_PRIVATE_REPLAY!, "utf8"));
    const row = report.results.flatMap((group: any) => group.cases).find((item: any) => item.id === "private-easy:153");
    for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: reflected ? row.engineLines[0].pvUci.map(reflectMixedForkMove) : row.engineLines[0].pvUci,
            depth: 16, engineName: "Private course root" };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs[0]).toMatchObject({ id: "mateIn6", ply: 1 });
        expect(result.scan.arrows.every(arrow => arrow.ply === 1)).toBe(true);
        expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("allied checking retention survives the production controller", async () => {
    for (const row of checkingAlliedRetentionCases) for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const pvUci = reflected ? checkingAlliedRetentionLine.map(reflectMixedForkMove) : checkingAlliedRetentionLine;
        const input = { fen, pvUci, variations: [{ pvUci, cp: 0, depth: 16 }], depth: 16, engineName: "Constructed allied retention" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs[0]?.label ?? null).toBe(row.positive ? "Hanging Pawn" : null);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("mixed checking attacks and promotion forks survive the production controller", async () => {
    for (const [kind, rows] of [["forcingAttack", checkingCombinationCases], ["fork", promotionCaptureForkCases]] as const)
        for (const row of rows) for (const reflected of [false, true]) {
            const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
                pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
                depth: 16, engineName: "Constructed checking-combination controls" };
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
            expect(result.scan).toEqual(buildLiveTacticalScan(input));
            expect(result.scan.motifs[0]?.id ?? null).toBe(row.positive ? kind : null);
            expect(result.scan.arrows.every(arrow => arrow.ply === 1)).toBe(true);
        }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("pawn follow-ups and contrary continuations use the production controller", async () => {
    for (const row of checkingPawnFollowupCases) for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const pvUci = reflected ? checkingPawnFollowupLine.map(reflectMixedForkMove) : checkingPawnFollowupLine;
        const input = { fen, pvUci, variations: [{ pvUci, cp: 0, depth: 16 }], depth: 16, engineName: "Constructed pawn follow-up" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs[0]?.label ?? null).toBe(row.positive ? "Hanging Pawn" : null);
        expect(scan.arrows.map(arrow => arrow.ply)).toEqual(row.positive ? [1] : []);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("checking pawn recall and contrary continuations use the production controller", async () => {
    for (const row of checkingPawnRetentionCases) for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const line = reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci;
        const input = { fen, pvUci: line, variations: [{pvUci: line, cp: 0, depth: 16}], depth: 16, engineName: "Constructed checking-pawn controls" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs[0]?.label ?? null).toBe(row.positive ? "Hanging Pawn" : null);
        expect(scan.arrows.map(a => a.ply)).toEqual(row.positive ? [1] : []);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("quiet fork repairs and contrary controls survive the production controller", async () => {
    for (const row of forkRepairCases) for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
            depth: 16, engineName: "Real-game repair and constructed controls" };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs.find(motif => motif.id === "fork")?.value ?? null).toBe(row.positive ? 100 : null);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("equal checking exchanges retain pawns without mating or drawn-trade ghosts", async () => {
    for (const row of checkingExchangeCases) for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
            depth: 16, engineName: "Constructed exchange-retention controls" };
        const request = { ...input, variations: [{ pvUci: input.pvUci, cp: 0, depth: 16 }] };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, request);
        expect(result.scan).toEqual(buildLiveTacticalScan(request));
        expect(result.scan.motifs.some(motif => motif.label === "Hanging Pawn")).toBe(row.positive);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("fork values stay local through the production controller", async () => {
    for (const row of forkLocalValueCases) for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
            depth: 16, engineName: "Constructed fork controls" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        const fork = scan.motifs.find(motif => motif.id === "fork");
        expect(fork?.value ?? null).toBe(row.gain);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("recapture values retain compensation through the production controller", async () => {
    for (const reflected of [false, true]) for (const [previous, expected] of [
        ["r5k1/8/3q4/3B3R/8/8/8/R5K1 b - - 0 1", null],
        ["6k1/8/3q4/3B3R/8/8/8/R5K1 b - - 0 1", 570],
    ] as const) {
        const previousFen = reflected ? reflectMixedForkFen(previous) : previous;
        const moves = reflected ? ["d6d5", "h5d5"].map(reflectMixedForkMove) : ["d6d5", "h5d5"];
        const root = replayTacticalLine(previousFen, moves)[0];
        const input = { fen: makeFen(root.after.toSetup()), previousFen, previousMoveUci: moves[0], pvUci: [moves[1]], depth: 16, engineName: "Constructed recapture controls" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs.find(m => m.id === "hangingPiece")?.value ?? null).toBe(expected);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("saving perpetuals preserve their material mechanisms through the production controller", async () => {
    for (const row of perpetualMaterialCases) for (const reflected of [false, true]) {
        const moves = "move" in row ? [row.move] : perpetualMaterialLine;
        const pvUci = reflected ? moves.map(reflectMixedForkMove) : moves;
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci, variations: [{ pvUci, cp: row.cp }], depth: 16, engineName: "Control" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(row.expected === null || scan.motifs[0]?.id === row.expected).toBe(true);
        expect(scan.motifs.some(m => m.id === "perpetualCheck")).toBe(row.expected === "perpetualCheck");
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("quiet piece forks and countercheck escapes survive the production controller", async () => {
    for (const row of quietPieceForkCases) for (const reflected of [false,true]) {
        const input={fen:reflected?reflectMixedForkFen(row.fen):row.fen,
            pvUci:[reflected?reflectMixedForkMove(quietPieceForkMove):quietPieceForkMove],depth:16,engineName:"Control"};
        const {scan}=await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!,input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs.some(m=>m.id==="fork")).toBe(row.positive);
    }
},30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("discovered traps and safe queen flights survive the production controller", async () => {
    for (const row of discoveryTrapCases) for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: [reflected ? reflectMixedForkMove("e2e4") : "e2e4"], depth: 16, engineName: "Control" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs.some(m => m.id === "discoveredAttack")).toBe(row.positive);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("compensated captures survive the production controller without free-piece claims", async () => {
    for (const [fen, expected] of [
        [compensatedCaptureInput.fen, true],
        [compensatedCaptureInput.fen.replace("2N2N2", "2N5"), false],
        [compensatedCaptureInput.fen.replace("P5PP", "Pb4PP"), false],
    ] as const) {
        const request = {...compensatedCaptureInput, fen, pvUci: ["c3d5"]};
        const {scan} = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, request);
        expect(scan).toEqual(buildLiveTacticalScan(request));
        expect(scan.motifs.some(m => m.label === "Material Gain" && m.value === 90)).toBe(expected);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("exposed pawns and more important alternatives survive the production controller", async () => {
    for (const input of [pawnExposureInput, pawnExposureAlternateInput,
        {...pawnExposureInput,previousFen:undefined,previousMoveUci:undefined}]) {
        const request = {depth:16,engineName:"Constructed control",...input};
        const {scan}=await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!,request);
        expect(scan).toEqual(buildLiveTacticalScan(request));
        expect(scan.motifs.map(m => m.label)).toEqual(!input.previousFen ? [] : ["variations" in input ? "Hanging Piece" : "Hanging Pawn"]);
    }
},30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("branch-dependent quiet mating moves survive the compiled worker boundary", async () => {
    const { branchQuietMateCases, branchQuietMateChoice } = await import("./fixtures/branchQuietMate");
    for (const row of branchQuietMateCases) for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
            depth: 16, engineName: "Constructed" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs[0]?.id).toBe(row.positive ? "mateIn4" : undefined);
        expect(scan.arrows.map(arrow => `${arrow.from}${arrow.to}`)).toEqual(row.positive ? [input.pvUci[0]] : []);
    }
    for (const reflected of [false,true]) {
        const input = {fen:reflected?reflectMixedForkFen(branchQuietMateChoice.fen):branchQuietMateChoice.fen,
            pvUci:reflected?branchQuietMateChoice.shortLine.map(reflectMixedForkMove):branchQuietMateChoice.shortLine,
            depth:16,engineName:"Constructed"};
        const {scan}=await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!,input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs[0]?.id).toBe("mateIn3");
        expect(scan.arrows.map(arrow=>`${arrow.from}${arrow.to}`)).toEqual([input.pvUci[0]]);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("checking pawn preparations survive the compiled worker boundary", async () => {
    const { checkingPawnPreparationCases } = await import("./fixtures/checkingPawnPreparation");
    for (const row of checkingPawnPreparationCases) for (const reflected of [false, true]) {
        const input = { fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
            pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
            depth: 16, engineName: "Constructed" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs.map(m => m.id)).toEqual(row.positive ? ["forcingAttack"] : []);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("complete pawn histories survive the compiled worker boundary", async () => {
    const { persistentPawnCases } = await import("./fixtures/persistentPawnCapture");
    for (const row of persistentPawnCases) {
        const input = { ...row, depth: 16, engineName: "Constructed" };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs.map(m => m.label)).toEqual(row.positive ? ["Hanging Pawn"] : []);
    }
}, 30000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_RECALL_REPLAY)("all owner-game positions retain the actual compiled scan and history", async()=>{
    const baseline=JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!,"utf8"));
    expect(baseline.completed).toBe(baseline.requested ?? baseline.results.length);
    const cases=[];
    for(const row of baseline.results) {
        const input={fen:row.fen,...row.before[0],variations:row.before,engineName:"Stockfish 18",
            previousFen:row.previousFen,previousMoveUci:row.previousMoveUci,tacticalHistory:row.tacticalHistory};
        let result;
        try { result=await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!,input); }
        catch (error) {
            // Keep the exact failing input identity and completed timings when
            // a controller deadline fails; a later passing replay is separate.
            if (process.env.TACTICAL_RECALL_WORKER_REPORT) {
                const {privateReportPath}=await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
                writeFileSync(privateReportPath(process.env.TACTICAL_RECALL_WORKER_REPORT),JSON.stringify({cases,failedId:row.id,error:String(error)},null,2),{flag:"wx"});
            }
            throw new Error(`Owner worker input ${row.id} failed`, {cause:error});
        }
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan).toEqual(row.scan);
        cases.push({id:row.id,...result});
    }
    if(process.env.TACTICAL_RECALL_WORKER_REPORT) {
        const {privateReportPath}=await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        writeFileSync(privateReportPath(process.env.TACTICAL_RECALL_WORKER_REPORT),JSON.stringify({cases},null,2),{flag:"wx"});
    }
// This batch also recomputes every source result. The growing whole-game
// corpus needs a larger aggregate allowance, not a longer worker deadline:
// runBuiltWorker still enforces the production startup/computation bounds.
},300000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("saving captures and drawn-exchange controls survive the actual worker", async () => {
    const report = [];
    for (const row of drawingCaptureEvidenceCases) for (const verified of [false, true]) {
        const input = { fen: row.fen, pvUci: [row.move], engineName: "Stockfish", depth: 16,
            ...(verified ? { tablebaseEvidence: row.evidence } : {}) };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs.some(m => m.id === "drawingCapture")).toBe(verified && row.expected);
        expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
        expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
        report.push({id:`${row.id}:${verified ? "verified" : "local"}`,startupMs:result.startupMs,classificationMs:result.classificationMs,primary:result.scan.motifs.map(m=>m.id)});
    }
    if (process.env.TACTICAL_DRAWING_CAPTURE_WORKER_REPORT) writeFileSync(process.env.TACTICAL_DRAWING_CAPTURE_WORKER_REPORT,JSON.stringify(report,null,2),{flag:"wx"});
}, 120000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("discovered capture mechanisms and additional whole-game contexts survive the production controller", async () => {
    const sample = JSON.parse(readFileSync("benchmarks/tactical-relevance/discovered-capture-development.json", "utf8"));
    const report = [];
    for (const row of sample.cases) for (const reflected of [false, true]) for (const rootOnly of [false, true]) {
        const fields = row.fen.split(" ");
        const mirror = (move: string) => move.replace(/[1-8]/g, rank => String(9 - Number(rank)));
        if (reflected) {
            fields[0] = fields[0].split("/").reverse().join("/").replace(/[a-zA-Z]/g, (c: string) => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
            fields[1] = fields[1] === "w" ? "b" : "w";
        }
        const moves = rootOnly ? [row.root] : row.pvUci;
        const input = { fen: fields.join(" "), pvUci: reflected ? moves.map(mirror) : moves, depth: 16, engineName: "Discovered capture audit" };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
        expect(!row.expectedProof || result.scan.motifs[0].id === "discoveredCheck").toBe(true);
        report.push({ id: `${row.id}:${reflected ? "reflected" : "original"}:${rootOnly ? "root" : "line"}`,
            startupMs: result.startupMs, classificationMs: result.classificationMs, primary: result.scan.motifs.map(m => m.id) });
    }
    const contexts = JSON.parse(readFileSync("benchmarks/tactical-relevance/nature-context-development.json", "utf8"));
    const engine = JSON.parse(readFileSync("benchmarks/tactical-relevance/nature-context-stockfish-18.json", "utf8"));
    for (const row of contexts.cases) {
        const best = engine.searches.find((s: any) => s.id === `${row.id}:best`);
        const reply = engine.searches.find((s: any) => s.id === `${row.id}:reply`);
        for (const [lane, partial] of [
            ["source", { fen: row.fen, pvUci: row.sourceUci, previousFen: row.previousFen, previousMoveUci: row.previousMoveUci }],
            ["best", { fen: row.fen, pvUci: best.lines[0].pvUci, variations: best.lines, previousFen: row.previousFen, previousMoveUci: row.previousMoveUci }],
            ["response", { fen: reply.fen, pvUci: reply.lines[0].pvUci, variations: reply.lines, previousFen: row.fen, previousMoveUci: row.sourceUci[0] }],
        ] as const) {
            const input = { ...partial, depth: 16, engineName: "Whole-game context audit" };
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
            expect(result.scan).toEqual(buildLiveTacticalScan(input));
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
            report.push({ id: `${row.id}:${lane}`, startupMs: result.startupMs,
                classificationMs: result.classificationMs, primary: result.scan.motifs.map(m => m.id) });
        }
    }
    expect(report).toHaveLength(104);
    if (process.env.TACTICAL_DISCOVERY_WORKER_REPORT) writeFileSync(process.env.TACTICAL_DISCOVERY_WORKER_REPORT,
        JSON.stringify({ scope: "Public mechanism controls plus 24 frozen opening/middle/ending game contexts, three input lanes. Source parity is not accuracy and timings exclude engine/UI.", cases: report }, null, 2), { flag: "wx" });
}, 120000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("preparation safety and connected alternatives survive the production controller", async () => {
    const sample = JSON.parse(readFileSync("benchmarks/tactical-relevance/preparation-safety-development.json", "utf8"));
    const report = [];
    for (const row of sample.cases) for (const reflected of [false, true]) for (const rootOnly of [false, true]) {
        const fields = row.fen.split(" ");
        const mirror = (move: string) => move.replace(/[1-8]/g, rank => String(9 - Number(rank)));
        if (reflected) {
            fields[0] = fields[0].split("/").reverse().join("/").replace(/[a-zA-Z]/g, (c: string) => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
            fields[1] = fields[1] === "w" ? "b" : "w";
        }
        const moves = rootOnly ? [row.root] : row.pvUci;
        const input = { fen: fields.join(" "), pvUci: reflected ? moves.map(mirror) : moves, depth: 16, engineName: "Preparation safety" };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
        const theme = row.kind === "quiet" ? "doubleThreat" : "forkPreparation";
        expect(result.scan.motifs.some(m => m.id === theme && m.ply === 1)).toBe(row.expectedProof);
        report.push({ id: `${row.id}:${reflected ? "reflected" : "original"}:${rootOnly ? "root" : "line"}`,
            elapsedMs: result.elapsedMs, startupMs: result.startupMs, classificationMs: result.classificationMs,
            primary: result.scan.motifs.map(m => m.id), matchesSource: true });
    }
    expect(report).toHaveLength(28);
    if (process.env.TACTICAL_PREPARATION_WORKER_REPORT) writeFileSync(process.env.TACTICAL_PREPARATION_WORKER_REPORT,
        JSON.stringify({ scope: "Public preparation controls in both colours, with root-only and longer lines. Source parity is not an accuracy score.", cases: report }, null, 2), { flag: "wx" });
}, 120000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("fixed whole-game boards keep their source, best and actual-response meanings in the production worker", async () => {
    const sample = JSON.parse(readFileSync("benchmarks/tactical-relevance/quiet-game-context-development.json", "utf8"));
    const engine = JSON.parse(readFileSync("benchmarks/tactical-relevance/quiet-game-context-stockfish-18.json", "utf8"));
    const report = [];
    for (const row of sample.cases) {
        const best = engine.searches.find((s: any) => s.id === `${row.id}:best`);
        const reply = engine.searches.find((s: any) => s.id === `${row.id}:reply`);
        const inputs = [
            { fen: row.fen, pvUci: row.sourceUci, previousFen: row.previousFen, previousMoveUci: row.previousMoveUci },
            { fen: row.fen, pvUci: best.lines[0].pvUci, variations: best.lines, previousFen: row.previousFen, previousMoveUci: row.previousMoveUci },
            { fen: reply.fen, pvUci: reply.lines[0].pvUci, variations: reply.lines, previousFen: row.fen, previousMoveUci: row.sourceUci[0] },
        ];
        for (const [index, partial] of inputs.entries()) {
            const input = { ...partial, depth: 16, engineName: "Public game audit" };
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
            expect(result.scan).toEqual(buildLiveTacticalScan(input));
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
            expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
            report.push({ id: row.id, lane: ["source", "best", "response"][index], elapsedMs: result.elapsedMs,
                startupMs: result.startupMs, classificationMs: result.classificationMs, primary: result.scan.motifs.map(m => m.id) });
        }
    }
    expect(report).toHaveLength(63);
    if (process.env.TACTICAL_GAME_WORKER_REPORT) writeFileSync(process.env.TACTICAL_GAME_WORKER_REPORT, JSON.stringify({ scope: "Production controller-worker parity for the 21 new public game contexts. Stability is not accuracy; timings exclude the engine and rendered UI.", cases: report }, null, 2), { flag: "wx" });
}, 120000);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_INTERFERENCE_AUDIT_INPUT)("new private root and secondary mating mechanisms survive the actual controller", async () => {
    const audit = JSON.parse(readFileSync(process.env.TACTICAL_INTERFERENCE_AUDIT_INPUT!, "utf8"));
    const rows = audit.results.flatMap((group: any) => group.cases);
    for (const id of ["private-easy:190", "private-easy:10"]) {
        const row = rows.find((row: any) => row.id === id);
        const input = { fen: row.fen, pvUci: row.engineLines[0].pvUci, variations: row.engineLines, depth: 16, engineName: "Stockfish 18" };
        const { scan } = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(scan).toEqual(buildLiveTacticalScan(input));
        expect(scan.motifs[0].id).toBe(id.endsWith(":190") ? "interference" : "deflection");
        expect(scan.motifs).toHaveLength(1);
        if (id.endsWith(":10") && !scan.variations[0].timeline.some(m => m.id === "forcingAttack" && m.ply === 5))
            throw new Error("Missing independently proved secondary mating threat");
    }
});

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("the fresh promotion PV does not portray sacrifice acceptance as a win", async () => {
    const input = { fen: promotionCounterplayBase, pvUci: promotionCounterplayEngineLine, depth: 16, engineName: "Stockfish 18" };
    const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
    expect(result.scan).toEqual(buildLiveTacticalScan(input));
    expect(result.scan.motifs[0]).toMatchObject({ id: "promotionCombination", ply: 1 });
    expect(result.scan.variations[0].timeline.some((m) => m.id === "hangingPiece" && m.ply === 2)).toBe(false);
    expect(result.scan.variations[0].timeline.find((m) => m.id === "promotion")).toMatchObject({ ply: 11 });
});

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)(
    "cold production workers retain real-position results within the UI deadline",
    async () => {
        const ordinary = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/ordinary-games-stockfish-18.json", "utf8"),
        ) as {
            id: string;
            fen: string;
            beforeFen: string;
            played: string;
            after: LiveTacticalVariationInput[];
        }[];
        ordinary.push(
            ...JSON.parse(readFileSync("benchmarks/tactical-relevance/ordinary-early-stockfish-18.json", "utf8")),
            ...JSON.parse(
                readFileSync(
                    "benchmarks/tactical-relevance/ordinary-adjacent-stockfish-18.json",
                    "utf8",
                ),
            ),
        );
        const expanded = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/expanded-development.json", "utf8"),
        ).cases as {
            id: string;
            startFen: string;
            bestLine: string[];
        }[];
        const drawingCases = JSON.parse(readFileSync("benchmarks/tactical-relevance/drawing-zugzwang-tablebase-verified.json", "utf8")).selected as { id: string; beforeFen: string; moveUci: string; expected: "draw" | "win" | null }[];
        const secondary = JSON.parse(readFileSync("benchmarks/tactical-relevance/secondary-theme-stockfish-18.json", "utf8"));
        const crossPhase=JSON.parse(readFileSync("benchmarks/tactical-relevance/cross-phase-stockfish-18.json","utf8"));
        const broaderGame = JSON.parse(readFileSync("benchmarks/tactical-relevance/broader-game-stockfish-18.json", "utf8"));
        const blackContext = JSON.parse(readFileSync("benchmarks/tactical-relevance/black-context-stockfish-18.json", "utf8"));
        const castles = JSON.parse(readFileSync("benchmarks/tactical-relevance/castling-stockfish-18.json", "utf8"));
        const cases = [
            ...JSON.parse(readFileSync("benchmarks/tactical-relevance/quiet-mate-development.json", "utf8")).cases.flatMap((row: any) => [row, {
                ...row, id: `${row.id}:reflected`, startFen: reflectMatingInterference({ fen: row.startFen, move: row.bestLine[0] }).fen,
                bestLine: row.bestLine.map((move: string) => reflectMatingInterference({ fen: row.startFen, move }).move),
            }].flatMap(example => [1, example.bestLine.length].map(length => ({
                id: `quiet-mate:${example.id}:${length === 1 ? "short" : "full"}`, input: { fen: example.startFen, pvUci: example.bestLine.slice(0, length), depth: 16, engineName: "Frozen unseen game" },
            })))),
            ...JSON.parse(readFileSync("benchmarks/tactical-relevance/quiet-mate-stockfish-18.json", "utf8")).searches.filter((row: any) => row.id.endsWith(":root")).map((row: any) => ({
                id: `quiet-mate-engine:${row.id}`, input: { fen: row.fen, pvUci: row.lines[0].pvUci, variations: row.lines, depth: 16, engineName: "Stockfish 18" },
            })),
            ...JSON.parse(readFileSync("benchmarks/tactical-relevance/mating-interference-stockfish-18.json", "utf8")).searches.filter((row: any) => /:(best|root)$/.test(row.id)).map((row: any) => ({
                id: `mating-interference-engine:${row.id}`, input: { fen: row.fen, pvUci: row.lines[0].pvUci, variations: row.lines, depth: 16, engineName: "Stockfish 18" },
            })),
            ...matingInterferenceCases.flatMap(row => [row, { ...reflectMatingInterference(row), id: `${row.id}:black` }]).map(row => ({
                id: `mating-interference:${row.id}`, input: { fen: row.fen, pvUci: [row.move], depth: 16, engineName: "Mechanism control" },
            })),
            ...castlingAliasCases.map(row => ({ id: `castling-control:${row.id}`, input: { fen: row.fen, pvUci: row.pvUci, depth: 16, engineName: "Castling control" } })),
            ...castles.cases.flatMap((row: any) => [
                { id: `castling-source:${row.id}`, input: { fen: row.fen, pvUci: row.castleLine.pvUci, variations: [row.castleLine], depth: 16, engineName: "Stockfish 18" } },
                { id: `castling-best:${row.id}`, input: { fen: row.fen, pvUci: row.engineLines[0].pvUci, variations: row.engineLines, depth: 16, engineName: "Stockfish 18" } },
                { id: `castling-reply:${row.id}`, input: { fen: row.afterFen, pvUci: row.castleLine.pvUci.slice(1), previousFen: row.fen, previousMoveUci: row.rookUci, depth: 16, engineName: "Stockfish 18 continuation" } },
            ]),
            ...castles.rareSearches.map((row: any) => ({ id: `rare-root:${row.id}`, input: { fen: row.fen, pvUci: row.lines[0].pvUci, variations: row.lines, depth: 16, engineName: "Stockfish 18" } })),
            ...[...directMaterialPayoffCases, ...directMaterialPayoffCases.map(reflectPayoff)].map(row => ({ id: `direct-payoff:${row.id}`, input: { fen: row.fen, pvUci: row.pvUci, depth: 16, engineName: "Public fixture" } })),
            ...blackContext.cases.map((row: any) => ({ id: `black-context:${row.id}`, input: { fen: row.fen, pvUci: row.engineLines[0].pvUci, variations: row.engineLines, depth: 16, engineName: "Stockfish 18", previousFen: row.previousFen, previousMoveUci: row.previousMoveUci } })),
            ...blackContext.responses.map((row: any, index: number) => ({ id: `black-context:${row.id}`, input: { fen: row.fen, pvUci: row.lines[0]?.pvUci ?? [], variations: row.lines, depth: 16, engineName: "Stockfish 18", previousFen: blackContext.cases[index].fen, previousMoveUci: blackContext.cases[index].sourceUci[0] } })),
            ...[
                { id: "root", fen: directThreatFen, pvUci: directThreatLine.slice(0, 1) },
                { id: "continuation", fen: directThreatFen, pvUci: directThreatLine },
                ...directThreatControls.map(row => ({ ...row, pvUci: ["e6e7"] })),
            ].map(({ id, ...input }) => ({ id: `direct-threat:${id}`, input: { ...input, depth: 16, engineName: "Direct threat audit" } })),
            ...JSON.parse(readFileSync("benchmarks/tactical-relevance/checking-pawn-stockfish-18.json", "utf8")).groups.find((g: any) => g.id === "sample").searches.map((row: any) => ({
                id: `checking-capture:${row.id}`,
                input: { fen: row.fen, pvUci: row.lines[0].pvUci, variations: row.lines, depth: 16, engineName: "Stockfish 18" },
            })),
            ...broaderGame.cases.flatMap((row: any, index: number) => {
                const after = broaderGame.responses[index];
                return [
                    { id: `broader-source:${row.id}`, input: { fen: row.fen, pvUci: row.sourceUci, previousFen: row.previousFen, previousMoveUci: row.previousMoveUci, depth: 16, engineName: "Frozen source" } },
                    { id: `broader-engine:${row.id}`, input: { fen: row.fen, pvUci: row.engineLines[0].pvUci, variations: row.engineLines, previousFen: row.previousFen, previousMoveUci: row.previousMoveUci, depth: 16, engineName: "Stockfish 18" } },
                    { id: `broader-response:${row.id}`, input: { fen: after.fen, pvUci: after.lines[0].pvUci, variations: after.lines, previousFen: row.fen, previousMoveUci: row.sourceUci[0], depth: 16, engineName: "Stockfish 18" } },
                ];
            }),
            ...[
                { id: "root", fen: mixedForkFen, pvUci: ["d2f3"] },
                { id: "continuation", fen: mixedForkFen, pvUci: mixedForkLine },
                ...mixedForkControls.map(c => ({ ...c, pvUci: ["d2f3"] })),
            ].map(({ id, ...input }) => ({ id: `mixed-fork:${id}`, input: { ...input, depth: 16, engineName: "Mixed-target fork" } })),
            ...[
                { id: "real", fen: promotionCounterplayBase, historicalLine: promotionCounterplayLine },
                ...pawnRaceRefutations,
            ].flatMap(({ id, fen, historicalLine }) => [1, historicalLine.length].map((length) => ({ id: `promotion-ending:${id}:${length}`, input: { fen, pvUci: historicalLine.slice(0, length), depth: 16, engineName: "Promotion ending counterplay" } }))),
            ...matingMechanismExamples.flatMap(row=>[1,row.pvUci.length].map(length=>({id:`mating-mechanism:${row.id}:${length}`,input:{...row,pvUci:row.pvUci.slice(0,length),depth:16,engineName:"Mating mechanism"}}))),
            ...matingMechanismControls.map(row=>({id:`mating-mechanism:control:${row.id}`,input:{fen:row.fen,pvUci:row.theme==="selfInterference"?matingMechanismExamples[0].pvUci:[matingMechanismExamples[1].pvUci[0]],depth:16,engineName:"Mechanism counterexample"}})),
            ...crossPhase.cases.flatMap((row:any)=>[
                {id:`cross-phase-source:${row.id}`,input:{fen:row.fen,pvUci:row.sourceUci,variations:[{pvUci:row.sourceUci,pvSan:row.sourceSan,cp:row.sourceEngine.cp,mate:row.sourceEngine.mate,depth:16,multipv:1}],depth:16,engineName:"Frozen source",previousFen:row.previousFen,previousMoveUci:row.previousMoveUci}},
                {id:`cross-phase-engine:${row.id}`,input:{fen:row.fen,pvUci:row.engineLines[0].pvUci,variations:row.engineLines,depth:16,engineName:"Stockfish 18",previousFen:row.previousFen,previousMoveUci:row.previousMoveUci}},
            ]),
            ...[
                {id:"promotion-clearance:root",fen:promotionClearanceFen,pvUci:promotionClearanceLine.slice(0,1)},
                {id:"promotion-clearance:continuation",fen:promotionClearanceFen,pvUci:promotionClearanceLine},
                ...promotionClearanceControls.map(c=>({id:`promotion-clearance:control:${c.id}`,fen:c.fen,pvUci:promotionClearanceLine.slice(0,1)})),
            ].map(({id,...input})=>({id,input:{...input,depth:16,engineName:"Promotion clearance"}})),
            ...secondary.cases.flatMap((row: any) => [
                {id: `secondary-source:${row.id}`, input: {fen: row.fen, pvUci: row.sourceUci, depth: 16, engineName: "Frozen source"}},
                {id: `secondary-engine:${row.id}`, input: {fen: row.fen, pvUci: row.engineLines[0].pvUci, variations: row.engineLines, depth: 16, engineName: "Stockfish 18", previousFen: row.previousFen, previousMoveUci: row.previousMoveUci}},
                ...(["lichess:qQG5v", "lichess:sKDBG", "lichess:SD5oo", "lichess:xxDaj"].includes(row.id) ? [{id: `secondary-root:${row.id}`, input: {fen: row.fen, pvUci: row.sourceUci.slice(0, 1), depth: 16, engineName: "Root only"}}] : []),
            ]),
            ...secondary.searches.map((row: any) => ({id: `secondary-probe:${row.id}`, input: {fen: row.fen, pvUci: row.lines[0].pvUci, variations: row.lines, depth: 16, engineName: "Independent decision/control"}})),
            ...[
                { id: "checking-discovery:root-only", fen: "rnbqkbnr/pppp2pp/5p2/4P3/8/2N5/PP2QPPP/R1B1KBNR w KQkq - 0 7", pvUci: ["e5f6"] },
                { id: "checking-discovery:captured-checker", fen: "rnbqkbnr/pppp2pp/5p2/4P3/3n4/2N5/PP2QPPP/R1B1KBNR w KQkq - 0 7", pvUci: ["e5f6"] },
                { id: "checking-discovery:blocked-ray", fen: "rnbqkbnr/pppp2pp/4pp2/4P3/8/2N5/PP2QPPP/R1B1KBNR w KQkq - 0 7", pvUci: ["e5f6"] },
            ].map(({id, ...input}) => ({id, input: {...input, depth: 16, engineName: "Checking-discovery control"}})),
            ...drawingCases.map(row => ({ id: `drawing-audit:${row.id}`, input: { fen: row.beforeFen, pvUci: [row.moveUci], depth: 16, engineName: "Independent tablebase audit" } })),
            { id: "drawing-audit:opposition", input: { fen: "8/2k5/8/8/2K5/2P5/8/8 b - - 0 1", pvUci: ["c7c6", "c4b4", "c6b6"], depth: 16, engineName: "Drawing opposition" } },
            { id: "drawing-audit:reserve-tempo", input: { fen: "8/1k6/8/8/2K5/8/2P5/8 b - - 0 1", pvUci: ["b7c6"], depth: 16, engineName: "Reserve tempo control" } },
            ...[
                { id: "capture-mating-attack:compensated", fen: "6k1/5ppp/8/8/7q/6pb/4B1PP/5RBK w - - 0 1", pvUci: ["g2h3", "h4h3", "f1f2", "g3f2", "g1f2"] },
                { id: "capture-mating-attack:root-only", fen: "6k1/5ppp/8/8/7q/6pb/4B1PP/5RBK w - - 0 1", pvUci: ["g2h3"] },
                { id: "capture-mating-attack:recapture", fen: "6k1/5ppp/8/8/7q/6pP/4B2P/5RBK b - - 0 1", pvUci: ["h4h3"] },
                { id: "capture-mating-attack:surviving-guard", fen: "6k1/5ppp/8/8/7q/4N1pP/4B2P/5RBK b - - 0 1", pvUci: ["h4h3"] },
                { id: "capture-mating-attack:free-bishop", fen: "6k1/5ppp/8/8/7q/7b/4B1PP/5RBK w - - 0 1", pvUci: ["g2h3"] },
                { id: "capture-mating-attack:checking-promotion", fen: "2k5/P4ppp/8/8/7q/6pP/4B2P/5RBK b - - 0 1", pvUci: ["h4h3"] },
            ].map(({ id, fen, pvUci }) => ({ id, input: { fen, pvUci, depth: 16, engineName: "Constructed mating-net reduction" } })),
            ...[
                { id: "quiet-mating-attack:real", fen: "8/pp4k1/3P2p1/8/2PbB2p/6qP/PP6/5Q1K b - - 0 35", pvUci: ["d4e5", "f1g2", "g3e1", "g2g1", "e1e4"] },
                { id: "quiet-mating-attack:root-only", fen: "8/pp4k1/3P2p1/8/2PbB2p/6qP/PP6/5Q1K b - - 0 35", pvUci: ["d4e5"] },
                { id: "quiet-mating-attack:queen-liability", fen: "8/pp4k1/3P2p1/8/2PbB2p/6qP/PP4R1/5Q1K b - - 0 35", pvUci: ["d4e5"] },
                { id: "quiet-mating-attack:checking-deflection", fen: "8/pp4k1/3P2p1/4b3/2P1B2p/6qP/PP4Q1/7K b - - 2 36", pvUci: ["g3e1"] },
                { id: "quiet-mating-attack:payoff", fen: "8/pp4k1/3P2p1/4b3/2P1B2p/7P/PP6/4q1QK b - - 4 37", pvUci: ["e1e4"] },
                { id: "quiet-mating-attack:pin-liability", fen: "8/pp4k1/3P2p1/4b3/2P1q2p/7P/PP4Q1/7K b - - 1 38", pvUci: ["e5b2", "g2e4"] },
                { id: "constructed:checking-discovery-capture", fen: "k7/3q3p/1r6/8/N7/8/8/R5K1 w - - 0 1", pvUci: ["a4b6", "a8b8", "b6d7"] },
            ].map(({id, fen, pvUci}) => ({ id, input: {fen, pvUci, depth: 16, engineName: "Real-game mating-attack regression"} })),
            {
                id: "endgame:claimable-entry",
                input: {
                    fen: "8/8/6k1/8/4p1K1/8/5P2/8 w - - 98 67",
                    pvUci: ["g4f4"], engineName: "Fifty-move boundary", depth: 16,
                },
            },
            {
                id: "endgame:real-pawn-ending-entry",
                input: {
                    fen: "8/8/6k1/8/4p1K1/8/5P2/8 w - - 1 67",
                    pvUci: ["g4f4", "e4e3", "f4e3", "g6f5", "e3f3"],
                    engineName: "Real KPK continuation",
                    depth: 16,
                },
            },
            {
                id: "endgame:exact-zugzwang",
                input: {
                    fen: "8/8/8/5k2/8/4K3/5P2/8 w - - 1 69",
                    pvUci: ["e3f3"], engineName: "Exact KPK", depth: 16,
                },
            },
            {
                id: "endgame:drawn-pawn-ending",
                input: {
                    fen: "8/8/8/5k2/8/5K2/5P2/8 w - - 0 1",
                    pvUci: ["f3g3"], engineName: "Exact KPK", depth: 16,
                },
            },
            {
                id: "endgame:reflected-zugzwang",
                input: {
                    fen: "8/5p2/4k3/8/5K2/8/8/8 b - - 1 69",
                    pvUci: ["e6f6"], engineName: "Exact KPK", depth: 16,
                },
            },
            {
                id: "constructed:guard-deflection-root",
                input: {
                    fen: "2b1r1k1/p1q3b1/8/3P4/3N4/8/8/2BQRBK1 b - - 0 1",
                    pvUci: ["e8e1"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:balanced-exchange-recovery",
                input: {
                    fen: "2b1r1k1/p1q3b1/8/3n4/3NP3/8/8/2BQRBK1 w - - 0 1",
                    pvUci: ["e4d5", "e8e1", "d1e1", "g7d4"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "opening:balanced-later-knight-exchange",
                input: {
                    fen: "r4k1r/pbq1b1pp/1pn5/2pBN3/3P4/4P3/PP3PPP/R1BQ1RK1 b - - 0 13",
                    pvUci: ["c6e5", "d5b7", "c7b7", "d4e5"],
                    engineName: "Reached opening continuation",
                    depth: 16,
                },
            },
            {
                id: "rare:king-interference-exchange-payoff",
                input: {
                    fen: "6R1/5k2/8/5r1p/5p1K/5P2/6P1/8 w - - 10 50",
                    pvUci: ["g8g5", "f5g5", "h4g5", "h5h4", "g5f4"],
                    engineName: "Lichess source branch",
                    depth: 16,
                },
            },
            {
                id: "constructed:knight-interferes-bishop-guard",
                input: {
                    fen: "k7/8/5bN1/8/3pK3/3P4/8/8 w - - 0 1",
                    pvUci: ["g6e5", "f6e5", "e4e5", "a8b7", "e5d4"],
                    engineName: "Constructed material gain, not game result",
                    depth: 16,
                },
            },
            {
                id: "constructed:interference-off-square-knight-liability",
                input: {
                    fen: "6R1/5k2/N7/5r1p/5p1K/5P2/6P1/8 w - - 10 50",
                    pvUci: ["g8g5", "f5f6", "h4h5", "f6a6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mating-rook-liability-discovery",
                input: {
                    fen: "3r2k1/5rb1/1p3n2/3P4/1B1N1R2/8/6PP/5RK1 b - - 0 1",
                    pvUci: ["f6d5"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:queen-countercapture-invalidates-free-knight",
                input: {
                    fen: "4k3/6p1/5N2/8/8/8/3q4/3R2K1 b - - 0 1",
                    pvUci: ["g7f6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "recovered:root-only-exchange-discovery",
                input: {
                    fen: "2kr1br1/pp1n1p2/2p2p1p/q6b/2BNN3/P2Q3P/1PP2PP1/R3R1K1 b - - 0 15",
                    pvUci: ["d7e5"],
                    engineName: "Regression",
                    depth: 16,
                },
            },
            {
                id: "recovered:reflected-root-only-exchange-discovery",
                input: {
                    fen: "r3r1k1/1pp2pp1/p2q3p/2bnn3/Q6B/2P2P1P/PP1N1P2/2KR1BR1 w - - 0 15",
                    pvUci: ["d2e4"],
                    engineName: "Regression",
                    depth: 16,
                },
            },
            {
                id: "constructed:root-mate-over-material-pv",
                input: {
                    fen: "R2r2k1/p4ppp/1p6/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24",
                    pvUci: ["e4e8", "d8e8", "f3d5"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:root-only-queen-offer-mate",
                input: {
                    fen: "8/5r1k/4Npp1/8/3n4/4QP2/PP2q1P1/1KR5 w - - 0 1",
                    pvUci: ["e3h6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mixed-checking-offer",
                input: {
                    fen: "2k4r/pp3p2/1np3q1/2Q3p1/P2R4/4P1P1/5PB1/6K1 w - - 0 1",
                    pvUci: ["g2h3", "c8b8", "c5e5", "g6d6", "e5h8"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:later-fork-labelled-as-continuation",
                input: {
                    fen: "2k4r/1p3p2/2p3q1/P1Q3p1/3R4/8/6B1/6K1 w - - 0 1",
                    pvUci: ["g2h3", "c8b8", "c5e5", "g6d6", "e5h8"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:declined-fork-preparation",
                input: {
                    fen: "3r2k1/p4pp1/2Q2n1p/7q/8/3N4/2P2PPP/R3K3 b - - 0 1",
                    pvUci: ["d8d3", "c2d3", "h5e5", "e1d2", "e5a1"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:captured-fork-defender",
                input: {
                    fen: "3r2k1/p5pp/8/7q/8/3N4/2P3PP/R3K3 b - - 0 1",
                    pvUci: ["d8d3", "c2d3", "h5e5", "e1d2", "e5a1"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:future-promotion-not-root-cause",
                input: {
                    fen: "6k1/p6r/1P6/8/8/8/8/6KR w - - 0 1",
                    pvUci: ["h1h7", "g8h7", "b6a7", "h7g6", "a7a8q"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:capture-to-discovered-check",
                input: {
                    fen: "6r1/1p6/6k1/4R3/4Nr2/8/7P/6K1 b - - 0 1",
                    pvUci: ["f4e4", "e5e4", "g6f5", "g1f2", "f5e4"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:checking-skewer-with-defended-block",
                input: {
                    fen: "4r1rk/4q2p/8/8/8/3BN3/1PP5/R1K5 b - - 0 1",
                    pvUci: ["g8g1", "d3f1", "g1f1", "e3f1", "e7e1"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:cooperative-bishop-offer",
                input: {
                    fen: "5rk1/5q1p/8/8/8/3B1N2/8/6K1 w - - 0 1",
                    pvUci: ["d3h7", "g8h7", "f3g5", "h7h8", "g5f7", "f8f7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:unproved-clearance-offer",
                input: {
                    fen: "6k1/q7/8/8/8/r1P1R3/5B2/6K1 b - - 0 1",
                    pvUci: ["a3c3", "e3c3", "a7a1", "g1h2", "a1c3"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:unresolved-root-retains-later-fork",
                // Historical ID retained: now independently certified by
                // the square-clearing preparation, not a borrowed later fork.
                input: {
                    fen: "5r1k/6pp/8/8/4n3/5NPQ/4Bq1P/4R2K b - - 0 1",
                    pvUci: ["f2e1", "f3e1", "e4f2", "h1g2", "f2h3", "e1f3", "f8f3", "e2f3", "h3g5"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:fork-square-already-empty-control",
                input: {
                    fen: "5r1k/6pp/8/8/4n3/5NPQ/3qB2P/4R2K b - - 0 1",
                    pvUci: ["d2e1", "f3e1", "e4f2", "h1g2", "f2h3"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:root-only-cleared-fork-square",
                input: {
                    fen: "5r1k/6pp/8/8/4n3/5NPQ/4Bq1P/4R2K b - - 0 1",
                    pvUci: ["f2e1"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:shared-mating-route",
                input: {
                    fen: "4r1rk/4q2p/5n1Q/8/3n4/3B3R/3K4/8 w - - 0 1",
                    pvUci: ["h6f6", "e7f6", "h3h7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:countercapture-and-delayed-fork",
                input: {
                    fen: "8/4r1p1/p2k4/1bN5/5K2/5P2/6P1/1R6 w - - 0 1",
                    pvUci: ["c5a6", "g7g5", "f4g3", "b5a6", "b1b6", "d6d7", "b6a6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:pawn-square-clearance-fork",
                input: {
                    fen: "4k3/7r/8/8/6pN/4r1P1/5RPK/8 b - - 0 1",
                    pvUci: ["h7h4", "g3h4", "g4g3", "h2g1", "g3f2", "g1f2"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:immediate-alternative-after-cycle",
                input: {
                    fen: "6k1/2r2Npp/2q1P3/3n4/8/6Q1/5PPP/3R1RK1 w - - 0 1",
                    pvUci: ["f7h6", "g8h8", "h6f7", "h8g8", "d1d5", "c6d5", "g3c7"],
                    variations: [
                        {
                            multipv: 1,
                            cp: 420,
                            pvUci: ["f7h6", "g8h8", "h6f7", "h8g8", "d1d5", "c6d5", "g3c7"],
                        },
                        { multipv: 2, cp: 413, pvUci: ["d1d5", "c6d5", "g3c7"] },
                    ],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:combined-defender-removal",
                input: {
                    fen: "6k1/2r2ppp/2q5/3n4/8/6Q1/5PPP/3R1RK1 w - - 0 1",
                    pvUci: ["d1d5", "c6d5", "g3c7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "regression:connected-pin-entry",
                input: {
                    fen: "2r2rk1/pp4pp/1n3p2/3p4/3qp1N1/6Q1/P1P3PP/1N2R2K w - - 4 21",
                    pvUci: ["g4h6"],
                    engineName: "Regression",
                    depth: 16,
                },
            },
            {
                id: "constructed:incidental-pin-check-cycle",
                input: {
                    fen: "6k1/5Npp/8/8/8/2r3Q1/8/6K1 w - - 0 1",
                    pvUci: ["f7h6", "g8h8", "h6f7", "h8g8", "g3c3", "g7g6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:exchange-deflection",
                input: {
                    fen: "4r1k1/3q1pbp/6p1/3Q4/8/5P2/P5PP/R2R2K1 b - - 0 1",
                    pvUci: ["e8e1", "d1e1", "d7d5"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mating-king-acceptance",
                input: {
                    fen: "5r1k/7p/4B3/4NpP1/8/3Q3R/8/6K1 w - - 0 1",
                    pvUci: ["h3h7", "h8h7", "d3h3", "h7g7", "h3h6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:discovery-backed-fork",
                input: {
                    fen: "3r1nk1/2q3p1/2nppb1p/8/2P1PPQ1/2N5/1B4PP/5R1K w - - 0 1",
                    pvUci: ["c3d5", "e6d5", "b2f6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mating-capture",
                input: {
                    fen: "4b2k/7p/5q2/8/8/6R1/8/4R1K1 w - - 0 1",
                    pvUci: ["e1e8", "f6f8", "e8f8"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:two-minors-for-rook",
                input: {
                    fen: "2k5/1pq5/6Q1/P1n5/8/Rb6/5PPP/6K1 w - - 0 1",
                    pvUci: ["a3b3", "c5b3", "g6e6", "c8b8", "e6b3"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mate-backed-fork",
                input: {
                    fen: "3qkb1r/5p1b/4p1pp/4N3/2B5/6N1/4QPPP/6K1 w k - 0 1",
                    pvUci: ["e5f7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:perpetual-check",
                input: {
                    fen: "r6k/5Q1p/6p1/8/q7/8/8/5R1K w - - 0 1",
                    pvUci: ["f7f6", "h8g8", "f6f7", "g8h8", "f7f6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:reinforced-pin",
                input: {
                    fen: "1r5k/6pp/8/3b4/8/2Q2R2/8/7K b - - 0 1",
                    pvUci: ["b8f8"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:blocking-defender-deflection",
                input: {
                    fen: "3q3k/8/8/3B4/7n/5P2/3R4/7K b - - 0 1",
                    pvUci: ["h4f3", "d5f3", "d8d2"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:quiet-capture-fork-preparation",
                input: {
                    fen: "8/p7/7k/4p3/2n5/2B5/5Q1P/6K1 w - - 0 1",
                    pvUci: ["c3e5", "c4e5", "f2f4", "h6h7", "f4e5"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            ...[
                {
                    id: "constructed:quiet-pawn-fork-preparation",
                    fen: "5bk1/5ppp/8/8/3pr3/8/2RRN3/7K b - - 0 1",
                    pvUci: ["e4e2", "d2e2", "d4d3"],
                },
                {
                    id: "constructed:quiet-pawn-fork-checking-escape",
                    fen: "6k1/5ppp/8/8/3pr3/8/2RRN3/7K b - - 0 1",
                    pvUci: ["e4e2", "d2e2", "d4d3"],
                },
                {
                    id: "constructed:quiet-pawn-fork-extra-defender",
                    fen: "5bk1/5ppp/6B1/8/3pr3/8/2RRN3/7K b - - 0 1",
                    pvUci: ["e4e2", "d2e2", "d4d3"],
                },
            ].map(({ id, ...input }) => ({
                id,
                input: { ...input, engineName: "Constructed", depth: 16 },
            })),
            ...[
                {
                    id: "constructed:accepted-fork-sacrifice",
                    fen: "8/8/6k1/5qpr/4N3/8/8/K6Q w - - 0 1",
                    offer: "h1h5",
                    acceptance: "g6h5",
                },
                {
                    id: "constructed:accepted-mating-sacrifice",
                    fen: "5rnk/6pp/4Q2N/8/8/8/8/K7 w - - 0 1",
                    offer: "e6g8",
                    acceptance: "f8g8",
                },
            ].map((item) => ({
                id: item.id,
                input: {
                    fen: makeFen(replayTacticalLine(item.fen, [item.offer])[0].after.toSetup()),
                    previousFen: item.fen,
                    previousMoveUci: item.offer,
                    pvUci: [item.acceptance],
                    engineName: "Constructed",
                    depth: 16,
                },
            })),
            {
                id: "constructed:capturing-fork-preparation",
                input: {
                    fen: "8/8/6k1/5qpr/4N3/8/8/K6Q w - - 0 1",
                    pvUci: ["h1h5", "g6h5", "e4g3"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mating-deflection-declined",
                input: {
                    fen: "8/3Q4/6pp/5n1k/2B1N1pq/8/3B4/6K1 w - - 0 1",
                    pvUci: ["d7f5", "h4g5", "d2g5"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:fork-backed-by-checking-recapture",
                input: {
                    fen: "3r2qk/6pr/5p1P/8/4N3/2B5/5PPP/5RK1 w - - 0 1",
                    pvUci: ["e4f6", "g7f6", "c3f6", "h7g7", "f6g7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:defender-removing-fork-preparation",
                input: {
                    fen: "8/5pkp/6p1/2p5/2Rp4/3Q4/1q4PP/6BK w - - 0 1",
                    pvUci: ["c4d4", "c5d4", "g1d4"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:queen-capture-over-incidental-pin",
                input: {
                    fen: "8/4R1pk/5q2/8/8/8/1B6/6K1 w - - 0 1",
                    pvUci: ["b2f6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:exchange-for-discovery-attraction",
                input: {
                    fen: "6k1/8/1qp5/5b2/Q1P1n3/2N5/1P3PP1/6K1 w - - 0 1",
                    pvUci: ["c3e4", "f5e4", "c4c5", "b6c5", "a4e4"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:quiet-mating-deflection-exchange",
                input: {
                    fen: "4r2k/5rp1/6qp/3PB3/4Q2n/3R4/6PP/4R1K1 b - - 0 1",
                    pvUci: ["e8e5", "e4h4", "e5e1", "h4e1", "g6d3"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:mate-independent-of-fork-victim",
                input: {
                    fen: "1n5k/7p/5q2/8/8/6R1/8/4R1K1 w - - 0 1",
                    pvUci: ["e1e8", "f6f8", "e8f8"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:knight-exchange-for-pawn",
                input: {
                    fen: "3qk2r/8/8/4N3/2BP4/8/PPP2PPP/R4RK1 w k - 0 1",
                    pvUci: ["e5f7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "constructed:bishop-exchange-for-pawn",
                input: {
                    fen: "4k2r/8/8/6B1/6N1/2q4P/PPP2P2/R4RK1 w k - 0 1",
                    pvUci: ["g5f6"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "ordinary-3:protected-discovery-payoff",
                input: {
                    fen: "rn3r1k/ppp1pq1p/3pNp2/5p2/3P4/1BN1P3/PPP2PPP/2KR3R w - - 6 14",
                    pvUci: ["e6c7", "f7g7", "c7a8"],
                    engineName: "Stockfish 18 audited continuation",
                    depth: 16,
                },
            },
            {
                id: "screenshot:f7-alternatives",
                input: {
                    fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
                    pvUci: ["e5f7", "d8e8", "f7h8"],
                    engineName: "Regression",
                    depth: 16,
                    variations: [
                        { multipv: 1, pvUci: ["e5f7", "d8e8", "f7h8"], cp: 460 },
                        { multipv: 2, pvUci: ["c4f7", "e8f8", "f7b3"], cp: 350 },
                    ],
                },
            },
            {
                id: "balanced-defender-recapture",
                input: {
                    fen: "3q2k1/4bppp/5n2/3p2B1/8/2N2N2/2Q2PPP/6K1 b - - 0 1",
                    pvUci: ["f6e4", "c3e4", "d5e4", "g5e7", "d8e7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "incidental-pawn-discovery",
                input: {
                    fen: "2r2rk1/p2n2pp/B7/2p5/3P4/Q4b2/6PP/2R1K2R w - - 0 1",
                    pvUci: ["a6c8", "f8c8", "a3a7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            {
                id: "balanced-defender-history",
                input: {
                    fen: makeFen(
                        replayTacticalLine("3q2k1/4bppp/5n2/3p2B1/8/2N2N2/2Q2PPP/6K1 b - - 0 1", [
                            "f6e4",
                            "c3e4",
                        ])[1].after.toSetup(),
                    ),
                    previousFen: makeFen(
                        replayTacticalLine("3q2k1/4bppp/5n2/3p2B1/8/2N2N2/2Q2PPP/6K1 b - - 0 1", [
                            "f6e4",
                        ])[0].after.toSetup(),
                    ),
                    previousMoveUci: "c3e4",
                    pvUci: ["d5e4", "g5e7", "d8e7"],
                    engineName: "Constructed",
                    depth: 16,
                },
            },
            ...[
                {id: "mating-clearance:real", fen: "8/8/2k1B3/2b4r/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 3 34", pvUci: ["c5e3", "f2e3", "h5c5", "e6c4", "c5c4", "c1b1", "e2d3"]},
                {id: "mating-clearance:root-only", fen: "8/8/2k1B3/2b4r/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 3 34", pvUci: ["c5e3"]},
                {id: "mating-clearance:declined", fen: "8/8/2k1B3/2b4r/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 3 34", pvUci: ["c5e3", "c1b1", "e2d3"]},
                {id: "mating-clearance:claimable-draw", fen: "8/8/2k1B3/2b4r/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 98 34", pvUci: ["c5e3", "f2e3", "h5c5", "e6c4", "c5c4", "c1b1", "e2d3"]},
                {id: "mating-clearance:line", fen: "8/8/8/8/3b3r/1p1k4/1Bb5/KR1n4 b - - 0 1", pvUci: ["d4b2", "b1b2", "h4a4", "b2a2", "a4a2"]},
                {id: "mating-clearance:double-check", fen: "7k/5b2/6P1/8/7B/8/8/K6R w - - 0 1", pvUci: ["h4f6", "h8g8", "h1h8"]},
            ].map(({id, ...input}) => ({id, input: {...input, engineName: "Regression", depth: 16}})),
            ...[
                { id: "trap-audit:root-only", fen: trappedRookFen, pvUci: ["g1f2"] },
                { id: "trap-audit:defender-removal", fen: trappedRookFen, pvUci: ["g1f2", "e7g5", "e4g5", "h6g5", "f2e3"] },
                ...trapControls.map(c => ({id: `trap-audit:control:${c.id}`, fen: c.fen, pvUci: ["g1f2"]})),
                {id: "trap-audit:control:unrelated-payoff", ...unrelatedPayoffTrap},
            ].map(({id, ...input}) => ({id, input: {...input, engineName: "Trap audit", depth: 16}})),
            ...[
                ...interferenceExamples.flatMap(item => [
                    {id: `interference-audit:root:${item.id}`,fen:item.fen,pvUci:item.pvUci.slice(0,1)},
                    {id: `interference-audit:recovery:${item.id}`,fen:item.fen,pvUci:[item.pvUci[0],item.reply,item.answer]},
                ]),
                ...interferenceControls.map(item => ({id:`interference-audit:control:${item.id}`,fen:item.fen,pvUci:[item.move]})),
                {id:"interference-audit:compensated",...compensatedInterference},
            ].map(({id,...input})=>({id,input:{...input,engineName:"Interference audit",depth:16}})),
            ...[0, 9, 18].map((index) => ({
                id: `counterplay:${index}`,
                input: {
                    fen: index === 0 ? counterplayFen : makeFen(replayTacticalLine(counterplayFen, counterplayLine)[index].before.toSetup()),
                    pvUci: counterplayLine.slice(index),
                    ...(index === 0 ? { previousFen: counterplayPreviousFen, previousMoveUci: "d6b4" } : {}),
                    engineName: "Generated engine game", depth: 16,
                },
            })),
            ...[
                { id: "ray-liability:pin", fen: "r5k1/1p6/8/8/7q/7P/8/3Q3K w - - 0 1", pvUci: ["d1d5"] },
                { id: "ray-liability:pin-safe", fen: "r5k1/1p6/8/8/7q/8/8/3Q2K1 w - - 0 1", pvUci: ["d1d5"] },
                { id: "ray-liability:mate", fen: "r3r1k1/1p6/8/8/8/8/5PPP/3Q2K1 w - - 0 1", pvUci: ["d1d5"] },
                { id: "ray-liability:skewer", fen: "r7/6k1/8/q7/8/1R6/1P5Q/5nK1 w - - 0 1", pvUci: ["b3a3"] },
                { id: "ray-liability:mating-decline", fen: "1k6/7r/8/5q2/2B5/8/2P2PPP/6K1 w - - 0 1", pvUci: ["c4d3"] },
                { id: "ray-liability:checking-recovery", fen: "r7/8/8/k7/8/1R6/1P5Q/5nK1 w - - 0 1", pvUci: ["b3a3"] },
                { id: "ray-liability:drawing-rescue", fen: "8/7q/8/5k2/2B5/8/8/6K1 w - - 0 1", pvUci: ["c4d3"] },
                { id: "ray-liability:same-victim", fen: "8/p1pR1pk1/1p2r3/4n3/2P1K3/4P1PP/3Q4/8 b - - 0 38", pvUci: ["e5c4"] },
                { id: "ray-liability:separate-victim", fen: "8/p2R1pk1/1p2r3/1p2n2b/2P1K3/6PP/3QP3/8 b - - 0 1", pvUci: ["e5c4"] },
            ].map(({ id, ...input }) => ({ id, input: { ...input, engineName: "Ray regression", depth: 16 } })),
            ...ordinary.map((row) => ({
                id: row.id,
                input: {
                    fen: row.fen,
                    ...row.after[0],
                    depth: row.after[0].depth ?? 16,
                    variations: row.after,
                    engineName: "Stockfish 18",
                    previousFen: row.beforeFen,
                    previousMoveUci: makeUci(
                        parseSan(
                            Chess.fromSetup(parseFen(row.beforeFen).unwrap()).unwrap(),
                            row.played,
                        )!,
                    ),
                },
            })),
            ...expanded.map((row) => ({
                id: row.id,
                input: {
                    fen: row.startFen,
                    pvUci: row.bestLine,
                    engineName: "Source line",
                    depth: 16,
                },
            })),
        ];
        cases.push(...tablebaseCases.map(row => ({
            id: `tablebase:${row.id}`,
            input: { fen: row.fen, pvUci: [row.move], engineName: "Tablebase fixture", depth: 16, tablebaseEvidence: row.evidence },
        })));
        const report = [];
        const rayResults = new Map<string, ReturnType<typeof buildLiveTacticalScan>>();
        const drawingResults = new Map<string, ReturnType<typeof buildLiveTacticalScan>>();
        const discoveryResults = new Map<string, ReturnType<typeof buildLiveTacticalScan>>();
        const secondaryResults = new Map<string, ReturnType<typeof buildLiveTacticalScan>>();
        const trapResults = new Map<string, ReturnType<typeof buildLiveTacticalScan>>();
        const interferenceResults = new Map<string, ReturnType<typeof buildLiveTacticalScan>>();
        const promotionResults = new Map<string, ReturnType<typeof buildLiveTacticalScan>>();
        const matingMechanismResults = new Map<string, ReturnType<typeof buildLiveTacticalScan>>();
        const promotionEndingResults = new Map<string, ReturnType<typeof buildLiveTacticalScan>>();
        for (const item of cases) {
            // A fresh worker never inherits the in-process proof caches.
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, item.input);
            const expected = buildLiveTacticalScan(item.input);
            expect({ id: item.id, scan: result.scan }).toEqual({ id: item.id, scan: expected });
            if (item.id.startsWith("tablebase:")) {
                const row = tablebaseCases.find(row => item.id === `tablebase:${row.id}`)!;
                if (result.scan.motifs.some(m => m.id === "zugzwang") !== row.expectedZugzwang)
                    throw new Error(`Independent tablebase judgement failed: ${row.id}`);
            }
            if (item.id.startsWith("direct-payoff:")) {
                const row = [...directMaterialPayoffCases, ...directMaterialPayoffCases.map(reflectPayoff)].find(row => item.id === `direct-payoff:${row.id}`)!;
                if (result.scan.motifs[0]?.id !== row.theme || result.scan.variations[0].timeline.find(m => m.ply === 3)?.label !== row.label)
                    throw new Error(`Material mechanism/payoff judgement failed: ${row.id}`);
            }
            if (item.id.startsWith("mating-interference:")) {
                const positive = item.id.includes("rook-interposition");
                if (result.scan.variations[0].timeline.some(m => m.label === "Mating Interference") !== positive ||
                    (positive && (result.scan.motifs.length !== 1 || result.scan.motifs[0].id !== "mateIn3")))
                    throw new Error(`Independent mating-interference judgement failed: ${item.id}`);
            }
            if (item.id.startsWith("quiet-mate:") || item.id.startsWith("quiet-mate-engine:")) {
                const mateIn2 = /06PHz|0XwFD|0iAUN/.test(item.id), mateIn3 = /0IJ6I|09Cf3|0hHGN/.test(item.id);
                const matingAttack = /0rcU4|0QPvf/.test(item.id), newAttack = item.id.includes("0z5nl");
                if (JSON.stringify(result.scan.motifs.map(m => m.id)) !== JSON.stringify(mateIn2 ? ["mateThreat"] : mateIn3 ? ["mateIn3"] : matingAttack ? [item.input.pvUci.length >= 7 ? "mateIn4" : "forcingAttack"] : newAttack ? ["forcingAttack"] : []))
                    throw new Error(`Quiet mating primary or retained coverage gap changed: ${item.id}`);
                if (item.id.includes("0hHGN") && result.scan.variations[0].timeline.some(m => m.id === "fork" && m.ply === 1))
                    throw new Error(`Mate-backed material fork noise: ${item.id}`);
            }
            if (item.id.startsWith("castling-control:")) {
                const row = castlingAliasCases.find(row => item.id === `castling-control:${row.id}`)!;
                if (row.mate) {
                    const expectedArrows = [[row.pvUci[0].slice(0, 2), row.kingTo], [row.rookFrom, row.rookTo]];
                    if (JSON.stringify(result.scan.motifs.map(m => m.id)) !== JSON.stringify(["mateIn1"]) ||
                        JSON.stringify(result.scan.arrows.map(a => [a.from, a.to])) !== JSON.stringify(expectedArrows) ||
                        result.scan.labels[0].square !== row.kingTo)
                        throw new Error(`Castling mate geometry failed: ${row.id}`);
                } else if (row.id.includes("check-not-mate") && result.scan.motifs.length)
                    throw new Error(`Single rook check became a false tactic: ${row.id}`);
            }
            if (item.id === "castling-reply:castle:MHuRInPi:10:h" && result.scan.motifs[0]?.id !== "hangingPiece")
                throw new Error("Castling away from the loose bishop must expose the opponent's capture");
            if (item.id.startsWith("promotion-ending:")) promotionEndingResults.set(item.id, result.scan);
            if (item.id.startsWith("secondary-source:")) secondaryResults.set(item.id, result.scan);
            if (item.id.startsWith("trap-audit:")) trapResults.set(item.id, result.scan);
            if (item.id.startsWith("interference-audit:")) interferenceResults.set(item.id,result.scan);
            if (item.id.startsWith("promotion-clearance:")) promotionResults.set(item.id,result.scan);
            if (item.id.startsWith("mating-mechanism:")) matingMechanismResults.set(item.id,result.scan);
            if (item.id === "counterplay:9" && result.scan.variations[0].timeline.some((motif) => motif.id === "skewer"))
                throw new Error("The built worker advertised the mating-trap skewer payoff");
            if (item.id.startsWith("ray-liability:")) rayResults.set(item.id, result.scan);
            if (item.id.startsWith("drawing-audit:")) drawingResults.set(item.id, result.scan);
            if (item.id.startsWith("checking-discovery:") || item.id === "ordinary-2:ply12")
                discoveryResults.set(item.id, result.scan);
            expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
            report.push({
                id: item.id,
                elapsedMs: result.elapsedMs,
                startupMs: result.startupMs,
                classificationMs: result.classificationMs,
                primary: result.scan.motifs.map((m) => m.id),
                matchesSource: true,
            });
        }
        expect(report).toHaveLength(808);
        for (const length of [1, promotionCounterplayLine.length]) expect(promotionEndingResults.get(`promotion-ending:real:${length}`)!.motifs[0]).toMatchObject({ id: "promotionCombination", value: 220 });
        expect(promotionEndingResults.get("promotion-ending:real:5")!.variations[0].timeline.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
        for (const row of pawnRaceRefutations) for (const length of [1, row.historicalLine.length]) expect(promotionEndingResults.get(`promotion-ending:${row.id}:${length}`)!.motifs.some((m) => m.id === "promotionCombination")).toBe(false);
        for(const row of matingMechanismExamples)for(const length of [1,row.pvUci.length]){
            const scan=matingMechanismResults.get(`mating-mechanism:${row.id}:${length}`)!;
            expect(scan.motifs.map(m=>m.id)).toEqual([row.id==="49h84"?"mateIn2":"mateIn3"]);
            expect(scan.labels.some(l=>l.id==="selfInterference")).toBe(false);
        }
        expect(matingMechanismResults.get("mating-mechanism:qY3NM:5")!.arrows.map(a=>[a.from,a.to])).toEqual([["f3","f6"],["e1","e6"]]);
        expect(matingMechanismResults.get("mating-mechanism:49h84:3")!.variations[0].timeline.find(m=>m.id==="selfInterference")).toMatchObject({ply:2,actor:"black",relevance:"secondary"});
        for(const row of matingMechanismControls){
            const scan=matingMechanismResults.get(`mating-mechanism:control:${row.id}`)!;
            expect(scan.variations[0].timeline.some(m=>row.theme==="selfInterference"?m.id==="selfInterference":m.id==="deflection"&&m.verifiedCombination)).toBe(false);
        }
        for(const mode of ["root","continuation"]){
            const scan=promotionResults.get(`promotion-clearance:${mode}`)!;
            expect(scan.motifs[0]).toMatchObject({id:"clearance",label:"Promotion Clearance",value:500});
            expect(scan.labels.map(l=>l.id)).toEqual(["clearance"]);
            expect(scan.arrows.map(a=>[a.from,a.to])).toEqual([["c6","c7"],["b6","c6"]]);
        }
        expect(promotionResults.get("promotion-clearance:continuation")!.variations[0].timeline.map(m=>[m.ply,m.label,m.value])).toEqual([[1,"Promotion Clearance",500],[5,"Fork",500],[7,"Fork Payoff",undefined],[8,"Countercapture",0],[9,"Promotion",undefined]]);
        for(const control of promotionClearanceControls)expect(promotionResults.get(`promotion-clearance:control:${control.id}`)!.motifs.some(m=>m.label==="Promotion Clearance")).toBe(false);
        for(const item of interferenceExamples) for(const mode of ["root","recovery"]){
            const scan=interferenceResults.get(`interference-audit:${mode}:${item.id}`)!;
            expect(scan.motifs[0]).toMatchObject({id:"interference",ply:1,value:item.gain});
            expect(scan.labels.map(label=>label.id)).toEqual(["interference"]);
            expect(scan.arrows.some(arrow=>arrow.to===(item.id==="DBBd9"?"f5":"d3"))).toBe(false);
        }
        for(const item of interferenceControls)
            expect(interferenceResults.get(`interference-audit:control:${item.id}`)!.motifs.some(m=>m.id==="interference")).toBe(false);
        expect(interferenceResults.get("interference-audit:compensated")!.motifs[0]).toMatchObject({id:"interference",value:400});
        for (const id of ["root-only", "defender-removal"]) {
            const result = trapResults.get(`trap-audit:${id}`)!;
            expect(result.motifs[0]).toMatchObject({id: "trappedPiece", ply: 1, value: 180});
            expect(result.labels.map(label => label.id)).toEqual(["trappedPiece"]);
            expect(result.arrows.some(arrow => arrow.to === "g5")).toBe(false);
        }
        for (const id of [...trapControls.map(c => c.id), "unrelated-payoff"])
            expect(trapResults.get(`trap-audit:control:${id}`)!.motifs.some(m => m.id === "trappedPiece")).toBe(false);
        const selfInterference = secondaryResults.get("secondary-source:lichess:qQG5v")!;
        expect(selfInterference.motifs[0].id).toBe("mateIn3");
        expect(selfInterference.variations[0].timeline.find(m => m.id === "selfInterference")).toMatchObject({ply: 4, actor: "black", relevance: "secondary"});
        const backRank = secondaryResults.get("secondary-source:lichess:SD5oo")!;
        expect(backRank.motifs[0].id).toBe("mateIn2");
        expect(backRank.labels.map(label => label.id)).toEqual(["mateIn2", "xRayAttack"]);
        for (const id of ["checking-discovery:root-only", "ordinary-2:ply12"]) {
            const scan = discoveryResults.get(id)!;
            expect(scan.motifs[0]).toMatchObject({ id: "discoveredCheck", value: 320, ply: 1 });
            expect(scan.labels[0].text).toContain("Discovered Check");
            expect(scan.arrows.some(arrow => arrow.from === "c1" || arrow.from === "f1")).toBe(false);
        }
        for (const id of ["checking-discovery:captured-checker", "checking-discovery:blocked-ray"])
            expect(discoveryResults.get(id)!.motifs.some(motif => motif.id === "discoveredCheck")).toBe(false);
        for (const row of drawingCases)
            expect(drawingResults.get(`drawing-audit:${row.id}`)!.motifs.find(m => m.id === "zugzwang")?.label ?? null).toBe(row.expected === "draw" ? "Drawing Zugzwang" : row.expected === "win" ? "Zugzwang" : null);
        expect(drawingResults.get("drawing-audit:opposition")!.motifs[0]).toMatchObject({ id: "zugzwang", label: "Drawing Zugzwang", value: 0 });
        expect(drawingResults.get("drawing-audit:opposition")!.labels[0]).toMatchObject({ text: "Drawing Zugzwang", square: "c4" });
        expect(drawingResults.get("drawing-audit:reserve-tempo")!.motifs.some(m => m.id === "zugzwang")).toBe(false);
        for (const id of ["ray-liability:pin", "ray-liability:mate", "ray-liability:skewer", "ray-liability:mating-decline", "ray-liability:same-victim"])
            expect(rayResults.get(id)!.motifs.some(m => ["pin", "skewer"].includes(m.id))).toBe(false);
        expect(rayResults.get("ray-liability:separate-victim")!.motifs[0]).toMatchObject({ id: "discoveredCheck", value: 680 });
        expect(rayResults.get("ray-liability:separate-victim")!.variations[0].timeline.find(m => m.id === "skewer")).toMatchObject({ value: 100, relevance: "secondary" });
        expect(Object.fromEntries(report.filter(item => ["ray-liability:pin-safe", "ray-liability:drawing-rescue", "ray-liability:same-victim"].includes(item.id)).map(item => [item.id, item.primary]))).toEqual({
            "ray-liability:pin-safe": ["pin"], "ray-liability:drawing-rescue": ["skewer"], "ray-liability:same-victim": ["discoveredCheck"],
        });
        expect(Object.fromEntries(report.filter((item) => item.id.startsWith("counterplay:")).map((item) => [item.id, item.primary]))).toEqual({
            "counterplay:0": [], "counterplay:9": ["forkPreparation"], "counterplay:18": ["trappedPiece"],
        });
        expect(Object.fromEntries(report.filter((item) => item.id.startsWith("capture-mating-attack:")).map((item) => [item.id, item.primary]))).toMatchObject({
            "capture-mating-attack:compensated": [],
            "capture-mating-attack:root-only": [],
            "capture-mating-attack:recapture": ["forcingAttack"],
            "capture-mating-attack:surviving-guard": [],
            "capture-mating-attack:free-bishop": ["hangingPiece"],
            "capture-mating-attack:checking-promotion": [],
        });
        expect(Object.fromEntries(report.filter((item) => item.id.startsWith("quiet-mating-attack:")).map((item) => [item.id, item.primary]))).toMatchObject({
            "quiet-mating-attack:real": ["forcingAttack"],
            "quiet-mating-attack:root-only": ["forcingAttack"],
            "quiet-mating-attack:queen-liability": [],
            "quiet-mating-attack:checking-deflection": ["deflection"],
            "quiet-mating-attack:pin-liability": [],
        });
        if (process.env.TACTICAL_WORKER_REPORT)
            writeFileSync(
                process.env.TACTICAL_WORKER_REPORT,
                JSON.stringify(
                    {
                        scope: "Actual application worker controller with cold production JS worker import, classification and structured transfer on this Node host. Separate startup and computation deadlines; excludes engine search and does not prove WebView or physical UI latency.",
                        deadlineMs: TACTICAL_CLASSIFICATION_TIMEOUT_MS,
                        startupDeadlineMs: TACTICAL_WORKER_STARTUP_TIMEOUT_MS,
                        cases: report,
                    },
                    null,
                    2,
                ),
            );
    },
    120000,
);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)("capture liabilities and sound deflection payoffs survive the production worker", async () => {
    const reports = [];
    const controls = [...captureGainLiabilityCases, ...captureGainLiabilityCases.map(reflectCaptureLiability)];
    for (const row of controls) {
        const input = {fen:row.fen,pvUci:[row.move],depth:16,engineName:"Liability control"};
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!,input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs.find(m => m.id === "hangingPiece")?.label).toBe(row.label);
        expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
        reports.push({id:row.id,classificationMs:result.classificationMs,startupMs:result.startupMs,primary:result.scan.motifs.map(m=>m.id)});
    }
    const original = {id:"quiet-deflection",fen:"4r2k/5rp1/6qp/3PB3/4Q2n/3R4/6PP/4R1K1 b - - 0 1",move:"e8e5",gain:330,label:"Deflection"};
    for (const reflected of [false,true]) {
        const row = reflected ? reflectCaptureLiability(original) : original;
        for (const [kind,line] of [["root",["e8e5"]],["direct",["e8e5","e4h4","g6d3"]],["unsound-exchange",["e8e5","e4h4","e5e1","h4e1","g6d3"]]] as const) {
            const input = {fen:row.fen,pvUci:line.map(m => reflected ? m.replace(/[1-8]/g,r=>String(9-Number(r))) : m),depth:16,engineName:"Deflection control"};
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!,input);
            expect(result.scan).toEqual(buildLiveTacticalScan(input));
            expect(result.scan.motifs[0]?.id).toBe("deflection");
            const timeline = result.scan.variations[0].timeline;
            expect(kind !== "direct" || timeline.some(m => m.ply === 3 && m.label === "Deflection Payoff" && m.value === undefined)).toBe(true);
            expect(kind !== "unsound-exchange" || !timeline.some(m=>m.ply === 5 && m.id === "hangingPiece")).toBe(true);
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
            reports.push({id:`${row.id}:${kind}`,classificationMs:result.classificationMs,startupMs:result.startupMs,primary:result.scan.motifs.map(m=>m.id)});
        }
    }
    if (process.env.TACTICAL_CAPTURE_WORKER_REPORT) writeFileSync(process.env.TACTICAL_CAPTURE_WORKER_REPORT,JSON.stringify({cases:reports},null,2),{flag:"wx"});
},120000);

test.skipIf(
    !process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_PRIVATE_MATING_OVERLAP_REPORT,
)("the real reached checking skewer survives the built worker boundary", async () => {
    const report = JSON.parse(
        readFileSync(process.env.TACTICAL_PRIVATE_MATING_OVERLAP_REPORT!, "utf8"),
    );
    const row = report.searches.find((s: { id: string }) => s.id === "real-missed-alternative");
    const steps = replayTacticalLine(row.fen, row.lines[0].pvUci);
    const input = {
        fen: makeFen(steps[0].after.toSetup()),
        pvUci: row.lines[0].pvUci.slice(1),
        engineName: "Stockfish 18",
        depth: 16,
    };
    const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
    expect(result.scan).toEqual(buildLiveTacticalScan(input));
    expect(result.scan.motifs[0]).toMatchObject({ id: "skewer", value: 500 });
    expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
    expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
});

for (const { name, path, count } of [
    { name: "original", path: process.env.TACTICAL_PRIVATE_PGN_REPORT, count: 24 },
    { name: "third", path: process.env.TACTICAL_PRIVATE_THIRD_REPORT, count: 24 },
    { name: "fourth", path: process.env.TACTICAL_PRIVATE_FOURTH_REPORT, count: 24 },
    { name: "positional", path: process.env.TACTICAL_PRIVATE_POSITIONAL_REPORT, count: 42 },
    {
        name: "positional-middle",
        path: process.env.TACTICAL_PRIVATE_POSITIONAL_MIDDLE_REPORT,
        count: 21,
    },
    {
        name: "positional-quarter",
        path: process.env.TACTICAL_PRIVATE_POSITIONAL_QUARTER_REPORT,
        count: 21,
    },
    { name: "positional-upper-quarter", path: process.env.TACTICAL_PRIVATE_POSITIONAL_UPPER_QUARTER_REPORT, count: 21 },
    { name: "engine-games-wide", path: process.env.TACTICAL_PRIVATE_ENGINE_GAMES_REPORT, count: 24 },
    { name: "positional-hash", path: process.env.TACTICAL_PRIVATE_POSITIONAL_HASH_REPORT, count: 21 },
]) {
    test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !path)(
        `the ${name} disjoint sample retains full source and live timelines through the worker`,
        async () => {
            const report = JSON.parse(readFileSync(path!, "utf8"));
            expect(report.cases).toHaveLength(count);
            const exchangeChecks: { index: number; primary: string[]; recovery: boolean }[] = [];
            for (const row of report.cases) {
                const inputs: LiveTacticalScanInput[] = [
                    {
                        fen: row.fen,
                        pvUci: row.engineLines[0].pvUci,
                        variations: row.engineLines,
                        previousFen: row.previousFen,
                        previousMoveUci: row.previousMoveUci,
                        engineName: "Stockfish 18",
                        depth: 16,
                    },
                    {
                        fen: row.fen,
                        pvUci: row.sourceUci,
                        previousFen: row.previousFen,
                        previousMoveUci: row.previousMoveUci,
                        engineName: "Private source continuation",
                        depth: 16,
                    },
                ];
                if (name === "positional-quarter" && row.id === "private-corpus:501") {
                    const reached = replayTacticalLine(row.fen, row.sourceUci).at(-1)!;
                    const moves = ["e4d5", "e8e1", "d1e1", "g7d4"];
                    const steps = replayTacticalLine(makeFen(reached.after.toSetup()), moves);
                    if (steps.length !== 4) throw new Error("Incomplete private exchange fixture");
                    inputs.push(
                        {
                            fen: makeFen(steps[0].before.toSetup()),
                            pvUci: moves,
                            engineName: "Private exchange temptation",
                            depth: 16,
                        },
                        {
                            fen: makeFen(steps[1].before.toSetup()),
                            pvUci: moves.slice(1),
                            engineName: "Private guard deflection",
                            depth: 16,
                        },
                    );
                }
                for (const [index, input] of inputs.entries()) {
                    const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
                    expect({ id: row.id, scan: result.scan }).toEqual({
                        id: row.id,
                        scan: buildLiveTacticalScan(input),
                    });
                    expect(result.classificationMs).toBeLessThan(
                        TACTICAL_CLASSIFICATION_TIMEOUT_MS,
                    );
                    expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
                    if (index >= 2)
                        exchangeChecks.push({
                            index,
                            primary: result.scan.motifs.map((motif) => motif.id),
                            recovery: result.scan.variations[0].timeline.some(
                                (motif) =>
                                    motif.label === "Material Recovery" &&
                                    motif.ply === 4 &&
                                    motif.value === 0,
                            ),
                        });
                }
            }
            expect(exchangeChecks).toEqual(
                name === "positional-quarter"
                    ? [
                          { index: 2, primary: [], recovery: true },
                          { index: 3, primary: ["deflection"], recovery: false },
                      ]
                    : [],
            );
        },
        120000,
    );
}

test.skipIf(!process.env.TACTICAL_BUILT_WORKER)(
    "rare real-game themes and secondary interference survive the production worker",
    async () => {
        const fixture = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/rare-theme-development.json", "utf8"),
        );
        const observed: { id: string; primary: string | undefined; secondary: boolean }[] = [];
        for (const row of fixture.cases) {
            const input = {
                fen: row.startFen,
                pvUci: row.bestLine,
                engineName: "Real-game source",
                depth: 16,
            };
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
            expect({ id: row.id, scan: result.scan }).toEqual({
                id: row.id,
                scan: buildLiveTacticalScan(input),
            });
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
            expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
            observed.push({
                id: row.id,
                primary: result.scan.motifs[0]?.id,
                secondary: result.scan.variations[0].timeline.some(
                    (m) => m.id === "selfInterference" && m.ply === 2,
                ),
            });
        }
        expect(observed.find((row) => row.id === "lichess:zYjb5")).toEqual({
            id: "lichess:zYjb5",
            primary: "interference",
            secondary: true,
        });
    },
    120000,
);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "the private recovered themes survive the built worker boundary",
    async () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        for (const [id, theme, value] of [
            ["private-easy:135", "discoveredAttack", 250],
            ["private-easy:145", "fork", 80],
            ["private-easy:68", "pin", 100],
            ["private-easy:77", "forkPreparation", 100],
            ["private-easy:97", "forkPreparation", 280],
            ["private-easy:87", "forkPreparation", 90],
            ["private-easy:173", "forkPreparation", 100],
            ["private-easy:10", "deflection", 320],
            ["private-easy:212", "fork", 180],
            ["private-easy:49", "forkPreparation", 100],
            ["private-easy:193", "deflection", 100],
            ["private-easy:58", "attraction", 100],
            ["private-easy:202", "deflection", 150],
        ] as const) {
            const row = sample.cases.find((item: { id: string }) => item.id === id);
            const input = {
                fen: row.fen,
                pvUci: row.sourceUci,
                engineName: "Private course source",
                depth: 16,
            };
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
            expect(result.scan).toEqual(buildLiveTacticalScan(input));
            expect(result.scan.motifs[0]).toMatchObject({ id: theme, value });
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
            expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
        }
    },
    // Aggregate batch allowance; every individual worker still has the
    // unchanged application startup and classification deadlines above.
    120000,
);

test.skipIf(!process.env.TACTICAL_BUILT_WORKER || !process.env.TACTICAL_PRIVATE_DISJOINT_REPORT)(
    "the disjoint fresh-engine sample survives the built worker boundary",
    async () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_REPORT!, "utf8"),
        );
        expect(report.cases).toHaveLength(24);
        for (const row of report.cases) {
            const input = {
                fen: row.fen,
                pvUci: row.engineLines[0].pvUci,
                variations: row.engineLines,
                engineName: "Stockfish 18",
                depth: 16,
            };
            const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
            expect({ id: row.id, scan: result.scan }).toEqual({
                id: row.id,
                scan: buildLiveTacticalScan(input),
            });
            expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
            expect(result.startupMs).toBeLessThan(TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
        }
        // The quiet sacrifice is still unproved. Verify the independently
        // reached drawing check instead of counting the source root recovered.
        const draw = report.cases.find(
            (row: { eligibleIndex: number }) => row.eligibleIndex === 11,
        );
        const steps = replayTacticalLine(draw.fen, draw.sourceUci);
        const input = {
            fen: makeFen(steps[4].before.toSetup()),
            pvUci: [steps[4].uci],
            variations: [{ pvUci: [steps[4].uci], cp: 0 }],
            engineName: "Stockfish 18",
            depth: 16,
        };
        const result = await runBuiltWorker(process.env.TACTICAL_BUILT_WORKER!, input);
        expect(result.scan).toEqual(buildLiveTacticalScan(input));
        expect(result.scan.motifs[0]).toMatchObject({ id: "perpetualCheck", value: 0 });
        expect(result.classificationMs).toBeLessThan(TACTICAL_CLASSIFICATION_TIMEOUT_MS);
    },
    120000,
);
