import { createHash } from "node:crypto";

// Archive exclusion lists describe sampler inputs, not positions examined by
// that archive. In particular the quiet-mate sampler excluded all 1,679 old
// puzzles, including the untouched holdout; none became evidence by exclusion.
export function collectTacticalSampleEvidence(content, format = "json") {
  const excludedIds = new Set();
  const excludedGames = new Set();
  const identity = (value) => {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(/\blichess:([a-zA-Z0-9]{5})\b/g))
      excludedIds.add(`lichess:${match[1]}`);
    for (const match of value.matchAll(/(?:\bgame:|\bcontext:|https:\/\/lichess\.org\/)([a-zA-Z0-9]{8})(?=$|[/#:)"\s])/g))
      excludedGames.add(`game:${match[1]}`);
  };
  if (format === "markdown") {
    // Narrative reviews explicitly discuss examined cases; retain those
    // references, including older records without a structured fixture.
    identity(content);
    return { excludedIds, excludedGames };
  }
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const hasPosition = ["fen", "startFen", "sourceFen", "previousFen", "afterFen"]
      .some((key) => typeof value[key] === "string" && value[key].includes("/")) ||
      (typeof value.input?.fen === "string" && value.input.fen.includes("/"));
    const hasEvidence = ["bestLine", "pvUci", "sourceUci", "moves", "lineUci", "primary", "sourceResult", "scan", "motifs", "judgement", "judgment"]
      .some((key) => Object.hasOwn(value, key));
    if (hasPosition || hasEvidence) {
      for (const key of ["id", "sourceGroup", "sourceGameUrl", "gameUrl"]) identity(value[key]);
      if (typeof value.sourcePuzzleId === "string" && /^[a-zA-Z0-9]{5}$/.test(value.sourcePuzzleId))
        excludedIds.add(`lichess:${value.sourcePuzzleId}`);
      if (typeof value.gameId === "string" && /^[a-zA-Z0-9]{8}$/.test(value.gameId))
        excludedGames.add(`game:${value.gameId}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (/^excluded/i.test(key) || ["metadata", "selection", "provenance"].includes(key)) continue;
      walk(item);
    }
  };
  walk(JSON.parse(content));
  return { excludedIds, excludedGames };
}

export function selectTacticalDevelopmentCases(rows, exclusions, { seed, themes, perTheme }) {
  const candidates = rows.filter((row) =>
    row.split === "development" && !exclusions.excludedIds.has(row.id) &&
    !exclusions.excludedGames.has(row.sourceGroup),
  ).map((row) => ({ row, hash: createHash("sha256").update(`${seed}:${row.id}`).digest("hex") }))
    .sort((a, b) => a.hash.localeCompare(b.hash));
  const games = new Set();
  const cases = [];
  for (const theme of themes) {
    let selected = 0;
    for (const { row, hash } of candidates) {
      if (!row.sourceThemes.includes(theme) || games.has(row.sourceGroup)) continue;
      cases.push({
        stratum: theme, id: row.id, sourceGameUrl: row.sourceGameUrl,
        sourceGroup: row.sourceGroup, sourceThemes: row.sourceThemes,
        sourceFen: row.sourceFen, precedingMove: row.precedingMove,
        startFen: row.startFen, bestLine: row.bestLine, selectionHash: hash,
      });
      games.add(row.sourceGroup);
      if (++selected === perTheme) break;
    }
    if (selected !== perTheme) throw new Error(`Insufficient new development rows: ${theme}`);
  }
  return cases;
}
