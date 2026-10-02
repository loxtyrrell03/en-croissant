import { publishedGameResult, publishedPairingScore } from "./publishedPairingResult";
import { normalizeTournamentResults } from "./normalizeTournamentResults";
import { swissAccelerationPoints } from "./swissPairingSettings";
import { publishedNoOpponentScore, hasUnscoredNoOpponentHistory } from "./publishedNoOpponentScore";
import type {
  TournamentPairing,
  TournamentPlayer,
  TournamentSnapshot,
} from "@/features/tournaments/platform";
import { calibratedRankProbabilities } from "./pairingCalibration";
import { estimatedAttendance, swissParticipationScenario } from "./swissParticipation";
import { contextualSwissProbabilities } from "./pairingHistoryCalibration";
import type { ExactSwissForecast } from "./exactSwissForecast";

export type PairingForecastKind =
  | "confirmed"
  | "scheduled"
  | "inferred"
  | "estimated"
  | "complete"
  | "unavailable";

export interface PairingCandidate {
  player: TournamentPlayer;
  /** Null means no validated probability is available; never interpret as zero. */
  probability: number | null;
  color: "white" | "black" | null;
  board: number | null;
  reasons: string[];
}

export interface PairingForecast {
  kind: PairingForecastKind;
  round: number | null;
  confidence: "confirmed" | "high" | "medium" | "low" | "unavailable";
  candidates: PairingCandidate[];
  otherProbability: number | null;
  summary: string;
  caveat: string | null;
}

export interface PairingForecastCalculationOptions {
  /** Exact result supplied asynchronously by the whole-field worker. */
  exactSwiss?: ExactSwissForecast | null;
}

interface PairingForecastModel {
  scoreGroupWeight: number;
  pairingBandWeight: number;
  colorWeight: number;
  ratingWeight: number;
  pairingBandDecay: number;
}

const BETWEEN_ROUND_PRIMARY_MODEL: PairingForecastModel = {
  scoreGroupWeight: 0.55,
  pairingBandWeight: 0.25,
  colorWeight: 0.15,
  ratingWeight: 0.05,
  pairingBandDecay: 3.2,
};

const LIVE_ROUND_PRIMARY_MODEL: PairingForecastModel = {
  scoreGroupWeight: 0.52,
  pairingBandWeight: 0.3,
  colorWeight: 0.18,
  ratingWeight: 0,
  pairingBandDecay: 1.7,
};

const BETWEEN_ROUND_COVERAGE_MODEL: PairingForecastModel = {
  scoreGroupWeight: 0.55,
  pairingBandWeight: 0.35,
  colorWeight: 0.1,
  ratingWeight: 0,
  pairingBandDecay: 0.8,
};

const LIVE_ROUND_COVERAGE_MODEL: PairingForecastModel = {
  scoreGroupWeight: 0.48,
  pairingBandWeight: 0.4,
  colorWeight: 0.11,
  ratingWeight: 0.01,
  pairingBandDecay: 2.4,
};

interface WeightedPoints {
  points: number;
  weight: number;
}

interface RankedCandidate {
  player: TournamentPlayer;
  raw: number;
  coverageRaw: number;
  color: "white" | "black" | null;
  reasons: string[];
}

interface ProjectedPlayer {
  player: TournamentPlayer;
  distribution: WeightedPoints[];
}

const SCORE_EPSILON = 0.03;

function playerMap(snapshot: TournamentSnapshot): Map<number, TournamentPlayer> {
  return new Map(snapshot.players.map((player) => [player.startNumber, player]));
}

function pairingFor(
  snapshot: TournamentSnapshot,
  round: number,
  startNumber: number,
): TournamentPairing | undefined {
  return snapshot.pairings.find(
    (pairing) =>
      pairing.round === round &&
      (pairing.whiteStartNumber === startNumber || pairing.blackStartNumber === startNumber),
  );
}

function opponentNumber(pairing: TournamentPairing, startNumber: number): number | null {
  if (pairing.whiteStartNumber === startNumber) return pairing.blackStartNumber;
  if (pairing.blackStartNumber === startNumber) return pairing.whiteStartNumber;
  return null;
}

