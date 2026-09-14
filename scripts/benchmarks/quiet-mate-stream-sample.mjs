import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";

// No classifier import. Freeze a bounded database prefix before SHA selection;
// exclude every game/ID in the old fixture, including its untouched holdout.
const output = process.argv[2];
assert(output && !existsSync(output));
const old = readFileSync(
  "../chessmistaketrainer/benchmarks/tactical-classifier/lichess-2026-08-02-fixture-v1.jsonl",
  "utf8",
)
  .trim()
  .split(/\r?\n/)
  .map(JSON.parse);
const ids = new Set(old.map((row) => row.id)),
  games = new Set(old.map((row) => row.sourceGroup));
for (const name of readdirSync("benchmarks/tactical-relevance").filter((name) =>
  /\.(json|md)$/.test(name),
)) {
  const text = readFileSync(`benchmarks/tactical-relevance/${name}`, "utf8");
  for (const match of text.matchAll(/lichess:([a-zA-Z0-9]{5})\b/g)) ids.add(`lichess:${match[1]}`);
  for (const match of text.matchAll(/https:\/\/lichess\.org\/([a-zA-Z0-9]{8})(?:[/#"\s])/g))
    games.add(`game:${match[1]}`);
}
const url = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
assert(response.ok && response.body, `Database HTTP ${response.status}`);
// The database starts with a skippable Zstandard frame. Node 24's experimental
// decoder stopped at that frame in this environment; use the established
// streaming decoder with explicit cross-frame support, without saving the DB.
let stopped = false;
const compressed = Readable.fromWeb(response.body);
const decoder = spawn(
  process.env.TACTICAL_ZSTD_PYTHON || "python",
  [
    "-u",
    "-c",
    "import sys,shutil,zstandard; shutil.copyfileobj(zstandard.ZstdDecompressor().stream_reader(sys.stdin.buffer, read_across_frames=True), sys.stdout.buffer)",
  ],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
);
let decoderError = "";
decoder.stderr.on("data", (chunk) => {
  decoderError += String(chunk).slice(0, 2000);
});
const decoderExited = new Promise((resolve) => decoder.once("exit", (code) => resolve(code)));
compressed.on("error", (error) => {
  if (!stopped) throw error;
});
decoder.on("error", (error) => {
  if (!stopped) throw error;
});
decoder.stdin.on("error", (error) => {
  if (!stopped) throw error;
});
compressed.pipe(decoder.stdin);
const lines = createInterface({ input: decoder.stdout, crlfDelay: Infinity });
const digest = createHash("sha256"),
  candidates = [];
const seed = "quiet-mate-unseen-2026-09-14",
  limit = 100000;
let count = 0;
try {
  for await (const line of lines) {
    if (!count && line.startsWith("PuzzleId,")) {
      digest.update(line + "\n");
      continue;
    }
    digest.update(line + "\n");
    count++;
    const fields = line.split(",");
    assert.equal(fields.length, 11, "Unexpected CSV quoting/schema: review before continuing");
    const [id, sourceFen, moves, rating, , , , themes, sourceGameUrl] = fields;
    const sourceThemes = themes.split(" "),
      stratum = ["mateIn2", "mateIn3", "mateIn4"].find((theme) => sourceThemes.includes(theme));
    const sourceGroup = `game:${sourceGameUrl.match(/lichess\.org\/([a-zA-Z0-9]{8})/)[1]}`;
    if (stratum && !ids.has(`lichess:${id}`) && !games.has(sourceGroup)) {
      const pos = Chess.fromSetup(parseFen(sourceFen).unwrap()).unwrap();
      const lineUci = moves.split(" "),
        preceding = parseUci(lineUci[0]);
      assert(preceding && pos.isLegal(preceding));
      pos.play(preceding);
      const startFen = makeFen(pos.toSetup()),
        root = parseUci(lineUci[1]);
      assert(root && "from" in root && pos.isLegal(root));
      if (!root.promotion && !pos.isCheck() && !pos.board.get(root.to)) {
        pos.play(root);
        if (!pos.isCheck() && !pos.isEnd())
          candidates.push({
            id: `lichess:${id}`,
            stratum,
            sourceGameUrl,
            sourceGroup,
            sourceFen,
            precedingMove: lineUci[0],
            startFen,
            bestLine: lineUci.slice(1),
            sourceThemes,
            rating: Number(rating),
            selectionHash: createHash("sha256").update(`${seed}:${id}`).digest("hex"),
          });
      }
    }
    if (count === limit) break;
  }
} finally {
  stopped = true;
  lines.close();
  compressed.destroy();
  decoder.stdin.destroy();
  decoder.kill();
  await decoderExited;
}
assert.equal(count, limit, decoderError || "Incomplete source prefix");
const used = new Set(),
  cases = [];
for (const stratum of ["mateIn2", "mateIn3", "mateIn4"]) {
  const rows = candidates
    .filter((row) => row.stratum === stratum)
    .sort((a, b) => a.selectionHash.localeCompare(b.selectionHash));
  for (const row of rows) {
    if (used.has(row.sourceGroup)) continue;
    const pos = Chess.fromSetup(parseFen(row.startFen).unwrap()).unwrap();
    const san = row.bestLine.map((uci) => {
      const move = parseUci(uci);
      assert(move && pos.isLegal(move));
      const san = makeSan(pos, move);
      pos.play(move);
      return san;
    });
    cases.push({ ...row, san });
    used.add(row.sourceGroup);
    if (cases.filter((row) => row.stratum === stratum).length === 3) break;
  }
  assert.equal(cases.filter((row) => row.stratum === stratum).length, 3, `Insufficient ${stratum}`);
}
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "Output-blind development sample, three distinct unseen games per quiet-mate stratum from the first 100000 source rows. Source tags are nominations, not truth; not representative accuracy.",
      sourceUrl: url,
      license: "CC0-1.0",
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      prefixRows: count,
      prefixSha256: digest.digest("hex"),
      seed,
      eligible: candidates.length,
      excludedIds: [...ids].sort(),
      excludedGames: [...games].sort(),
      cases,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(cases, null, 2));
