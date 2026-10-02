/** Tiny actual-source checks. All solver imports/workers used by admission
 * checks are injected doubles. Retained replay uses exactSwiss:null only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { createRequire } from "node:module";

import { calculatePairingForecast, formatForecastPercent, tournamentPhaseLabel } from "../src/features/tournaments/pairingForecast.ts";
import { normalizeTournamentResults } from "../src/features/tournaments/normalizeTournamentResults.ts";
import { isValidTournamentTargetRound, hasAuthoritativeTournamentCompletion } from "../src/features/tournaments/tournamentRoundMetadata.ts";
import { pairingEstimateHelp } from "../src/features/tournaments/pairingScoreHelp.ts";
import { completedForecastHeading } from "../src/features/tournaments/completedForecastHeading.ts";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = resolve(ROOT, "src/features/tournaments");
const hash = (v: any) => createHash("sha256").update(typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v)).digest("hex");
const args = process.argv.slice(2), option = (name: string) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const baseline = option("--baseline"), output = option("--out"), novelty = option("--novelty");
assert(baseline && output && novelty && args.length === 6, "Use --baseline RETAINED_STRUCTURAL_RUN --out NEW_RECEIPT.json --novelty SOURCE_ROOT");
const referenceRequire = createRequire(resolve(novelty, "package.json"));
const ts = (await import(pathToFileURL(referenceRequire.resolve("typescript")).href)).default;
const fixturePath = resolve(novelty, "src/features/tournaments/tests/publishedTarget.fixtures.ts");
const { publishedTargetCases } = await import(pathToFileURL(fixturePath).href);
assert(!existsSync(output), "Receipt path must be new");
const read = (name: string) => readFileSync(resolve(baseline, name));
const manifest = JSON.parse(read("manifest.json").toString("utf8"));
const completion = JSON.parse(read("completion.json").toString("utf8"));
const baselineHashes = Object.fromEntries(["inputs.json", "rows.json", "manifest.json"].map(name => [name, hash(read(name))]));
assert.deepEqual(baselineHashes, Object.fromEntries(Object.keys(baselineHashes).map(name => [name, completion.files[name]])));
const inputs = JSON.parse(read("inputs.json").toString("utf8")), oldRows = JSON.parse(read("rows.json").toString("utf8"));
const priorPath = resolve(novelty, "docs/benchmarks/pairing-2026-10-02/structural-stress/published-target-verification.json");
const priorIndex = JSON.parse(readFileSync(priorPath, "utf8"));
const priorRef = priorIndex.receipts.at(-1);
assert.equal(hash(readFileSync(priorRef.path)), priorRef.sha256);
const priorFindings = JSON.parse(readFileSync(priorRef.path, "utf8")).findings;
const prior = priorFindings[0];
assert.equal(prior.changed.length, 7);
const beforeByKey = new Map(oldRows.map((r: any) => [`${r.case}:${r.player}`, r.forecast]));
for (const row of prior.changed) beforeByKey.set(row.key, row.after);
const knownCaveatCopies = [["Inferred from starting numbers, not a published pairing. A different draw or round order changes this opponent; no probability has been validated.","Predicted from the players’ starting numbers. A different schedule could change the opponent; the organiser has not confirmed this pairing."],["Inferred from standard Berger numbering; the organizer has not published this pairing.","Predicted from the players’ starting numbers. The organiser has not confirmed this pairing."]];
const knownHelpCopies = [["Before round one, Novelty has no validated probability for this field. Candidates follow assumed pairing rules; final entries and organiser settings can change them.","Before round one, no validated probability is available for this field. Candidates follow assumed pairing rules; final entries and organiser settings can change them."]];
for (const [key, value] of beforeByKey) {
  const row: any = value;
  const mapping = knownHelpCopies.find(([reference]) => row.help === reference);
  if (mapping) beforeByKey.set(key, { ...row, help: mapping[1] });
}
const samePath = (a: string, b: string) => process.platform === "win32"
  ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
const matchingPrior = priorFindings.find((finding: any) => samePath(finding.root, novelty));
assert(matchingPrior, "No verified Novelty structural reference");
const copyOverlay = matchingPrior?.mirrorCopyDifferences ?? [];
for (const row of copyOverlay) {
  const forecast: any = beforeByKey.get(row.key);
  assert(forecast, `Unknown overlay row ${row.key}`);
  assert.equal(forecast.caveat, row.referenceCaveat, `Copy overlay reference changed ${row.key}`);
  beforeByKey.set(row.key, { ...forecast, caveat: row.mirrorCaveat });
}
const baselineOverlay = { referenceRoot: prior.root, matchingRoot: matchingPrior?.root ?? null,
  priorAssignmentChanges: prior.changed.length, copyDifferenceCount: copyOverlay.length, copyOverlaySHA256: hash(copyOverlay) };
const sourceBaseline = { kind: "shared-structural-reference-with-native-import-adaptation", root: matchingPrior.root, targetRoot: ROOT,
  receiptPath: priorRef.path, receiptSHA256: priorRef.sha256, sourceHashesSHA256: hash(matchingPrior.sourceHashes),
  copyPolicy: "Known pre-existing opening help branding is mapped explicitly. Existing round-robin caveat differences are retained; all numerical/state/heading fields must match." };
const require = referenceRequire;
const runtimeFiles = [fixturePath, require.resolve("typescript/package.json"), require.resolve("typescript")];
const runtimeReferences = runtimeFiles.map(path => ({ path, sha256: hash(readFileSync(path)), bytes: readFileSync(path).byteLength }));

const edited = ["tournamentRoundMetadata.ts", "normalizeTournamentResults.ts", "pairingForecast.ts", "usePairingForecast.ts",
  "exactSwissForecastClient.ts", "exactSwissForecast.ts", "sampledSwissForecast.ts", "pairingHistoryReliability.ts",
  "exactSwissForecast.worker.ts", "TournamentPrepModal.tsx"];
const sourcePaths = [...new Set([...Object.keys(manifest.sourceHashes).filter(p => p.startsWith("src/")),
  ...edited.map(p => `src/features/tournaments/${p}`)])].sort();
const sourceHashes = () => Object.fromEntries(sourcePaths.map(p => [p, hash(readFileSync(resolve(ROOT, p)))]));
const beforeSources = sourceHashes();
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
let checks = 0, groups = 0, mockWorkers = 0, mockFieldCalls = 0;
const nativeCopyDifferences: any[] = [];
const check = (fn: () => void) => { fn(); checks++; };
const eq = (a: any, b: any, label?: string) => check(() => assert.deepEqual(a, b, label));
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const test = async (name: string, run: () => any) => { await run(); groups++; controls.push(name); console.log(`PASS ${name}`); };
const fixture = (id = "stale-complete-pending") => structuredClone(inputs.find((r: any) => r.id === id).snapshot);
const pack = (s: any, f: any) => ({ kind: f.kind, round: f.round, confidence: f.confidence,
  candidates: f.candidates.map((c: any) => ({ id: c.player.startNumber, p: c.probability, color: c.color, board: c.board,
    displayText: f.kind === "estimated" ? formatForecastPercent(c.probability) : null, reasons: c.reasons })),
  other: f.otherProbability, otherDisplayText: f.kind === "estimated" ? formatForecastPercent(f.otherProbability) : null,
  summary: f.summary, caveat: f.caveat, help: pairingEstimateHelp(s, f), heading: f.kind === "complete" ? completedForecastHeading(f) : null });
const modules = { isValidTournamentTargetRound, hasAuthoritativeTournamentCompletion };
const trip = () => { throw new Error("BEYOND_ADMISSION"); };
const dependencies = new Proxy({}, { get: () => trip });
/** Execute one actual TS module with explicit injected imports. No external
 * solver is imported and the client receives a fake Worker constructor. */
