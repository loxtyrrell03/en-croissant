// Prefer the amount and completeness of analysis before its timestamp. This
// prevents a newer shallow phone result from replacing the saved PC batch.
export function compareStatsEntryQuality(left, right) {
  const leftQuality = statsEntryQuality(left);
  const rightQuality = statsEntryQuality(right);
  for (let index = 0; index < leftQuality.length; index += 1) {
    const difference = leftQuality[index] - rightQuality[index];
    if (difference !== 0) return difference;
  }
  return (Number(left?.ts) || 0) - (Number(right?.ts) || 0);
}

function statsEntryQuality(entry) {
  const batch = entry?.batchAnalysis;
  return [
    batch ? 1 : 0,
    Math.max(0, Number(batch?.targetDepth) || 0),
    batch?.nodeLimit === null
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, Number(batch?.nodeLimit) || 0),
    entry?.advanced && entry?.opponentQuality?.advanced ? 1 : 0,
    Math.max(0, Number(entry?.stats?.analysisDepth) || 0),
    Math.max(0, Number(entry?.stats?.scoredCount) || 0),
  ];
}