function colorIn(pairing: TournamentPairing, startNumber: number): "white" | "black" | null {
  if (pairing.whiteStartNumber === startNumber) return "white";
  if (pairing.blackStartNumber === startNumber) return "black";
  return null;
}

/** A published one-seat assignment confirms no opponent, not the reason for
 * absence. Read only the occupied seat's explicit score; a blank is not zero. */
function publishedNoOpponentCopy(pairing: TournamentPairing, round: number): Pick<PairingForecast, "summary" | "caveat"> {
  const score = publishedNoOpponentScore(pairing);
  if (score === 1) {
    return { summary: `Round ${round} bye published`, caveat: "The published row lists 1 point and no opponent for this round." };
  }
  if (score === 0.5) {
    return { summary: `Round ${round} half-point bye published`, caveat: "The published row lists half a point and no opponent for this round." };
  }
  return {
    summary: `Round ${round}: no opponent assigned`,
    caveat: score === 0
      ? "The published row lists 0 points for this round. It does not establish why you are not paired."
      : "The published row has no opponent. No score is specified.",
  };
}

function scoreFromResult(pairing: TournamentPairing, startNumber: number): number | null {
  return publishedPairingScore(pairing, startNumber);
}

function outcomeWeights(
  player: TournamentPlayer,
  opponent: TournamentPlayer | undefined,
): Array<{ score: number; weight: number }> {
  if (!player.rating || !opponent?.rating) {
    return [
      { score: 1, weight: 0.35 },
      { score: 0.5, weight: 0.3 },
      { score: 0, weight: 0.35 },
    ];
  }
  const difference = opponent.rating - player.rating;
  const expected = 1 / (1 + 10 ** (difference / 400));
  const draw = 0.18 + 0.16 * (1 - Math.min(Math.abs(difference) / 500, 1));
  const win = Math.max(0.03, Math.min(0.94 - draw, expected - draw / 2));
  const loss = Math.max(0.03, 1 - draw - win);
  const total = win + draw + loss;
  return [
    { score: 1, weight: win / total },
    { score: 0.5, weight: draw / total },
    { score: 0, weight: loss / total },
  ];
}

function combineDistribution(
  current: WeightedPoints[],
  outcomes: Array<{ score: number; weight: number }>,
): WeightedPoints[] {
  const buckets = new Map<number, number>();
  for (const state of current) {
    for (const outcome of outcomes) {
      const points = Math.round((state.points + outcome.score) * 2) / 2;
      buckets.set(points, (buckets.get(points) ?? 0) + state.weight * outcome.weight);
    }
  }
  return [...buckets.entries()].map(([points, weight]) => ({ points, weight }));
}

function projectedPoints(
  snapshot: TournamentSnapshot,
  startNumber: number,
  targetRound: number,
  players: Map<number, TournamentPlayer>,
): WeightedPoints[] {
  const player = players.get(startNumber);
  if (!player) return [];
  let distribution: WeightedPoints[] = [{ points: player.points, weight: 1 }];
  const unsettled = snapshot.pairings
    .filter(
      (pairing) =>
        pairing.round > snapshot.completedRound &&
        pairing.round < targetRound &&
        (pairing.whiteStartNumber === startNumber || pairing.blackStartNumber === startNumber),
    )
    .sort((left, right) => left.round - right.round);
  for (const pairing of unsettled) {
    const settledScore = scoreFromResult(pairing, startNumber);
    const outcomes =
      settledScore === null
        ? outcomeWeights(player, players.get(opponentNumber(pairing, startNumber) ?? -1))
        : [{ score: settledScore, weight: 1 }];
    distribution = combineDistribution(distribution, outcomes);
  }
  return distribution;
}

function expectedPoints(distribution: WeightedPoints[]): number {
  return distribution.reduce((sum, state) => sum + state.points * state.weight, 0);
}

function scoreGroupOverlap(left: WeightedPoints[], right: WeightedPoints[]): number {
  let overlap = 0;
  for (const a of left) {
    for (const b of right) {
      const difference = Math.abs(a.points - b.points);
      const compatibility =
        difference <= SCORE_EPSILON ? 1 : difference <= 0.51 ? 0.34 : difference <= 1.01 ? 0.07 : 0.01;
      overlap += a.weight * b.weight * compatibility;
    }
  }
  return overlap;
}