function load(name: string, imports: Record<string, any> = {}, globals: Record<string, any> = {}, source?: string) {
  const path = resolve(DIR, name);
  const text = (source ?? readFileSync(path, "utf8")).replaceAll("import.meta.url", JSON.stringify(pathToFileURL(path).href));
  const result = ts.transpileModule(text, { fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} as any };
  vm.runInNewContext(result.outputText, { module, exports: module.exports, URL, setTimeout, clearTimeout, queueMicrotask,
    require: (id: string) => /tournamentRoundMetadata(?:\.ts)?$/.test(id) ? modules : imports[id] ?? dependencies,
    ...globals }, { filename: path });
  return module.exports;
}
function poisoned(round: any) {
  const value: any = { totalRounds: 3, nextRound: round };
  for (const key of ["players", "pairings", "format", "incompletePairingRounds"]) Object.defineProperty(value, key, { get: trip });
  return value;
}
const changed: any[] = [], controls: any[] = [];
const began = performance.now();
let failure: string | null = null;
try {
  await test("positive bounded integer target; zero total is unknown; backcasts remain independent", () => {
    for (const round of [-1, 0, .5, NaN, Infinity, -Infinity, 4, Number.MAX_SAFE_INTEGER + 1, undefined, "2"]) eq(isValidTournamentTargetRound({ totalRounds: 3 }, round), false);
    for (const totalRounds of [-1, .5, NaN, Infinity]) eq(isValidTournamentTargetRound({ totalRounds }, 1), false);
    for (const round of [1, 2, 3]) eq(isValidTournamentTargetRound({ totalRounds: 3 }, round), true);
    eq(isValidTournamentTargetRound({ totalRounds: 0 }, 4), true);
    // Predicate only. Unknown totals impose no invented tournament ceiling;
    // this huge integer is deliberately never passed to a forecast/worker.
    eq(isValidTournamentTargetRound({ totalRounds: 0 }, 2 ** 32), true);
    eq(isValidTournamentTargetRound({ totalRounds: 3, nextRound: 3 } as any, 2), true);
  });

  await test("retained 391 synthetic states: only twelve metadata states change beyond prior assignment fix", () => {
    const expected = new Set(["stale-complete-pending", "next-zero", "next-beyond-total"].flatMap(id => [1, 2, 3, 4].map(p => `${id}:${p}`)));
    for (const item of inputs) {
      const snapshot = freeze(structuredClone(item.snapshot)), inputHash = hash(snapshot), effective = normalizeTournamentResults(snapshot);
      eq(normalizeTournamentResults(structuredClone(effective)), effective, `${item.id}: serialized normalization`);
      for (const player of item.selected) {
        const key = `${item.id}:${player}`, old = oldRows.find((r: any) => r.case === item.id && r.player === player);
        eq(inputHash, old.inputSHA256);
        const metadata = Object.fromEntries(["phase", "totalRounds", "completedRound", "publishedRound", "liveRound", "nextRound"].map(k => [k, (effective as any)[k]]));
        eq(metadata, item.id === "stale-complete-pending" ? { ...old.effectiveMetadata, phase: "round-in-progress" } : old.effectiveMetadata);
        const forecast = pack(effective, calculatePairingForecast(snapshot, player, { exactSwiss: null }));
        if (expected.has(key)) {
          if (item.id === "stale-complete-pending") {
            eq(forecast, beforeByKey.get(`final-live:${player}`));
            eq(tournamentPhaseLabel(snapshot), "Round 3 in progress");
          } else { eq(forecast.kind, "unavailable"); eq(forecast.round, null); eq(forecast.candidates, []); }
          changed.push({ key, before: beforeByKey.get(key), after: forecast,
            effectiveMetadata: Object.fromEntries(["phase", "nextRound", "liveRound"].map(k => [k, (effective as any)[k]])) });
        } else {
          const expected: any = beforeByKey.get(key);
          if (forecast.caveat !== expected.caveat && snapshot.format === "round-robin") {
            eq(knownCaveatCopies.find(([reference]) => reference === expected.caveat)?.[1], forecast.caveat, key + ": unreviewed caveat");
            nativeCopyDifferences.push({ key, reference: expected.caveat, actual: forecast.caveat });
            eq({ ...forecast, caveat: null }, { ...expected, caveat: null }, key);
          } else eq(forecast, expected, key);
        }
        eq(hash(snapshot), inputHash);
        check(() => assert.equal(normalizeTournamentResults(effective), effective));
      }
    }
    eq(new Set(changed.map(r => r.key)), expected);
    eq(oldRows.length, 391);
  });

  await test("published assignment integrity and priority remain unchanged", () => {
    for (const item of publishedTargetCases()) for (const player of item.selected) {
      const source = freeze(structuredClone(item.snapshot));
      const f = calculatePairingForecast(source, player, { exactSwiss: null });
      eq(f.kind, item.kind, item.id);
      eq(calculatePairingForecast({ ...source, pairings: [...source.pairings].reverse() }, player, { exactSwiss: null }), f);
      if (item.opponent !== undefined) eq(f.candidates.map(c => c.player.startNumber), item.opponent === null ? [] : [item.opponent]);
    }
    const source = fixture(); source.nextRound = 3; source.players[0].active = false; source.players[0].notPairedRounds = [3];
    source.pairings[0].decided = false;
    for (const format of ["swiss", "team", "other"]) {
      const f = calculatePairingForecast({ ...source, format }, 1, { exactSwiss: null });
      eq(f.kind, "confirmed"); eq(f.round, 3); eq(f.candidates[0].player.startNumber, 3);
    }
  });

  await test("phase repair preserves live markers, explicit target, completed authority and absent evidence", () => {
    const pending = fixture(), normalized = normalizeTournamentResults(freeze(pending));
    eq([normalized.phase, normalized.liveRound, normalized.nextRound], ["round-in-progress", 3, null]);
    const noLive = { ...fixture(), liveRound: null };
    eq([normalizeTournamentResults(noLive).phase, normalizeTournamentResults(noLive).nextRound], ["pairings-published", 3]);
    const partial = fixture(); partial.liveRound = null; partial.pairings.at(-1).decided = true; partial.pairings.at(-1).result = "1-0";
    eq(normalizeTournamentResults(partial).phase, "round-in-progress");
    const nonfinal = { ...fixture(), totalRounds: 5 };
    eq(normalizeTournamentResults(nonfinal).nextRound, 4);
    const unknownTotal = { ...fixture(), totalRounds: 0 };
    eq(normalizeTournamentResults(unknownTotal).nextRound, 4);
    const absent = { ...fixture(), pairings: [] };
    eq(normalizeTournamentResults(absent), absent); eq(normalizeTournamentResults(absent).phase, "complete");
    const completed = fixture("complete-authoritative"); eq(normalizeTournamentResults(completed), completed);
    for (const reported of [0, 1, 2]) {
      const live = fixture("final-live"); live.pairings.filter((p: any) => p.round === 3).forEach((p: any, i: number) => { p.decided = i < reported; p.result = i < reported ? "1-0" : null; });
      const f = calculatePairingForecast(live, 1, { exactSwiss: null });
      eq(f.summary, "Round 3 is the final round"); eq(completedForecastHeading(f), f.summary);
    }
    for (const invalid of [0, 4, .5, NaN]) {
      const source = { ...fixture(), nextRound: invalid };
      check(() => assert.equal(normalizeTournamentResults(source).nextRound, invalid));
      eq(calculatePairingForecast(source, 1, { exactSwiss: null }).kind, "unavailable");
    }
    const demoted = fixture(); demoted.pairings.filter((p: any) => p.round === 3).forEach((p: any) => { p.decided = true; p.result = "adjourned"; });
    eq([normalizeTournamentResults(demoted).phase, normalizeTournamentResults(demoted).liveRound, normalizeTournamentResults(demoted).nextRound], ["pairings-published", null, 3]);
    eq(calculatePairingForecast(demoted, 1, { exactSwiss: null }).kind, "confirmed");
  });

  await test("invalid targets stop every direct numerical entry before field access", () => {
    const exact = load("exactSwissForecast.ts"), sampled = load("sampledSwissForecast.ts"), history = load("pairingHistoryReliability.ts");
    for (const round of [0, -1, .5, 4, NaN, Infinity]) {
      const s = poisoned(round);
      eq(calculatePairingForecast(s, 1, { exactSwiss: null }).kind, "unavailable");
      eq(exact.calculateExactSwissForecast(s, round, 1), null);
      eq(sampled.calculateSampledSwissForecast(s, round, 1), null);
      eq(history.historicalPairingReliability(s, round), undefined);
    }
    for (const [module, name] of [[exact, "calculateExactSwissForecast"], [sampled, "calculateSampledSwissForecast"], [history, "historicalPairingReliability"]] as const) {
      check(() => assert.throws(() => module[name]({ totalRounds: 5, nextRound: 5, format: "swiss" }, 3, 1), /BEYOND_ADMISSION/));
    }
  });

  await test("hook and client admissions use the target predicate; mocked Worker only", async () => {
    const hookSource = readFileSync(resolve(DIR, "usePairingForecast.ts"), "utf8") + "\nexport { shouldCalculateExact };";
    const hook = load("usePairingForecast.ts", {}, {}, hookSource);
    for (const round of [0, -1, .5, 4, NaN, Infinity]) eq(hook.shouldCalculateExact({ totalRounds: 3, nextRound: round, format: "swiss" }, 1), false);
    class FakeWorker {
      listeners: Record<string, Function> = {};
      constructor() { mockWorkers++; }
      addEventListener(name: string, fn: Function) { this.listeners[name] = fn; }
      postMessage(value: any) { queueMicrotask(() => this.listeners.message({ data: { id: value.id, forecasts: { 1: null } } })); }
      terminate() {}
    }
    const client = load("exactSwissForecastClient.ts", { "./exactSwissForecast": { swissPairingSystemFor: () => "dutch" } }, { Worker: FakeWorker });
    for (const round of [0, -1, .5, 4, NaN, Infinity]) eq(await client.requestExactSwissForecast(poisoned(round), round, 1), null);
    eq(mockWorkers, 0);
    const historical = fixture("next-zero"); historical.nextRound = 3;
    eq(await client.requestExactSwissForecast(historical, 2, 1), null); eq(mockWorkers, 1);
  });

  await test("whole-field worker handler declines invalid target before roster allocation", () => {
    let handler: Function | undefined; const posts: any[] = [];
    load("exactSwissForecast.worker.ts", { "./sampledSwissForecast": { calculateSampledSwissForecast: () => { mockFieldCalls++; return null; } } },
      { self: { addEventListener: (_: string, fn: Function) => { handler = fn; }, postMessage: (value: any) => posts.push(plain(value)) } });
    for (const targetRound of [0, -1, .5, 4, NaN, Infinity]) {
      handler!({ data: { id: 1, snapshot: poisoned(targetRound), targetRound, system: "dutch" } });
      eq(posts.at(-1), { id: 1, forecasts: {} });
    }
    eq(mockFieldCalls, 0);
    handler!({ data: { id: 2, snapshot: { totalRounds: 3, nextRound: 3, players: [{ startNumber: 1 }, { startNumber: 2 }] }, targetRound: 2, system: "dutch" } });
    eq(posts.at(-1), { id: 2, forecasts: { 1: null, 2: null } }); eq(mockFieldCalls, 2);
  });

  await test("actual preparation-colour callback uses normalized valid target", () => {
    const path = resolve(DIR, "TournamentPrepModal.tsx"), text = readFileSync(path, "utf8");
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let node: ts.FunctionDeclaration | undefined;
    const visit = (n: ts.Node) => { if (ts.isFunctionDeclaration(n) && n.name?.text === "projectedSideFor") node = n; ts.forEachChild(n, visit); };
    visit(ast); assert(node);
    const source = `${node.getText(ast)}\nexport { projectedSideFor };`;
    const run = (snapshot: any, forecast: any = null, userStartNumber: number | null = 1) => load("prep-callback.ts", {}, { record: { snapshot, userStartNumber }, forecast,
      normalizeTournamentResults, isValidTournamentTargetRound, projectedSideFromHistory: () => "black" }, source).projectedSideFor(3);
    eq(run({ ...fixture(), liveRound: null }), "white"); // raw next:null is repaired to published3.
    const invalid = fixture(); invalid.nextRound = 0; invalid.pairings.push({ round: 0, whiteStartNumber: 1, blackStartNumber: 3 });
    eq(run(invalid), "black"); // invalid round row cannot choose White.
    eq(run(fixture("final-live")), "black");
    eq(run(fixture(), null, null), "white"); // Preserve En native unselected-player guard.
    eq(run(fixture(), { candidates: [{ player: { startNumber: 3 }, color: "white" }] }), "white");
  });
  eq(sourceHashes(), beforeSources);
  for (const [name, digest] of Object.entries(baselineHashes)) eq(hash(read(name)), digest);
  eq(hash(readFileSync(priorRef.path)), priorRef.sha256);
  for (const reference of runtimeReferences) eq(hash(readFileSync(reference.path)), reference.sha256);
} catch (error) { failure = error instanceof Error ? error.stack ?? error.message : String(error); }
const receipt = { schema: 1, status: failure ? "failed" : "passed", scope: "Tiny synthetic metadata/target regressions; no accuracy, calibration, runtime or rendered claim",
  assertions: checks, groups, actualWorkerLaunches: 0, actualSolverCalls: 0, mockWorkerLaunches: mockWorkers, mockWholeFieldCalls: mockFieldCalls,
  wallMs: performance.now() - began, baseline: resolve(baseline), baselineHashes, priorPublishedTargetReceipt: priorRef, baselineOverlay, knownHelpCopies, knownCaveatCopies, nativeCopyDifferences, sourceBaseline,
  runtime: { node: process.version, typescript: ts.version, references: runtimeReferences },
  sourceHashes: beforeSources, harnessSHA256: hash(readFileSync(fileURLToPath(import.meta.url))),
  unchangedRelativeToPublishedTargetMilestone: failure ? null : 391 - changed.length, changedStates: changed, controls,
  expectedOriginalBaselineChanges: { previousAssignmentIntegrity: 7, newMetadata: 12 }, failure };
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, assertions: checks, groups, changed: changed.length, unchanged: receipt.unchangedRelativeToPublishedTargetMilestone,
  wallMs: receipt.wallMs, actualWorkers: 0, actualSolvers: 0, output }));
if (failure) throw new Error(failure);
