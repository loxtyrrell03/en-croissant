import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { preparePrivatePgnSample, privateReportPath } from "./private-pgn-sample.mjs";

/** Stratify by source before consulting engine or classifier output. Chapter
 * names are provenance, not tactical labels. Duplicate board identities are
 * counted once, including repeats within a source. Paid inputs stay private. */
export function preparePrivatePgnCorpusSample(sources, perSource = 2) {
  if (!Number.isSafeInteger(perSource) || perSource < 1)
    throw new Error("Invalid per-source sample size");
  if (!Array.isArray(sources) || !sources.length)
    throw new Error("At least one PGN source is required");
  const labels = new Set();
  for (const input of sources) {
    if (
      !input ||
      typeof input.label !== "string" ||
      !input.label ||
      labels.has(input.label) ||
      typeof input.source !== "string"
    )
      throw new Error("Sources need unique nonempty labels and PGN text");
    labels.add(input.label);
  }
  const identities = new Set();
  const cases = [],
    receipt = [];
  let eligiblePositions = 0,
    distinctPositions = 0;
  const ordered = [...sources].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  for (const input of ordered) {
    const parsed = preparePrivatePgnSample(input.source, Number.MAX_SAFE_INTEGER);
    eligiblePositions += parsed.eligiblePositions;
    const candidates = [];
    for (const row of parsed.cases) {
      const key = row.fen.split(" ").slice(0, 4).join(" ");
      if (identities.has(key)) continue;
      identities.add(key);
      candidates.push({
        ...row,
        sourceEligibleIndex: row.eligibleIndex,
        eligibleIndex: ++distinctPositions,
      });
    }
    const count = Math.min(perSource, candidates.length);
    for (let index = 0; index < count; index++) {
      const offset = count === 1 ? 0 : Math.floor((index * (candidates.length - 1)) / (count - 1));
      const row = candidates[offset];
      cases.push({
        ...row,
        id: `private-corpus:${row.eligibleIndex}`,
        sourceLabel: input.label,
        sourceSha256: parsed.sourceSha256,
      });
    }
    receipt.push({
      label: input.label,
      sourceSha256: parsed.sourceSha256,
      parsedGames: parsed.parsedGames,
      eligiblePositions: parsed.eligiblePositions,
      distinctPositions: candidates.length,
      sampledPositions: count,
      rejected: parsed.rejected,
    });
  }
  if (!cases.length) throw new Error("No legal exercise positions in the supplied corpus");
  return {
    selection:
      "Source-label order; equally spaced distinct positions per source including both endpoints. Global board/turn/castling/en-passant deduplication; fixed before classifier output. Mainlines only; comments are not labels.",
    sourceSha256: createHash("sha256")
      .update(JSON.stringify(receipt.map((row) => [row.label, row.sourceSha256])))
      .digest("hex"),
    eligiblePositions,
    distinctPositions,
    perSource,
    sources: receipt,
    cases,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, count, ...paths] = process.argv.slice(2);
  if (!output || !count || !paths.length)
    throw new Error("Usage: PRIVATE_OUTPUT_JSON COUNT_PER_SOURCE INPUT_PGN ...");
  const sample = preparePrivatePgnCorpusSample(
    paths.map((path) => ({ label: basename(path), source: readFileSync(path, "utf8") })),
    Number(count),
  );
  const target = privateReportPath(output);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(sample, null, 2), { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        sources: sample.sources.length,
        eligiblePositions: sample.eligiblePositions,
        distinctPositions: sample.distinctPositions,
        sampledPositions: sample.cases.length,
        rejected: sample.sources.reduce((sum, source) => sum + source.rejected.length, 0),
        sourceSha256: sample.sourceSha256,
        output: target,
      },
      null,
      2,
    ),
  );
}
