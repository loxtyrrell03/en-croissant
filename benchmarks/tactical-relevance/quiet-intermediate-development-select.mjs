// Output-blind nomination from the existing small public development fixture.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";

const source = process.argv[2];
if (!source) throw Error("Supply the retained small public fixture path");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const raw = readFileSync(source, "utf8");
const sourceSha256 = hash(raw);
if (sourceSha256 !== "c80356923da60cce5b48b37046a878290f36997862f921b944015a3cf69ccc88")
  throw Error("Unexpected source fixture checksum");
const priorSelection = "benchmarks/tactical-relevance/rare-causal-cohort-v2-selection.json";
const priorInputs = "benchmarks/tactical-relevance/rare-causal-cohort-v2-inputs.json";
const previous = JSON.parse(readFileSync(priorSelection, "utf8"));
const inputs = JSON.parse(readFileSync(priorInputs, "utf8"));
const ids = new Set(previous.excludedIds),
  games = new Set(previous.excludedGames);
for (const row of previous.cases) {
  ids.add(row.id);
  games.add(row.sourceGroup);
}
for (const row of previous.controlGames) games.add(row.sourceGroup);
for (const row of inputs.puzzles) {
  ids.add(row.id);
  games.add(row.sourceGroup);
}
const rows = raw
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
for (const row of rows) if (ids.has(row.id)) games.add(row.sourceGroup);
const seed = "quiet-intermediate-causal-2026-10-02-v1";
const eligible = [];
for (const row of rows) {
  if (
    row.split !== "development" ||
    ids.has(row.id) ||
    games.has(row.sourceGroup) ||
    !row.sourceThemes.includes("intermezzo")
  )
    continue;
  const pos = Chess.fromSetup(parseFen(row.startFen).unwrap()).unwrap();
  const root = parseUci(row.bestLine[0]);
  if (!root || !("from" in root) || !pos.isLegal(root) || !pos.board.get(root.to)) continue;
  const after = pos.clone();
  after.play(root);
  if (after.isCheck()) continue;
  eligible.push({
    id: row.id,
    sourceGroup: row.sourceGroup,
    sourceGameUrl: row.sourceGameUrl,
    sourceFen: row.sourceFen,
    precedingMove: row.precedingMove,
    startFen: row.startFen,
    bestLine: row.bestLine,
    sourceThemes: row.sourceThemes,
    rootSan: makeSan(pos, root),
    selectionHash: hash(`${seed}:${row.id}`),
  });
}
eligible.sort((a, b) => a.selectionHash.localeCompare(b.selectionHash));
const cases = [],
  used = new Set();
for (const row of eligible) {
  if (used.has(row.sourceGroup)) continue;
  used.add(row.sourceGroup);
  cases.push(row);
  if (cases.length === 3) break;
}
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      seed,
      sourceSha256,
      scope:
        "Up to three source-game-disjoint public development quiet-capture intermezzo nominations; source tags are hypotheses, never truth. No classifier or engine runs in selection.",
      selection:
        "SHA256(seed:id) ascending after development, prior-review, source intermezzo, legal root capture and nonchecking-root filters. Take up to three distinct source games. Retain every result; no replacement after adjudication.",
      exclusions: [priorSelection, priorInputs].map((path) => ({
        path,
        sha256: hash(readFileSync(path)),
      })),
      exclusionBoundary:
        "Frozen earlier public-review exclusions plus all v2 cases and control games; no owner/private inputs read. Same already-used small source fixture, not unseen or held out.",
      eligibleCount: eligible.length,
      selectedCount: cases.length,
      initialHypothesis:
        "A nonchecking capture may need to precede another legal capture to avoid a concrete reversed-order recovery. Establish connectedness, all legal replies, material debt and opposite order independently; abstain or unknown if not closed. No expected classifier label is frozen yet.",
      cases,
    },
    null,
    2,
  ),
);
