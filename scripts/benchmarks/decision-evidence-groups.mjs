// Audit source identities without reading classifier results. A chapter split
// alone cannot guarantee that two diagrams from the same game stay together.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PgnParser } from "chessops/pgn";
import { privateReportPath } from "./private-pgn-sample.mjs";

function playerPair(left, right) {
  const normalize = (name) =>
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean)
      .sort()
      .join("");
  const players = [normalize(left), normalize(right)].sort();
  if (players.some((name) => name.length < 3 || name === "unknown")) return null;
  return players.join(":");
}

export function annotatedGameGroup(text) {
  const match = text
    .replace(/^\s*\d+[.)]\s*/, "")
    .match(/^(.+?)\s+[–—-]\s+(.+?),.*?\b((?:18|19|20)\d{2})\b/u);
  if (!match) return null;
  // Conservatively group every encounter of the pair, even in different years.
  // Positional-course exports put names in headers without recording the year.
  return playerPair(match[1], match[2]);
}

export function headerGameGroup(text) {
  const match = text.match(/^Exercise\s+\d+\s*-\s*(.+?)\s+vs\.?\s+(.+)$/i);
  return match ? playerPair(match[1], match[2]) : null;
}

export function auditGroups(rows) {
  const groups = new Map(),
    positions = new Map();
  for (const row of rows) {
    for (const [map, identity] of [
      [groups, row.sourceGroup],
      [positions, row.fen.split(" ").slice(0, 4).join(" ")],
    ]) {
      const entries = map.get(identity) ?? [];
      entries.push(row);
      map.set(identity, entries);
    }
  }
  const collisions = [...groups, ...positions].filter(
    ([, entries]) => new Set(entries.map((row) => row.split)).size > 1,
  );
  const excluded = new Set(
    collisions.flatMap(([, entries]) =>
      entries.filter((row) => row.split === "validation").map((row) => row.id),
    ),
  );
  for (const row of rows)
    if (row.split === "validation" && row.identityResolution === "chapter-only")
      excluded.add(row.id);
  return {
    collisions: collisions.map(([group, entries]) => ({
      group,
      ids: entries.map((row) => row.id),
    })),
    excludedValidationIds: [...excluded].sort(),
  };
}

async function main() {
  const [samplePath, courses, output] = process.argv.slice(2);
  if (!output)
    throw new Error(
      "Provide the course sample, original course directory and new private audit output",
    );
  const sample = JSON.parse(readFileSync(samplePath, "utf8"));
  const source = new Map();
  const rows = sample.cases.map((row) => {
    const directory = readdirSync(courses).find((name) =>
      name.startsWith(row.category === "tactical-course" ? "08 -" : "09 -"),
    );
    const path = join(courses, directory, row.chapter);
    if (!source.has(path)) {
      const games = [];
      new PgnParser((game, error) => {
        if (error) throw error;
        games.push(game);
      }).parse(readFileSync(path, "utf8"));
      source.set(path, games);
    }
    const game = source.get(path)[row.sourceGame - 1];
    if (!game) throw new Error("Source game identity no longer exists");
    const text = [
      ...(game.comments ?? []),
      ...Array.from(game.moves.mainline(), (node) => node.comments ?? []).flat(),
    ].find((comment) => annotatedGameGroup(comment));
    const identity = text
      ? annotatedGameGroup(text)
      : headerGameGroup(game.headers.get("Black") ?? "");
    return {
      id: row.id,
      fen: row.fen,
      split: row.split,
      sourceGroup: identity
        ? `annotated-game:${createHash("sha256").update(identity).digest("hex")}`
        : `chapter:${row.category}:${row.chapter}`,
      identityResolution: identity ? "player-pair" : "chapter-only",
    };
  });
  const report = {
    sampleSha256: createHash("sha256").update(readFileSync(samplePath)).digest("hex"),
    policy:
      "Conservatively exclude validation groups sharing an annotated/header player pair (any year) or exact root with development. Also exclude validation rows whose source game could not be resolved. Names with incompatible spelling/initials remain a potential identity limitation.",
    resolvedGames: rows.filter((row) => row.identityResolution === "player-pair").length,
    cases: rows,
    ...auditGroups(rows),
  };
  writeFileSync(privateReportPath(output), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(
    JSON.stringify({
      cases: rows.length,
      resolvedGames: report.resolvedGames,
      collisions: report.collisions.length,
      excludedValidation: report.excludedValidationIds.length,
    }),
  );
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();
