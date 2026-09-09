import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, sep, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { makeFen } from "chessops/fen";
import { PgnParser, startingPosition } from "chessops/pgn";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";

// Resolve existing ancestors too: a junction inside a private-looking output
// directory must not route copyrighted source positions back into this checkout.
export function privateReportPath(output) {
  const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  let ancestor = resolve(output);
  const missing = [];
  while (!existsSync(ancestor)) {
    missing.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  const target = resolve(realpathSync(ancestor), ...missing);
  const path = relative(root, target);
  if (!(isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))) {
    throw new Error("Private benchmark reports must stay outside the checkout");
  }
  return target;
}

/** Select before seeing classifier outputs. Comments, tags and side variations
 * are not labels. The caller owns the source; never copy a course into Git. */
export function preparePrivatePgnSample(source, count = 24, excludedSample = null) {
  if (!Number.isInteger(count) || count < 1) throw new Error("Invalid sample size");
  const games = [];
  const parseErrors = [];
  new PgnParser((game, error) => {
    if (error) parseErrors.push(String(error));
    games.push(game);
  }).parse(source);
  if (parseErrors.length) throw new Error(`PGN parsing failed: ${parseErrors.join("; ")}`);
  const positions = [];
  const rejected = [];
  for (const [index, game] of games.entries()) {
    if (!game.headers.has("FEN")) continue;
    try {
      const position = startingPosition(game.headers).unwrap();
      const fen = makeFen(position.toSetup());
      const sourceSan = [],
        sourceUci = [];
      for (const node of game.moves.mainline()) {
        const move = parseSan(position, node.san);
        if (!move || !position.isLegal(move))
          throw new Error(`Illegal mainline move at ply ${sourceUci.length + 1}`);
        sourceSan.push(makeSan(position, move));
        sourceUci.push(makeUci(move));
        position.play(move);
      }
      if (!sourceUci.length) throw new Error("No solution moves");
      positions.push({
        sourceGame: index + 1,
        exercise: game.headers.get("Black") ?? `Position ${index + 1}`,
        fen,
        sourceSan,
        sourceUci,
      });
    } catch (error) {
      rejected.push({ sourceGame: index + 1, error: String(error) });
    }
  }
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const positionKey = (fen) => fen.split(" ").slice(0, 4).join(" ");
  const excluded = new Set();
  if (excludedSample !== null) {
    if (excludedSample?.sourceSha256 !== sourceSha256 || !Array.isArray(excludedSample.cases))
      throw new Error("Excluded sample must belong to this exact PGN source");
    for (const row of excludedSample.cases) {
      if (
        !Number.isInteger(row.eligibleIndex) ||
        row.eligibleIndex < 1 ||
        row.eligibleIndex > positions.length ||
        row.fen !== positions[row.eligibleIndex - 1].fen
      )
        throw new Error("Excluded sample position does not match its source index");
      excluded.add(positionKey(row.fen));
    }
  }
  const candidates = positions
    .map((row, index) => ({ ...row, eligibleIndex: index + 1 }))
    .filter((row) => !excluded.has(positionKey(row.fen)));
  if (excludedSample !== null && !candidates.length)
    throw new Error("No unseen eligible positions remain");
  const size = Math.min(count, candidates.length);
  const indices = Array.from({ length: size }, (_, i) =>
    size === 1 ? 0 : Math.floor((i * (candidates.length - 1)) / (size - 1)),
  );
  return {
    selection:
      excludedSample === null
        ? "Equally spaced PGN-order indices including both endpoints, fixed before classifier output; mainlines only, comments omitted."
        : "Equally spaced remaining PGN-order positions after excluding every board/turn/castling/en-passant position in the supplied prior sample, fixed before classifier output; mainlines only, comments omitted.",
    sourceSha256,
    parsedGames: games.length,
    eligiblePositions: positions.length,
    ...(excludedSample === null
      ? {}
      : {
          excludedPositions: positions.length - candidates.length,
          remainingPositions: candidates.length,
        }),
    rejected,
    cases: indices.map((index) => ({
      id: `private-easy:${candidates[index].eligibleIndex}`,
      ...candidates[index],
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, size, prior] = process.argv.slice(2);
  if (!input || !output)
    throw new Error(
      "Usage: node scripts/benchmarks/private-pgn-sample.mjs INPUT_PGN PRIVATE_OUTPUT_JSON [COUNT] [PRIOR_SAMPLE_JSON]",
    );
  const report = preparePrivatePgnSample(
    readFileSync(input, "utf8"),
    size ? Number(size) : 24,
    prior ? JSON.parse(readFileSync(prior, "utf8")) : null,
  );
  const target = privateReportPath(output);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        parsedGames: report.parsedGames,
        eligiblePositions: report.eligiblePositions,
        excludedPositions: report.excludedPositions,
        remainingPositions: report.remainingPositions,
        rejected: report.rejected,
        sample: report.cases.map((row) => row.id),
        sourceSha256: report.sourceSha256,
        output: resolve(output),
      },
      null,
      2,
    ),
  );
}
