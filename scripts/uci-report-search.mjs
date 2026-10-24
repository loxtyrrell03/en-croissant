// One position's bounded report search. The caller owns the engine queue slot
// across both searches; recovery never becomes a second independent job.
export function validReportSearchLimits(value) {
  return (
    !!value &&
    typeof value === "object" &&
    Number.isSafeInteger(value.depth) &&
    value.depth >= 2 &&
    value.depth <= 30 &&
    Number.isSafeInteger(value.timeMs) &&
    value.timeMs >= 50 &&
    value.timeMs <= 5000
  );
}

export function exactReportRoot(line, limits, multipv) {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "info" || tokens.includes("lowerbound") || tokens.includes("upperbound"))
    return null;
  const depth = Number(tokens[tokens.indexOf("depth") + 1]);
  const rankIndex = tokens.indexOf("multipv");
  const rank = rankIndex < 0 ? 1 : Number(tokens[rankIndex + 1]);
  const score = tokens.indexOf("score"),
    pv = tokens.indexOf("pv");
  if (
    !Number.isSafeInteger(depth) ||
    depth < 1 ||
    depth > limits.depth ||
    !Number.isSafeInteger(rank) ||
    rank < 1 ||
    rank > multipv ||
    score < 0 ||
    !["cp", "mate"].includes(tokens[score + 1]) ||
    !/^-?\d+$/.test(tokens[score + 2] ?? "") ||
    pv < 0 ||
    pv + 1 >= tokens.length ||
    !Number.isSafeInteger(Number(tokens[score + 2])) ||
    !tokens.slice(pv + 1).every(validUciMove)
  )
    return null;
  return tokens[pv + 1];
}

const validUciMove = (move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move ?? "");
const checkAbort = (signal) => {
  if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
};

export async function runBoundedUciReport({
  limits,
  multipv,
  runSearch,
  onInfo,
  signal,
  setMultiPv = () => {},
  now = () => performance.now(),
}) {
  if (!validReportSearchLimits(limits))
    throw new Error("Choose valid report depth and time limits.");
  checkAbort(signal);
  const exactRoots = new Set();
  const collect = (line) => {
    const root = exactReportRoot(line, limits, multipv);
    if (root) exactRoots.add(root);
    onInfo(line);
  };
  const started = now();
  const reserve = Math.ceil(limits.timeMs / 5);
  const selected = await runSearch(
    `go depth ${limits.depth} movetime ${limits.timeMs - reserve}`,
    collect,
    signal,
    limits.timeMs + 2000,
  );
  checkAbort(signal);
  if (!validUciMove(selected)) throw new Error("The report engine returned no legal best move.");
  if (exactRoots.has(selected)) return selected;

  const remaining = Math.floor(limits.timeMs - (now() - started));
  if (remaining < 1)
    throw new Error("The position budget ended without an exact selected-move score.");
  // The queue slot is still held. Changing MultiPV does not start another job.
  await setMultiPv(1);
  checkAbort(signal);
  const recoveryTime = Math.floor(limits.timeMs - (now() - started));
  if (recoveryTime < 1) throw new Error("The position budget ended before score recovery.");
  const recovered = await runSearch(
    `go depth ${Math.min(limits.depth, 12)} movetime ${recoveryTime} searchmoves ${selected}`,
    (line) => {
      if (exactReportRoot(line, { ...limits, depth: Math.min(limits.depth, 12) }, 1) === selected)
        exactRoots.add(selected);
      onInfo(line);
    },
    signal,
    recoveryTime + 2000,
  );
  checkAbort(signal);
  if (recovered !== selected || !exactRoots.has(selected))
    throw new Error("The report engine did not provide an exact selected-move score.");
  return selected;
}
