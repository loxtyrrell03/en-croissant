import type { TournamentSnapshot } from "@/features/tournaments/platform";

export type SwissPairingSystem = "dutch" | "burstein" | "dubov" | "lim";
export type SwissAcceleration = "baku" | "two-stage";

export function swissPairingSystemFor(
  snapshot: Pick<TournamentSnapshot, "formatLabel">,
): SwissPairingSystem {
  const label = snapshot.formatLabel.toLocaleLowerCase();
  if (label.includes("burstein")) return "burstein";
  if (label.includes("dubov")) return "dubov";
  if (/\blim\b/.test(label)) return "lim";
  return "dutch";
}

/** A city or venue in the event title is not a pairing-method declaration.
 * A method-specific format label or an explicit title phrase is usable evidence.
 * History inference and caller-provided overrides remain separate inputs. */
export function declaredSwissAcceleration(
  snapshot: Pick<TournamentSnapshot, "formatLabel" | "title">,
): SwissAcceleration | null {
  const explicitFormat = /\bbaku\b/i.test(snapshot.formatLabel);
  const explicitTitle = /\bbaku[\s-]+(?:acceleration|accelerated|beschleunigung)\b/i.test(snapshot.title);
  return explicitFormat || explicitTitle ? "baku" : null;
}

export function inferSwissAcceleration(
  snapshot: TournamentSnapshot,
): SwissAcceleration | null {
  const firstRoundGames = snapshot.pairings.filter(
    (pairing) =>
      pairing.round === 1 &&
      pairing.whiteStartNumber !== null &&
      pairing.blackStartNumber !== null,
  );
  if (firstRoundGames.length < 8) return null;

  const participantIds = new Set(
    firstRoundGames.flatMap((pairing) => [
      pairing.whiteStartNumber!,
      pairing.blackStartNumber!,
    ]),
  );
  const orderedParticipants = snapshot.players
    .filter((player) => participantIds.has(player.startNumber))
    .sort((left, right) => left.startNumber - right.startNumber);
  const rankIndex = new Map(
    orderedParticipants.map((player, index) => [player.startNumber, index]),
  );
  const midpoint = orderedParticipants.length / 2;
  const gaps: number[] = [];
  let sameHalfGames = 0;
  for (const pairing of firstRoundGames) {
    const white = rankIndex.get(pairing.whiteStartNumber!);
    const black = rankIndex.get(pairing.blackStartNumber!);
    if (white === undefined || black === undefined) continue;
    gaps.push(Math.abs(white - black));
    if ((white < midpoint) === (black < midpoint)) sameHalfGames += 1;
  }
  gaps.sort((left, right) => left - right);
  const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 0;
  const gapRatio = medianGap / Math.max(1, orderedParticipants.length);
  const sameHalfRatio = sameHalfGames / Math.max(1, firstRoundGames.length);

  // A normal Dutch first round crosses the field midpoint and has a rank gap
  // near one half of the field. Common acceleration schemes split the field
  // into independently paired halves, producing a gap near one quarter instead.
  return gapRatio >= 0.18 && gapRatio <= 0.34 && sameHalfRatio >= 0.8
    ? "two-stage"
    : null;
}

export function accelerationVirtualPoints(
  acceleration: SwissAcceleration,
  targetRound: number,
  totalRounds: number,
): number {
  if (acceleration === "two-stage") {
    if (targetRound <= 2) return 1;
    return targetRound === 3 ? 0.5 : 0;
  }
  const acceleratedRounds = Math.ceil(totalRounds / 2);
  if (targetRound > acceleratedRounds) return 0;
  const fullPointRounds = Math.ceil(acceleratedRounds / 2);
  return targetRound <= fullPointRounds ? 1 : 0.5;
}

/** Virtual points affect pairing groups, never the published standings. */
export function swissAccelerationPoints(snapshot: TournamentSnapshot, targetRound: number): Map<number, number> {
  // Only earlier pairings can establish a rule for this prediction.
  const history = snapshot.pairings.some(p => p.round >= targetRound)
    ? { ...snapshot, pairings: snapshot.pairings.filter(p => p.round < targetRound) } : snapshot;
  const acceleration = declaredSwissAcceleration(snapshot) ?? inferSwissAcceleration(history);
  const points = acceleration === null ? 0 : accelerationVirtualPoints(acceleration, targetRound, snapshot.totalRounds);
  if (points <= 0) return new Map();
  const size = 2 * Math.ceil(snapshot.players.length / 4);
  return new Map([...snapshot.players].sort((a, b) => a.startNumber - b.startNumber)
    .slice(0, size).map(p => [p.startNumber, points]));
}
