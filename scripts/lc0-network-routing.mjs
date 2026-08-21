export const LC0_PROFILE_OPTIONS = Object.freeze([
  { value: "none", label: "Standard strength", family: "bt4" },
  { value: "knight", label: "Knight odds", family: "t1" },
  { value: "rook", label: "Rook odds", family: "t1" },
  { value: "double_knight", label: "Double-knight odds", family: "t1" },
  { value: "rook_and_knight", label: "Rook-and-knight odds", family: "t1" },
  { value: "queen_for_knight", label: "Queen-for-knight odds", family: "t1" },
  { value: "queen", label: "Queen odds", family: "lqo" },
]);

export const LC0_OBJECTIVE_ENTER_CP = 400;
export const LC0_OBJECTIVE_EXIT_CP = 200;

const PROFILE_BY_VALUE = new Map(LC0_PROFILE_OPTIONS.map((profile) => [profile.value, profile]));
const MATERIAL_VALUES_CP = Object.freeze([100, 320, 330, 500, 900]);
const PROFILE_VECTORS = new Map([
  ["-1,0,0,0", { mode: "knight", baselineCp: 320 }],
  ["0,0,-1,0", { mode: "rook", baselineCp: 500 }],
  ["-2,0,0,0", { mode: "double_knight", baselineCp: 640 }],
  ["-1,0,-1,0", { mode: "rook_and_knight", baselineCp: 820 }],
  ["1,0,0,-1", { mode: "queen_for_knight", baselineCp: 580 }],
  ["0,0,0,-1", { mode: "queen", baselineCp: 900 }],
]);
const VECTOR_BY_PROFILE = new Map(
  [...PROFILE_VECTORS.entries()].map(([vector, profile]) => [
    profile.mode,
    vector.split(",").map(Number),
  ]),
);

export function normalizeLc0Profile(value) {
  const normalized = String(value || "none").trim().toLowerCase();
  return PROFILE_BY_VALUE.has(normalized) ? normalized : "none";
}

export function lc0ProfileDetails(value) {
  return PROFILE_BY_VALUE.get(normalizeLc0Profile(value));
}

/**
 * Match the learned material topology first, then use conventional Stockfish
 * only as a 4.0/2.0-pawn position-level hysteresis gate. Pawn value cannot
 * manufacture piece odds, and individual LC0 moves are never vetoed here.
 */
export function selectLc0Network({
  fen,
  autoNetwork = false,
  manualMode = "none",
  objectiveScoreCp,
  previousSelection,
}) {
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
    .map((playerColor) => topologyCandidate(counts, playerColor))
    .filter(Boolean)
    .sort((left, right) => right.deficitCp - left.deficitCp);
  const observed = candidates[0] || null;
  const previousMode = normalizeLc0Profile(previousSelection?.mode);
  const previousColor = ["white", "black"].includes(previousSelection?.playerColor)
    ? previousSelection.playerColor
    : null;
  const previousStillPresent =
    previousMode !== "none" &&
    previousColor &&
    profileHandicapStillPresent(counts, previousColor, previousMode);

  if (previousMode !== "none" && !previousStillPresent) {
    if (
      observed &&
      Number.isFinite(objectiveScoreCp) &&
      Math.max(0, -objectiveScoreCp) >= LC0_OBJECTIVE_ENTER_CP
    ) {
      return specialistSelection(observed, "objective_hybrid_topology_transition", objectiveScoreCp);
    }
    return standardSelection("objective_hybrid_original_handicap_recovered", objectiveScoreCp);
  }

  if (!Number.isFinite(objectiveScoreCp)) {
    if (previousStillPresent) {
      return specialistSelection(
        profileCandidate(counts, previousColor, previousMode),
        "objective_hybrid_score_unavailable",
      );
    }
    if (observed) return specialistSelection(observed, "objective_hybrid_score_unavailable");
    return standardSelection("unsupported_material_topology");
  }

  const deficitCp = Math.max(0, -objectiveScoreCp);
  if (previousStillPresent) {
    if (deficitCp <= LC0_OBJECTIVE_EXIT_CP) {
      return standardSelection("objective_hybrid_exit_to_bt4", objectiveScoreCp);
    }
    return specialistSelection(
      profileCandidate(counts, previousColor, previousMode),
      "objective_hybrid_hold_specialist",
      objectiveScoreCp,
    );
  }

  if (observed && deficitCp >= LC0_OBJECTIVE_ENTER_CP) {
    return specialistSelection(observed, "objective_hybrid_enter_specialist", objectiveScoreCp);
  }
  return standardSelection("objective_hybrid_hold_bt4", objectiveScoreCp);
}

