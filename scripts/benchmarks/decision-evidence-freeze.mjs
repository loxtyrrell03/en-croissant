// Freeze code, input identities, split exclusions and search policy BEFORE
// inspecting held-out classifier output. Private source content is not copied.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { privateReportPath } from "./private-pgn-sample.mjs";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesBelow(join(path, entry.name)) : [join(path, entry.name)],
  );
}

export function assertFrozenFiles(root, manifest) {
  for (const [path, expected] of Object.entries(manifest.sourceHashes)) {
    const target = resolve(root, path);
    if (!relative(resolve(root), target) || relative(resolve(root), target).startsWith(".."))
      throw new Error("Frozen source path escapes the repository");
    if (sha256(readFileSync(target)) !== expected)
      throw new Error(`Frozen candidate source changed: ${path}`);
  }
}

export function selectFrozenValidation(sampleBytes, cohort, manifest) {
  const frozen = manifest.datasets[cohort];
  if (!frozen || sha256(sampleBytes) !== frozen.sampleSha256)
    throw new Error("The sample is not the frozen input");
  const rows = JSON.parse(sampleBytes).cases.filter(
    (row) => row.split === "validation" && !frozen.excludedIds.includes(row.id),
  );
  if (
    rows.length !== frozen.ids.length ||
    rows.some((row) => !frozen.ids.includes(row.id)) ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error("The held-out case identities changed");
  return rows;
}

async function main() {
  const [directory, engine, destination, candidate = "v13-conditional", ...selected] =
    process.argv.slice(2);
  if (!destination)
    throw new Error("Provide private evidence directory, engine and new private freeze file");
  if (!/^v[0-9]+-[a-z0-9-]+$/.test(candidate)) throw new Error("Use a versioned candidate name");
  const profile = candidate.split("-")[0];
  const cohorts = selected.length ? selected : ["course", "independent", "classical"];
  if (
    new Set(cohorts).size !== cohorts.length ||
    cohorts.some((name) => !["course", "independent", "classical", "tournament"].includes(name))
  )
    throw new Error("Unknown or duplicated evidence cohort");
  const groupBytes = cohorts.includes("course")
    ? readFileSync(join(directory, "course-group-audit-final.json"))
    : null;
  const groups = groupBytes ? JSON.parse(groupBytes) : null;
  const paths = [
    ...filesBelow(join(repo, "src/utils/tacticalMotifs")).filter((path) => /\.(ts|js)$/.test(path)),
    ...[
      "src/utils/pawnStructureDetector.ts",
      "src/utils/mistakeReview.ts",
      "src/utils/engineSettingsOptions.ts",
      "pnpm-lock.yaml",
      "scripts/benchmarks/decision-evidence-engine.py",
      "scripts/benchmarks/decision-evidence-probes.py",
      "scripts/benchmarks/decision-evidence-score.py",
      "scripts/benchmarks/decision-evidence-evaluate.py",
      "scripts/benchmarks/decision-evidence-model-pilot.py",
      "scripts/benchmarks/decision-evidence-tournament.py",
      "scripts/benchmarks/decision-evidence-rank-probes.py",
      "scripts/benchmarks/decision-evidence-reply-ranker.py",
      "scripts/benchmarks/decision-evidence-freeze.mjs",
      "src/utils/tests/decisionCandidateAudit.test.ts",
    ].map((path) => join(repo, path)),
  ];
  const sourceHashes = Object.fromEntries(
    paths
      .sort()
      .map((path) => [relative(repo, path).replaceAll("\\", "/"), sha256(readFileSync(path))]),
  );
  const datasets = {};
  const seen = new Set();
  for (const cohort of cohorts) {
    const bytes = readFileSync(join(directory, `${cohort}-sample.json`));
    const sample = JSON.parse(bytes);
    if (cohort === "course" && groups.sampleSha256 !== sha256(bytes))
      throw new Error("The group audit belongs to a different sample");
    const excludedIds = cohort === "course" ? groups.excludedValidationIds : [];
    const rows = sample.cases.filter(
      (row) => row.split === "validation" && !excludedIds.includes(row.id),
    );
    for (const row of rows) {
      if (seen.has(row.id)) throw new Error("Duplicate validation identity");
      seen.add(row.id);
      const key = row.fen.split(" ").slice(0, 4).join(" ");
      if (
        sample.cases.some(
          (other) =>
            other.split === "development" && other.fen.split(" ").slice(0, 4).join(" ") === key,
        )
      )
        throw new Error("Validation root overlaps development");
    }
    datasets[cohort] = { sampleSha256: sha256(bytes), ids: rows.map((row) => row.id), excludedIds };
  }
  const manifest = {
    version: 1,
    candidate,
    createdAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    sourceHashes,
    groupAuditSha256: groupBytes ? sha256(groupBytes) : null,
    datasets,
    engineSha256: sha256(readFileSync(engine)),
    search: {
      protocol: 2,
      minimumDepth: 18,
      maximumRootNodes: 9600000,
      replyBudgets: [1000000, 4000000],
      captureResources: true,
      captureLimit: 3,
      threadsPerEngine: 1,
      hashMb: 64,
    },
    evaluationPolicy:
      "Source-assisted agent labels must be saved before classifier outputs are inspected. Unknown labels are excluded, positive abstentions are misses, and source categories/themes alone are not truth. Report conditional resources separately from root motifs. All future tuning against this set makes it development data; do not describe a tuned rerun as untouched evaluation.",
    limitations: [
      "No independent human expert adjudication is implied.",
      "Some baseline source contains preserved pre-existing local changes; exact source hashes are authoritative, not the commit alone.",
      "Finite search and incomplete reference coverage limit conclusions.",
    ],
  };
  for (const cohort of Object.keys(datasets)) {
    const rows = selectFrozenValidation(
      readFileSync(join(directory, `${cohort}-sample.json`)),
      cohort,
      manifest,
    );
    writeFileSync(
      privateReportPath(join(directory, `${cohort}-validation-${profile}-sample.json`)),
      JSON.stringify({ freeze: resolve(destination), cases: rows }, null, 2),
      { flag: "wx" },
    );
  }
  writeFileSync(privateReportPath(destination), JSON.stringify(manifest, null, 2), { flag: "wx" });
  console.log(
    JSON.stringify({
      candidate: manifest.candidate,
      sources: paths.length,
      heldOutCases: seen.size,
      cohorts: Object.fromEntries(
        Object.entries(datasets).map(([cohort, data]) => [cohort, data.ids.length]),
      ),
    }),
  );
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();