function unplayedResult(pairing: TournamentPairing): boolean {
  return Boolean(publishedGameResult(pairing)?.forfeit);
}

const colorHistories = new WeakMap<TournamentSnapshot, Map<string, Array<"white" | "black">>>();

function colorHistory(
  snapshot: TournamentSnapshot,
  startNumber: number,
  beforeRound: number,
): Array<"white" | "black"> {
  let cache = colorHistories.get(snapshot);
  const key = `${startNumber}:${beforeRound}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const history = snapshot.pairings
    .filter(
      (pairing) =>
        pairing.round < beforeRound &&
        !unplayedResult(pairing) &&
        pairing.whiteStartNumber !== null &&
        pairing.blackStartNumber !== null,
    )
    .sort((left, right) => left.round - right.round)
    .map((pairing) => colorIn(pairing, startNumber))
    .filter((color): color is "white" | "black" => color !== null);
  if (!cache) { cache = new Map(); colorHistories.set(snapshot, cache); }
  cache.set(key, history);
  return history;
}

function preferredColor(history: Array<"white" | "black">): "white" | "black" | null {
  if (history.length === 0) return null;
  const white = history.filter((color) => color === "white").length;
  const black = history.length - white;
  const last = history.at(-1)!;
  if (history.at(-2) === last) return last === "white" ? "black" : "white";
  if (white > black) return "black";
  if (black > white) return "white";
  return last === "white" ? "black" : "white";
}

function opposite(color: "white" | "black"): "white" | "black" {
  return color === "white" ? "black" : "white";
}

function colorCompatibility(
  mine: "white" | "black" | null,
  theirs: "white" | "black" | null,
): number {
  if (!mine && !theirs) return 0.62;
  if (!mine || !theirs) return 0.76;
  return mine === opposite(theirs) ? 1 : 0.22;
}

function alreadyPlayed(snapshot: TournamentSnapshot, startNumber: number): Set<number> {
  const opponents = new Set<number>();
  for (const pairing of snapshot.pairings) {
    const opponent = opponentNumber(pairing, startNumber);
    if (opponent !== null && !unplayedResult(pairing)) opponents.add(opponent);
  }
  return opponents;
}

function projectedField(
  snapshot: TournamentSnapshot,
  targetRound: number,
  players: Map<number, TournamentPlayer>,
): ProjectedPlayer[] {
  const virtualPoints = swissAccelerationPoints(snapshot, targetRound);
  return snapshot.players
    .filter(
      (player) => player.active && !player.notPairedRounds?.includes(targetRound),
    )
    .map((player) => ({
      player,
      distribution: projectedPoints(snapshot, player.startNumber, targetRound, players).map(state => ({
        ...state, points: state.points + (virtualPoints.get(player.startNumber) ?? 0),
      })),
    }));
}

// Snapshots are immutable fetch/replay values, as in the whole-field solver.
// Share field projection and score-group positions across tracked players.
const projectedFields = new WeakMap<TournamentSnapshot, {
  round: number;
  field: ProjectedPlayer[];
  byStartNumber: Map<number, ProjectedPlayer>;
  positions: Map<string, { index: number; size: number }>;
}>();

function preparedField(snapshot: TournamentSnapshot, round: number, players: Map<number, TournamentPlayer>) {
  const cached = projectedFields.get(snapshot);
  if (cached?.round === round) return cached;
  const field = projectedField(snapshot, round, players);
  const prepared = { round, field, byStartNumber: new Map(field.map(row => [row.player.startNumber, row])),
    positions: new Map<string, { index: number; size: number }>() };
  projectedFields.set(snapshot, prepared);
  return prepared;
}

function probabilityAt(distribution: WeightedPoints[], points: number): number {
  return distribution.find((state) => Math.abs(state.points - points) <= SCORE_EPSILON)?.weight ?? 0;
}

function expectedGroupPosition(
  field: ProjectedPlayer[],
  startNumber: number,
  points: number,
  cache: Map<string, { index: number; size: number }>,
): { index: number; size: number } {
  const key = `${startNumber}:${points}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let index = 0;
  let size = 0;
  for (const row of field) {
    const probability = probabilityAt(row.distribution, points);
    size += probability;
    if (row.player.startNumber < startNumber) index += probability;
  }
  const position = { index, size };
  cache.set(key, position);
  return position;
}