export function inferHandicappedColor(fen) {
  const counts = pieceCountsFromFen(fen);
  if (!counts) return null;
  const whiteMaterial = materialTotal(counts.white);
  const blackMaterial = materialTotal(counts.black);
  if (whiteMaterial === blackMaterial) return null;
  return whiteMaterial < blackMaterial ? "white" : "black";
}

function specialistSelection(candidate, reason, objectiveScoreCp) {
  const profile = lc0ProfileDetails(candidate.mode);
  return {
    mode: profile.value,
    family: profile.family,
    label: profile.label,
    playerColor: candidate.playerColor,
    reason,
    deficitCp: candidate.deficitCp,
    remainingHandicapRatio: candidate.remainingHandicapRatio,
    objectiveScoreCp: Number.isFinite(objectiveScoreCp) ? objectiveScoreCp : undefined,
  };
}

function standardSelection(reason, objectiveScoreCp) {
  const selection = {
    mode: "none",
    family: "bt4",
    label: "Standard strength",
    playerColor: null,
    reason,
  };
  if (Number.isFinite(objectiveScoreCp)) selection.objectiveScoreCp = objectiveScoreCp;
  return selection;
}

function topologyCandidate(counts, playerColor) {
  const opponentColor = playerColor === "white" ? "black" : "white";
  const differences = counts[playerColor].map(
    (count, index) => count - counts[opponentColor][index],
  );
  const profile = PROFILE_VECTORS.get(differences.slice(1).join(","));
  if (!profile) return null;
  return profileCandidate(counts, playerColor, profile.mode, differences, profile.baselineCp);
}

function profileCandidate(counts, playerColor, mode, knownDifferences, knownBaselineCp) {
  const opponentColor = playerColor === "white" ? "black" : "white";
  const differences =
    knownDifferences ||
    counts[playerColor].map((count, index) => count - counts[opponentColor][index]);
  const baselineCp = knownBaselineCp || profileBaselineCp(mode);
  const deficitCp = -differences.reduce(
    (total, difference, index) => total + difference * MATERIAL_VALUES_CP[index],
    0,
  );
  return {
    mode,
    playerColor,
    deficitCp,
    remainingHandicapRatio: baselineCp ? deficitCp / baselineCp : undefined,
  };
}

function profileBaselineCp(mode) {
  for (const profile of PROFILE_VECTORS.values()) {
    if (profile.mode === mode) return profile.baselineCp;
  }
  return null;
}

function profileHandicapStillPresent(counts, playerColor, mode) {
  const expected = VECTOR_BY_PROFILE.get(mode);
  if (!expected) return false;
  const opponentColor = playerColor === "white" ? "black" : "white";
  const actual = counts[playerColor]
    .map((count, index) => count - counts[opponentColor][index])
    .slice(1);
  return expected.every((target, index) => {
    if (target === 0) return true;
    return target < 0 ? actual[index] <= target : actual[index] >= target;
  });
}

function materialTotal(counts) {
  return counts.reduce((total, count, index) => total + count * MATERIAL_VALUES_CP[index], 0);
}

function pieceCountsFromFen(fen) {
  const placement = String(fen || "").trim().split(/\s+/)[0];
  const ranks = placement.split("/");
  if (ranks.length !== 8) return null;

  const counts = { white: [0, 0, 0, 0, 0], black: [0, 0, 0, 0, 0] };
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

