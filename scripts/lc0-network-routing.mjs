export const LC0_PROFILE_OPTIONS = Object.freeze([
  { value: "none", label: "Standard strength", family: "bt4" },
  { value: "knight", label: "Knight odds", family: "t1" },
  { value: "rook", label: "Rook odds", family: "t1" },
  { value: "double_knight", label: "Double-knight odds", family: "t1" },
  { value: "rook_and_knight", label: "Rook-and-knight odds", family: "t1" },
  { value: "queen_for_knight", label: "Queen-for-knight odds", family: "t1" },
  { value: "queen", label: "Queen odds", family: "lqo" },
]);

const PROFILE_BY_VALUE = new Map(LC0_PROFILE_OPTIONS.map((profile) => [profile.value, profile]));
const MATERIAL_VALUES_CP = Object.freeze([100, 320, 330, 500, 900]);
const ODDS_MIN_REMAINING_HANDICAP_RATIO = 0.75;
const PROFILE_VECTORS = new Map([
  ["-1,0,0,0", { mode: "knight", baselineCp: 320 }],
  ["0,0,-1,0", { mode: "rook", baselineCp: 500 }],
  ["-2,0,0,0", { mode: "double_knight", baselineCp: 640 }],
  ["-1,0,-1,0", { mode: "rook_and_knight", baselineCp: 820 }],
  ["1,0,0,-1", { mode: "queen_for_knight", baselineCp: 580 }],
  ["0,0,0,-1", { mode: "queen", baselineCp: 900 }],
]);

export function normalizeLc0Profile(value) {
  const normalized = String(value || "none")
    .trim()
    .toLowerCase();
  return PROFILE_BY_VALUE.has(normalized) ? normalized : "none";
}

export function lc0ProfileDetails(value) {
  return PROFILE_BY_VALUE.get(normalizeLc0Profile(value));
}

export function selectLc0Network({ fen, autoNetwork = false, manualMode = "none" }) {
  if (!autoNetwork) {
    const profile = lc0ProfileDetails(manualMode);
    return {
      mode: profile.value,
      family: profile.family,
      label: profile.label,
      playerColor: inferHandicappedColor(fen),
      reason: "manual",
    };
  }

  const counts = pieceCountsFromFen(fen);
  if (!counts) return standardSelection("invalid_fen");

  const candidates = ["white", "black"]
    .map((playerColor) => autoCandidate(counts, playerColor))
    .filter(Boolean)
    .sort((left, right) => right.deficitCp - left.deficitCp);
  if (candidates.length === 0) return standardSelection("unsupported_material_topology");

  const selected = candidates[0];
  const profile = lc0ProfileDetails(selected.mode);
  return {
    mode: profile.value,
    family: profile.family,
    label: profile.label,
    playerColor: selected.playerColor,
    reason: "matched_odds_distribution",
    deficitCp: selected.deficitCp,
    remainingHandicapRatio: selected.remainingHandicapRatio,
  };
}

export function inferHandicappedColor(fen) {
  const counts = pieceCountsFromFen(fen);
  if (!counts) return null;
  const whiteMaterial = materialTotal(counts.white);
  const blackMaterial = materialTotal(counts.black);
  if (whiteMaterial === blackMaterial) return null;
  return whiteMaterial < blackMaterial ? "white" : "black";
}

function standardSelection(reason) {
  return {
    mode: "none",
    family: "bt4",
    label: "Standard strength",
    playerColor: null,
    reason,
  };
}

function autoCandidate(counts, playerColor) {
  const opponentColor = playerColor === "white" ? "black" : "white";
  const differences = counts[playerColor].map(
    (count, index) => count - counts[opponentColor][index],
  );
  const profile = PROFILE_VECTORS.get(differences.slice(1).join(","));
  if (!profile) return null;

  const deficitCp = -differences.reduce(
    (total, difference, index) => total + difference * MATERIAL_VALUES_CP[index],
    0,
  );
  const remainingHandicapRatio = deficitCp / profile.baselineCp;
  if (remainingHandicapRatio < ODDS_MIN_REMAINING_HANDICAP_RATIO) return null;

  return {
    mode: profile.mode,
    playerColor,
    deficitCp,
    remainingHandicapRatio,
  };
}

function materialTotal(counts) {
  return counts.reduce((total, count, index) => total + count * MATERIAL_VALUES_CP[index], 0);
}

function pieceCountsFromFen(fen) {
  const placement = String(fen || "")
    .trim()
    .split(/\s+/)[0];
  const ranks = placement.split("/");
  if (ranks.length !== 8) return null;

  const counts = {
    white: [0, 0, 0, 0, 0],
    black: [0, 0, 0, 0, 0],
  };
  const pieceIndexes = { p: 0, n: 1, b: 2, r: 3, q: 4 };
  for (const rank of ranks) {
    let files = 0;
    for (const token of rank) {
      if (/^[1-8]$/.test(token)) {
        files += Number(token);
        continue;
      }
      if (!/^[prnbqkPRNBQK]$/.test(token)) return null;
      files += 1;
      const index = pieceIndexes[token.toLowerCase()];
      if (index !== undefined)
        counts[token === token.toUpperCase() ? "white" : "black"][index] += 1;
    }
    if (files !== 8) return null;
  }
  return counts;
}