function pairingBandScore(
  field: ProjectedPlayer[],
  mine: ProjectedPlayer,
  theirs: ProjectedPlayer,
  decay: number,
  positionCache: Map<string, { index: number; size: number }>,
): number {
  let score = 0;
  for (const mineState of mine.distribution) {
    for (const theirState of theirs.distribution) {
      if (Math.abs(mineState.points - theirState.points) > SCORE_EPSILON) continue;
      const minePosition = expectedGroupPosition(
        field,
        mine.player.startNumber,
        mineState.points,
        positionCache,
      );
      const theirPosition = expectedGroupPosition(
        field,
        theirs.player.startNumber,
        theirState.points,
        positionCache,
      );
      const groupSize = Math.max(2, Math.round(minePosition.size));
      const half = Math.ceil(groupSize / 2);
      const target =
        minePosition.index < half
          ? minePosition.index + half
          : minePosition.index - half;
      const distance = Math.abs(theirPosition.index - target);
      score += mineState.weight * theirState.weight * Math.exp(-distance / decay);
    }
  }
  return Math.max(0.02, score);
}

function roundRobinOpponent(
  players: TournamentPlayer[],
  myStartNumber: number,
  round: number,
): number | null {
  const entrants: Array<number | null> = players
    .map((player) => player.startNumber)
    .sort((left, right) => left - right);
  if (!entrants.includes(myStartNumber) || entrants.length < 2) return null;
  if (entrants.length % 2 === 1) entrants.push(null);
  const cycleLength = entrants.length - 1;
  if (cycleLength <= 0) return null;
  const cycleRound = ((round - 1) % cycleLength) + 1;
  // FIDE Berger numbering: rotate by half the padded field each round.
  const pivot = ((cycleRound - 1) * (entrants.length / 2)) % cycleLength;
  const pairs: Array<[number | null, number | null]> = [[entrants[pivot], entrants[cycleLength]]];
  for (let index = 1; index < entrants.length / 2; index += 1) {
    pairs.push([entrants[(pivot + index) % cycleLength], entrants[(pivot - index + cycleLength) % cycleLength]]);
  }
  for (const [left, right] of pairs) {
    if (left === myStartNumber) return right;
    if (right === myStartNumber) return left;
  }
  return null;
}

function fixedForecast(
  kind: "confirmed" | "scheduled" | "inferred",
  round: number,
  player: TournamentPlayer,
  color: "white" | "black" | null,
  board: number | null,
): PairingForecast {
  return {
    kind,
    round,
    confidence: kind === "inferred" ? "low" : "confirmed",
    candidates: [
      {
        player,
        probability: 1,
        color,
        board,
        reasons: [kind === "confirmed" ? "Published by the tournament" : "Assumes standard Berger numbering"],
      },
    ],
    otherProbability: 0,
    summary:
      kind === "confirmed"
        ? `Round ${round} pairing published`
        : kind === "inferred" ? `Expected round ${round} opponent (Berger table)` : `Round ${round} opponent fixed by the schedule`,
    caveat: kind === "inferred" ? "Predicted from the players’ starting numbers. A different schedule could change the opponent; the organiser has not confirmed this pairing." : kind === "scheduled" ? "The organizer can still amend the published schedule." : null,
  };
}

function liveRoundResolvedFraction(snapshot: TournamentSnapshot): number | null {
  if (snapshot.liveRound === null) return null;
  const pairings = snapshot.pairings.filter(
    (pairing) =>
      pairing.round === snapshot.liveRound &&
      pairing.whiteStartNumber !== null &&
      pairing.blackStartNumber !== null,
  );
  if (pairings.length === 0) return 0;
  return pairings.filter((pairing) => publishedGameResult(pairing) !== null).length / pairings.length;
}

