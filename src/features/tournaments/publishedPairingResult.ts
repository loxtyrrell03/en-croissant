import type { TournamentPairing, TournamentSnapshot } from "@/features/tournaments/platform";

export type PairingScore = 0 | 0.5 | 1;
export interface PublishedGameResult {
  whiteScore: PairingScore;
  blackScore: PairingScore;
  result: "white" | "black" | "draw" | "none";
  forfeit?: "white" | "black" | "both";
}

export function normalizedPairingResult(value: string | null): string {
  return (value ?? "").replace(/\s+/g, "").replace(/[–—]/g, "-").replace(/,/g, ".").toLowerCase();
}

/** Complete recognized tokens only. A source flag or a numeric substring is
 * not sufficient evidence of a finished game. */
export function publishedGameResult(pairing: TournamentPairing): PublishedGameResult | null {
  if (pairing.whiteStartNumber === null || pairing.blackStartNumber === null || !pairing.decided) return null;
  const text = normalizedPairingResult(pairing.result);
  if (["0-0", "0f-0f", "---"].includes(text)) return { whiteScore: 0, blackScore: 0, result: "none", forfeit: "both" };
  if (["+-", "+--", "1f-0", "1-0f", "1f-0f", "1w-0l"].includes(text))
    return { whiteScore: 1, blackScore: 0, result: "white", forfeit: "black" };
  if (["-+", "--+", "0f-1", "0-1f", "0f-1f", "0l-1w"].includes(text))
    return { whiteScore: 0, blackScore: 1, result: "black", forfeit: "white" };
  if (text === "1-0") return { whiteScore: 1, blackScore: 0, result: "white" };
  if (text === "0-1") return { whiteScore: 0, blackScore: 1, result: "black" };
  if (/^(?:½|1\/2|0?\.5)-(?:½|1\/2|0?\.5)$/.test(text)) return { whiteScore: 0.5, blackScore: 0.5, result: "draw" };
  return null;
}

/** A solo assignment establishes only its occupied seat's explicit award.
 * In older snapshots a published zero has decided=false; it is still zero. */
export function publishedNoOpponentScore(pairing: TournamentPairing): PairingScore | null {
  if ((pairing.whiteStartNumber === null) === (pairing.blackStartNumber === null)) return null;
  const text = normalizedPairingResult(pairing.result);
  const seats = /^(1f?|0f?|1\/2|0?\.5|½|\+|-)?-(1f?|0f?|1\/2|0?\.5|½|\+|-)?$/.exec(text);
  const score = seats ? seats[pairing.whiteStartNumber !== null ? 1 : 2] : text;
  if (score === "0" || score === "0f") return 0;
  if (["½", "1/2", "0.5", ".5"].includes(score ?? "")) return 0.5;
  if (["1", "1f", "+"].includes(score ?? "")) return 1;
  return null;
}

export function publishedPairingScore(pairing: TournamentPairing, player: number): PairingScore | null {
  if (pairing.whiteStartNumber !== player && pairing.blackStartNumber !== player) return null;
  if (pairing.whiteStartNumber === null || pairing.blackStartNumber === null) return publishedNoOpponentScore(pairing);
  const result = publishedGameResult(pairing);
  return result ? pairing.whiteStartNumber === player ? result.whiteScore : result.blackScore : null;
}

export function publishedResultLabel(pairing: TournamentPairing, snapshot: Pick<TournamentSnapshot, "liveRound" | "completedRound">): string {
  if (publishedGameResult(pairing) || publishedNoOpponentScore(pairing) !== null) return pairing.result!.trim();
  if (pairing.whiteStartNumber === null || pairing.blackStartNumber === null) return "Score not reported";
  return pairing.round === snapshot.liveRound || pairing.round <= snapshot.completedRound ? "Awaiting result" : "Scheduled";
}