export function calculatePairingForecast(
  snapshot: TournamentSnapshot,
  myStartNumber: number,
  options?: PairingForecastCalculationOptions,
): PairingForecast {
  snapshot = normalizeTournamentResults(snapshot);
  const model =
    snapshot.liveRound === null ? BETWEEN_ROUND_PRIMARY_MODEL : LIVE_ROUND_PRIMARY_MODEL;
  const players = playerMap(snapshot);
  const me = players.get(myStartNumber);
  const targetRound = snapshot.nextRound;
  if (!me) {
    return {
      kind: "unavailable",
      round: targetRound,
      confidence: "unavailable",
      candidates: [],
      otherProbability: 0,
      summary: "Select your name from the tournament roster",
      caveat: null,
    };
  }
  if (snapshot.phase === "complete") {
    return {
      kind: "complete",
      round: null,
      confidence: "unavailable",
      candidates: [],
      otherProbability: 0,
      summary: "Tournament complete",
      caveat: null,
    };
  }
  if (targetRound === null) {
    return {
      kind: "complete",
      round: null,
      confidence: "unavailable",
      candidates: [],
      otherProbability: 0,
      summary:
        snapshot.liveRound !== null
          ? `Round ${snapshot.liveRound} is the final round`
          : "No next round remains",
      caveat:
        snapshot.liveRound !== null ? "There is no later pairing to forecast." : null,
    };
  }

  const published = pairingFor(snapshot, targetRound, myStartNumber);
  if (published) {
    const publishedOpponent = opponentNumber(published, myStartNumber);
    const opponent = publishedOpponent === null ? undefined : players.get(publishedOpponent);
    if (opponent) {
      return fixedForecast(
        "confirmed",
        targetRound,
        opponent,
        colorIn(published, myStartNumber),
        published.board,
      );
    }
    if (publishedOpponent !== null) {
      return {
        kind: "unavailable",
        round: targetRound,
        confidence: "unavailable",
        candidates: [],
        otherProbability: 0,
        summary: `Round ${targetRound} pairing could not be matched to the roster`,
        caveat: "Refresh the tournament after Chess-Results finishes updating its player list.",
      };
    }
    return {
      kind: "confirmed",
      round: targetRound,
      confidence: "confirmed",
      candidates: [],
      otherProbability: 0,
      ...publishedNoOpponentCopy(published, targetRound),
    };
  }
  if (!me.active || me.notPairedRounds?.includes(targetRound)) {
    const requestedBye = me.halfPointByeRounds?.includes(targetRound) ?? false;
    return {
      kind: "scheduled",
      round: targetRound,
      confidence: "confirmed",
      candidates: [],
      otherProbability: 0,
      summary: requestedBye
        ? `Round ${targetRound} requested bye recorded`
        : `${me.name} is not listed for pairing in round ${targetRound}`,
      caveat: requestedBye
        ? "Chess-Results lists this as a requested bye, so there is no opponent to prepare for."
        : "Chess-Results marks this player as not paired for the round.",
    };
  }
  if (snapshot.pairings.some((pairing) => pairing.round === targetRound)) {
    return {
      kind: "unavailable",
      round: targetRound,
      confidence: "unavailable",
      candidates: [],
      otherProbability: 0,
      summary: `No round ${targetRound} pairing is published for ${me.name}`,
      caveat: "The organizer may still be assigning a bye or updating the pairing list.",
    };
  }

  if (snapshot.format === "round-robin") {
    // Only earlier published assignments may validate the assumed schedule.
    // Check actual opponents even when the result is unfinished or forfeited.
    const conflicts = snapshot.pairings.some((pairing) => {
      if (pairing.round >= targetRound || pairing.round < 1) return false;
      const white = pairing.whiteStartNumber;
      const black = pairing.blackStartNumber;
      if (white === null && black === null) return false;
      const seat = white ?? black!;
      const other = white === null ? null : black;
      return !players.has(seat) || (other !== null && !players.has(other)) ||
        roundRobinOpponent(snapshot.players, seat, pairing.round) !== other;
    });
    if (conflicts || players.size !== snapshot.players.length || players.size < 2) {
      return {
        kind: "unavailable", round: targetRound, confidence: "unavailable",
        candidates: [], otherProbability: 0,
        summary: "Published rounds do not match the assumed Berger schedule",
        caveat: "A different draw, round order or changed roster may apply. Wait for the organizer to publish the next pairing.",
      };
    }
    const scheduled = roundRobinOpponent(snapshot.players, myStartNumber, targetRound);
    const opponent = scheduled === null ? undefined : players.get(scheduled);
    if (opponent) {
      if (!opponent.active || opponent.notPairedRounds?.includes(targetRound)) {
        return {
          kind: "unavailable", round: targetRound, confidence: "unavailable",
          candidates: [], otherProbability: 0,
          summary: "The expected opponent is not listed for pairing",
          caveat: "Wait for the organizer to confirm a replacement pairing or bye.",
        };
      }
      return fixedForecast("inferred", targetRound, opponent, null, null);
    }
    if (snapshot.players.length % 2 === 1) {
      return {
        kind: "inferred",
        round: targetRound,
        confidence: "low",
        candidates: [],
        otherProbability: 0,
        summary: `Expected round ${targetRound} bye (Berger table)`,
        caveat: "Predicted from the players’ starting numbers. The organiser has not confirmed this pairing.",
      };
    }
  }
  if (snapshot.format !== "swiss") {
    return {
      kind: "unavailable",
      round: targetRound,
      confidence: "unavailable",
      candidates: [],
      otherProbability: 0,
      summary:
        snapshot.format === "team"
          ? "Team-board forecasts are not available yet"
          : `Forecasting is not available for ${snapshot.formatLabel}`,
      caveat: "The roster can still be tracked and opponent databases kept together.",
    };
  }

  const priorOpponents = alreadyPlayed(snapshot, myStartNumber);
  const { field, byStartNumber: projectedByStartNumber, positions: groupPositionCache } = preparedField(snapshot, targetRound, players);
  const mineRow = projectedByStartNumber.get(myStartNumber);
  const mine = mineRow?.distribution ?? [];
  const mineExpected = expectedPoints(mine);
  const minePreferred = preferredColor(colorHistory(snapshot, myStartNumber, targetRound));
  const liveUncertainty = snapshot.liveRound !== null;
  const coverageModel = liveUncertainty
    ? LIVE_ROUND_COVERAGE_MODEL
    : BETWEEN_ROUND_COVERAGE_MODEL;
  const ranked: RankedCandidate[] = [];

  for (const player of snapshot.players) {
    if (
      !player.active ||
      player.notPairedRounds?.includes(targetRound) ||
      player.startNumber === myStartNumber ||
      priorOpponents.has(player.startNumber)
    ) {
      continue;
    }
    const theirRow = projectedByStartNumber.get(player.startNumber);
    if (!mineRow || !theirRow) continue;
    const theirs = theirRow.distribution;
    const overlap = scoreGroupOverlap(mine, theirs);
    const theirsExpected = expectedPoints(theirs);
    const theirsPreferred = preferredColor(colorHistory(snapshot, player.startNumber, targetRound));
    const color = minePreferred ?? (theirsPreferred ? opposite(theirsPreferred) : null);
    const colorFit = colorCompatibility(minePreferred, theirsPreferred);
    const band = pairingBandScore(
      field,
      mineRow,
      theirRow,
      model.pairingBandDecay,
      groupPositionCache,
    );
    const coverageBand = pairingBandScore(
      field,
      mineRow,
      theirRow,
      coverageModel.pairingBandDecay,
      groupPositionCache,
    );
    const ratingFit =
      me.rating && player.rating
        ? 1 - Math.min(Math.abs(me.rating - player.rating) / 900, 1)
        : 0.5;
    const raw = Math.max(
      0.0001,
      overlap * model.scoreGroupWeight +
        band * model.pairingBandWeight +
        colorFit * model.colorWeight +
        ratingFit * model.ratingWeight,
    );
    const coverageRaw = Math.max(
      0.0001,
      overlap * coverageModel.scoreGroupWeight +
        coverageBand * coverageModel.pairingBandWeight +
        colorFit * coverageModel.colorWeight +
        ratingFit * coverageModel.ratingWeight,
    );
    const reasons = [
      Math.abs(mineExpected - theirsExpected) <= 0.12
        ? "Same projected score group"
        : Math.abs(mineExpected - theirsExpected) <= 0.55
          ? "Adjacent score group"
          : "Possible floater",
      band >= 0.55 ? "Matches the likely top-half / bottom-half slot" : null,
      colorFit >= 0.9 ? "Colour histories fit" : null,
    ].filter((reason): reason is string => reason !== null);
    ranked.push({ player, raw, coverageRaw, color, reasons });
  }

  ranked.sort(
    (left, right) =>
      right.raw - left.raw ||
      (left.player.rank ?? left.player.startNumber) -
        (right.player.rank ?? right.player.startNumber),
  );
  const coverageRanked = [...ranked].sort(
    (left, right) =>
      right.coverageRaw - left.coverageRaw ||
      (left.player.rank ?? left.player.startNumber) -
        (right.player.rank ?? right.player.startNumber),
  );
  const selected: RankedCandidate[] = [];
  const appendUnique = (candidate: RankedCandidate | undefined) => {
    if (
      candidate &&
      !selected.some((item) => item.player.startNumber === candidate.player.startNumber)
    ) {
      selected.push(candidate);
    }
  };
  const historyIncomplete = snapshot.incompletePairingRounds?.some(round => round > 0 && round < targetRound) ?? false;
  const unscoredHistory = hasUnscoredNoOpponentHistory(snapshot, targetRound);
  const exact = historyIncomplete || unscoredHistory ? null : options?.exactSwiss ?? null;
  const exactSystemLabel = exact
    ? `${exact.system.charAt(0).toLocaleUpperCase()}${exact.system.slice(1)}`
    : "Dutch";
  const exactAccelerationLabel =
    exact?.acceleration === "baku"
      ? " with Baku acceleration"
      : exact?.acceleration === "two-stage"
        ? " with inferred acceleration"
        : "";
  const sampledUsed = exact?.sampling?.samples === 16 && exact.sampling.successful === 16;
  let exactUsed = false;
  if (exact?.opponentStartNumber !== null && exact?.opponentStartNumber !== undefined) {
    const exactCandidate = ranked.find(
      (candidate) => candidate.player.startNumber === exact.opponentStartNumber,
    );
    if (exactCandidate) {
      exactUsed = true;
      appendUnique({
        ...exactCandidate,
        color: exact.color,
        reasons: [
          sampledUsed
            ? `Whole-field ${exactSystemLabel} pairings across 16 sampled outcome scenarios`
            : exact.estimatedLiveResults
            ? `Whole-field ${exactSystemLabel}${exactAccelerationLabel} pairing after likely live results`
            : `Whole-field FIDE ${exactSystemLabel}${exactAccelerationLabel} reconstruction`,
          ...exactCandidate.reasons,
        ],
      });
    }
  }
  ranked.slice(0, liveUncertainty ? 1 : 2).forEach(appendUnique);
  coverageRanked.forEach(appendUnique);
  ranked.forEach(appendUnique);
  // Use only the selected player's visible preceding assignment. Missing rows
  // remain unknown; future results and standings never determine this feature.
  const ownLivePairing = snapshot.liveRound === targetRound - 1
    ? snapshot.pairings.find(pairing => pairing.round === snapshot.liveRound &&
      (pairing.whiteStartNumber === myStartNumber || pairing.blackStartNumber === myStartNumber))
    : undefined;
  const ownLiveResultKnown = ownLivePairing ? publishedPairingScore(ownLivePairing, myStartNumber) !== null : null;
  const probabilities = contextualSwissProbabilities(
    calibratedRankProbabilities(exactUsed, targetRound, liveRoundResolvedFraction(snapshot), snapshot.players.length, ownLiveResultKnown),
    exact, exactUsed, targetRound, snapshot.players.length, Math.min(6, selected.length),
  );
  const attendance = estimatedAttendance(snapshot, myStartNumber, targetRound);
  const participationAssumed = attendance < 1 || swissParticipationScenario(snapshot, targetRound) !== snapshot;
  // Keep conditional ordering and preparation available, but do not attach a
  // probability to unvalidated opening rules or explicitly incomplete history.
  // Published assignments above keep their authoritative status.
  const probabilityUnknown = snapshot.format === "swiss" && (targetRound === 1 || historyIncomplete);
  const candidates = selected.slice(0, 6).map<PairingCandidate>((candidate, index) => ({
    player: candidate.player, probability: probabilityUnknown ? null : probabilities[index] * attendance, color: candidate.color, board: null, reasons: candidate.reasons,
  }));
  const otherProbability = probabilityUnknown ? null : Math.max(0, 1 - probabilities.slice(0, candidates.length).reduce((sum, value) => sum + value * attendance, 0));
  const top = candidates[0]?.probability ?? 0;
  const confidence = top >= 0.7 ? "high" : top >= 0.32 ? "medium" : "low";
  const sectionSuffix = snapshot.section ? ` in ${snapshot.section}` : "";
  const sectionScope = snapshot.section
    ? ` Only players in the ${snapshot.section} section are considered.`
    : "";

  return {
    kind: candidates.length > 0 ? "estimated" : "unavailable",
    round: targetRound,
    confidence: candidates.length > 0 && !probabilityUnknown ? confidence : "unavailable",
    candidates,
    otherProbability: candidates.length > 0 ? otherProbability : 0,
    summary:
      candidates.length === 0
        ? "No legal opponent candidates found"
        : liveUncertainty
          ? `Round ${targetRound} estimate${sectionSuffix} while round ${snapshot.liveRound} is live`
          : `Likely round ${targetRound} opponents${sectionSuffix}`,
    caveat:
      candidates.length === 0
        ? "Withdrawals or unpublished pairing settings may explain the missing candidates."
        : historyIncomplete
          ? "Some earlier pairing rows are missing, so pairing chances are unavailable. Candidates use incomplete history; refresh to check for the complete list."
        : probabilityUnknown
          ? "Round 1 pairing chances are not calibrated. The opponent order assumes pairing rules and starting order; final entries and organiser settings can change it."
        : unscoredHistory
          ? "An earlier no-opponent row has no score. Estimates may change when the organizer publishes it."
          : participationAssumed
          ? `Recent zero-point absences are treated as continued absences in the pairing estimate. Players can return; this is not a confirmed withdrawal. Other includes a possible bye or continued absence.${sectionScope}`
          : sampledUsed
          ? `Sixteen possible completions of unfinished games were paired as whole fields. Chances are calibrated from small-event replays, not the fraction of samples; unknown availability and organizer settings still matter.${exact?.opponentStartNumber === null ? " Sampling suggests a possible bye; named opponents are alternatives and Other includes the bye." : ""}${sectionScope}`
          : exactUsed && exact?.history
          ? `Chances use this event's earlier reconstruction results, blended with previous tournament benchmarks. The estimate still assumes the same pairing rules and participation.${sectionScope}`
          : exact?.opponentStartNumber === null && !exact.estimatedLiveResults
          ? `Whole-field reconstruction suggests a possible bye. Other includes this possibility; named opponents remain estimates until pairings are published.${sectionScope}`
          : exactUsed
          ? exact?.acceleration === "two-stage"
            ? `A whole-field FIDE ${exactSystemLabel} reconstruction uses an acceleration pattern inferred from the published first-round pairings and is combined with replay-calibrated alternatives.${sectionScope} Protected pairings, late changes, and other unpublished organizer settings can still change the result.`
            : `A whole-field FIDE ${exactSystemLabel}${exactAccelerationLabel} reconstruction is combined with replay-calibrated alternatives.${sectionScope} Acceleration, protected pairings, late changes, and other unpublished organizer settings can still change the result.`
          : `Approximate likelihoods calibrated from completed Chess-Results replays.${sectionScope} Whole-field reconstruction is not available for this estimate; hidden settings and arbiter changes remain unknown.`,
  };
}

export function formatForecastPercent(probability: number | null): string {
  if (probability === null) return "Unknown";
  if (!Number.isFinite(probability) || probability <= 0) return "--";
  if (probability < 0.01) return "<1%";
  return `~${Math.max(1, Math.round(probability * 100))}%`;
}

export function tournamentPhaseLabel(snapshot: TournamentSnapshot): string {
  snapshot = normalizeTournamentResults(snapshot);
  switch (snapshot.phase) {
    case "registration":
      return "Registration open";
    case "pairings-published":
      return `Round ${snapshot.publishedRound} pairings published`;
    case "round-in-progress":
      return `Round ${snapshot.liveRound ?? snapshot.publishedRound} in progress`;
    case "between-rounds":
      return `After round ${snapshot.completedRound}`;
    case "complete":
      return "Tournament complete";
  }
}
