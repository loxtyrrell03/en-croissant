import {
  Alert,
  Badge,
  Button,
  Group,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WebColor, WebCompanionState, WebEngineLine, WebImportResult } from "./model";
import { analyzeWithWebStockfish18, releaseWebPcEngine } from "./stockfishEngine";
import { fetchWebOnlineGames } from "./onlineImport";
import { parsePgnDatabase, playUciMove } from "./pgn";
import {
  createPhoneReviewCard,
  emptyPhoneReview,
  gradePhoneReview,
  playerKey,
  reviewChance,
  reviewCp,
  reviewPlayerColor,
  reviewScanKey,
  selectDailyReview,
  selectGameReviewCards,
  type PhoneReviewCard,
  type PhoneReviewState,
} from "./mistakeReview";
import classes from "./WebApp.module.css";
import { sharedReviewRequest, type SharedReviewSnapshot } from "./sharedReviewClient";

type Props = {
  state: WebCompanionState;
  onSave: (review: PhoneReviewState) => void;
  onImport: (result: WebImportResult) => void;
  renderBoard: (
    fen: string,
    color: WebColor,
    onMove: (uci: string) => void,
    lastMove: string | null,
    interactive: boolean,
  ) => ReactNode;
};
export default function PhoneMistakeReview({ state, onSave, onImport, renderBoard }: Props) {
  const saved = state.mistakeReview ?? emptyPhoneReview();
  const [player, setPlayer] = useState(saved.player);
  const [source, setSource] = useState("saved");
  const [database, setDatabase] = useState<string | null>(null);
  const [count, setCount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, text: "" });
  const [error, setError] = useState("");
  const [session, setSession] = useState<PhoneReviewCard[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [lineIndex, setLineIndex] = useState(0);
  const [shared, setShared] = useState<SharedReviewSnapshot | null>(null);
  const [otherGames, setOtherGames] = useState(false);
  const [syncError, setSyncError] = useState("");
  const sharedMode = !!shared && Object.values(shared.accounts).some(Boolean) && !otherGames;
  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await sharedReviewRequest(
          "",
          undefined,
          AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
        );
        if (!abort.signal.aborted) {
          setShared((current) =>
            !current || next.updatedAt >= current.updatedAt ? next : current,
          );
          setSyncError("");
        }
      } catch {
        if (!abort.signal.aborted)
          setSyncError(
            "PC reviews are temporarily unavailable. Saved imported-game reviews are still available.",
          );
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  const controller = useRef<AbortController | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  const queue = sharedMode
    ? selectDailyReview(shared.cards)
    : selectDailyReview(saved.cards, Date.now(), player);
  const games = useMemo(
    () =>
      Object.entries(state.gamesByDatabase)
        .filter(([id]) => !database || id === database)
        .flatMap(([, items]) => items),
    [database, state.gamesByDatabase],
  );
  const eligibleCount = games.filter(
    (g) => reviewPlayerColor(g, player) && !saved.scanned.includes(reviewScanKey(g, player)),
  ).length;
  const card = session?.[0];
  async function scan() {
    if (busy || !player.trim()) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    let completed = 0;
    try {
      let input = games;
      let importedToSave: WebImportResult | null = null;
      if (source !== "saved") {
        setProgress({ done: 0, total: 0, text: "Importing games…" });
        const fetched = await fetchWebOnlineGames({
          source: source as "chesscom" | "lichess",
          username: player.trim(),
          mode: "count",
          count: Number(count),
          range: "all",
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        const imported = parsePgnDatabase(
          `${player.trim()} · ${source}`,
          fetched.map((g) => g.pgn).join("\n\n"),
        );
        if (!imported.games.length) throw new Error("No readable games found for that username.");
        importedToSave = imported;
        input = imported.games;
      }
      const seen = new Set<string>();
      const candidates = input
        .filter((g) => reviewPlayerColor(g, player) && g.moves.length > 0)
        .sort((a, b) => b.date.localeCompare(a.date))
        .filter((g) => {
          const key = reviewScanKey(g, player);
          if (seen.has(key) || savedRef.current.scanned.includes(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, count === "all" ? undefined : Number(count));
      if (!candidates.length) {
        setProgress({
          done: 0,
          total: 0,
          text: "No new games to scan for this player. Import more games or choose another database.",
        });
        return;
      }
      if (importedToSave) onImport(importedToSave);
      let working = { ...savedRef.current, player: player.trim() };
      for (const game of candidates) {
        const collected: PhoneReviewCard[] = [];
        const color = reviewPlayerColor(game, player)!;
        const ownMoves = game.moves
          .map((m, i) => ({ m, i }))
          .filter(({ m }) => m.color === color && m.uci);
        for (let n = 0; n < ownMoves.length; n++) {
          if (abort.signal.aborted) return;
          const { m, i } = ownMoves[n];
          setProgress({
            done: completed + n / Math.max(1, ownMoves.length),
            total: candidates.length,
            text: `Game ${completed + 1}/${candidates.length} · move ${Math.ceil((i + 1) / 2)}`,
          });
          const analyze = async (fen: string): Promise<WebEngineLine> => {
            const lines = await analyzeWithWebStockfish18({
              fen,
              depth: 14,
              multipv: 1,
              preferStoredEvaluation: true,
              minimumStoredDepth: 14,
              signal: abort.signal,
            });
            if (!lines[0] || lines[0].depth < 14)
              throw new Error(
                "The engine did not finish this position. Completed games are saved; retry to resume.",
              );
            return lines[0];
          };
          const best = await analyze(m.fenBefore);
          if (best.uciMoves[0] === m.uci || reviewChance(reviewCp(best.score, color)) < 15)
            continue;
          // Checkmate/stalemate positions have no PV. Their result is exact.
          const played = playUciMove(m.fenBefore, m.uci!);
          if (!played) continue;
          let reply: WebEngineLine;
          const { positionFromFen } = await import("@/utils/chessops");
          const position = positionFromFen(m.fenAfter)[0];
          const outcome = position?.outcome();
          if (outcome)
            reply = {
              ...best,
              score: {
                type: "cp",
                value: outcome.winner ? (outcome.winner === "white" ? 10000 : -10000) : 0,
              },
              uciMoves: [],
              sanMoves: [],
            };
          else reply = await analyze(m.fenAfter);
          const next = createPhoneReviewCard(game, i, player, best, reply);
          if (next) collected.push(next);
        }
        if (abort.signal.aborted) return;
        const selected = selectGameReviewCards(collected);
        const ids = new Set(working.cards.map((c) => c.id));
        working = {
          ...working,
          cards: [...working.cards, ...selected.filter((c) => !ids.has(c.id))],
          scanned: [...working.scanned, reviewScanKey(game, player)],
        };
        savedRef.current = working;
        saveRef.current(working);
        completed++;
      }
      setProgress({
        done: completed,
        total: completed,
        text: `${completed} games reviewed. ${selectDailyReview(savedRef.current.cards, Date.now(), player).length} positions ready for today.`,
      });
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not review these games.");
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        void releaseWebPcEngine("stockfish");
      }
      setBusy(false);
    }
  }
  async function attempt(uci: string) {
    if (!card || revealed || checking || preview) return;
    const move = playUciMove(card.fen, uci);
    if (!move) return;
    setPreview(move.fenAfter);
    setLastMove(uci);
    if (uci === card.best) {
      setFeedback("Correct — you found the best move.");
      setRevealed(true);
      return;
    }
    setChecking(true);
    setFeedback("Checking your move…");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const played = playUciMove(card.fen, uci)!;
      const lines = await analyzeWithWebStockfish18({
        fen: played.fenAfter,
        depth: 14,
        multipv: 1,
        preferStoredEvaluation: true,
        minimumStoredDepth: 14,
        signal: abort.signal,
      });
      const line = lines[0];
      if (!line || line.depth < 14)
        throw new Error("The engine could not finish checking that move.");
      const drop = card.before - reviewChance(reviewCp(line.score, card.color));
      if (drop <= 5) {
        setFeedback("Good alternative — your move preserves the position’s chances.");
        setRevealed(true);
      } else setFeedback("There is a stronger move. Try again, or reveal the solution.");
    } catch {
      if (!abort.signal.aborted)
        setFeedback("Could not check that move. Try again or reveal the solution.");
    } finally {
      setChecking(false);
      if (controller.current === abort) {
        controller.current = null;
        void releaseWebPcEngine("stockfish");
      }
    }
  }
  async function grade(value: "again" | "good" | "easy" | "hide") {
    if (!card || checking) return;
    if (sharedMode) {
      setChecking(true);
      try {
        setShared(
          await sharedReviewRequest("/grade", {
            id: card.id,
            grade: value,
            expectedReviews: card.reviews,
          }),
        );
      } catch (e) {
        setFeedback(e instanceof Error ? e.message : "Could not save this review.");
        return;
      } finally {
        setChecking(false);
      }
    } else
      onSave({
        ...savedRef.current,
        cards: savedRef.current.cards.map((c) =>
          c.id === card.id ? gradePhoneReview(c, value) : c,
        ),
      });
    setSession((current) => current?.slice(1) ?? null);
    setRevealed(false);
    setFeedback("");
    setPreview(null);
    setLastMove(null);
    setLineIndex(0);
  }
  function showLine(index: number) {
    if (!card) return;
    let fen = card.fen;
    let last: string | null = null;
    let reached = 0;
    for (const uci of card.pv.slice(0, index)) {
      const move = playUciMove(fen, uci);
      if (!move) break;
      fen = move.fenAfter;
      last = uci;
      reached++;
    }
    setPreview(fen);
    setLastMove(last);
    setLineIndex(reached);
  }
  if (session)
    return (
      <section className={classes.reviewSession} aria-label="Daily review">
        <header className={classes.reviewSessionHeader}>
          <div>
            <strong>Daily review</strong>
            <Text size="xs" c="dimmed">
              {card
                ? `${session.length} left · ${card.color === "white" ? "White" : "Black"} to move`
                : "Complete"}
            </Text>
          </div>
          <Button
            variant="subtle"
            disabled={checking}
            onClick={() => {
              setSession(null);
              setRevealed(false);
              setPreview(null);
              setLastMove(null);
              setLineIndex(0);
              setFeedback("");
            }}
          >
            Close
          </Button>
        </header>
        {card ? (
          <>
            <div className={classes.reviewBoard}>
              {renderBoard(
                preview ?? card.fen,
                card.color,
                (uci) => void attempt(uci),
                lastMove,
                !preview && !revealed && !checking,
              )}
            </div>
            <div className={classes.reviewDetails}>
              <Text size="xs" c="dimmed">
                {card.gameTitle} · move {Math.ceil(card.ply / 2)}
              </Text>
              {feedback && (
                <Text role="status" size="sm" fw={600}>
                  {feedback}
                </Text>
              )}
              {!revealed ? (
                <>
                  {!feedback && <Text>Find a better move.</Text>}
                  {preview && (
                    <Button
                      variant="light"
                      disabled={checking}
                      onClick={() => {
                        setPreview(null);
                        setLastMove(null);
                        setFeedback("");
                      }}
                    >
                      Try again
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Text fw={700}>
                    {card.bestSan} improves on {card.played}
                  </Text>
                  {card.refutation.length > 0 && (
                    <Text size="sm">
                      After {card.played}: {card.refutation.join(" ")}
                    </Text>
                  )}
                  <div className={classes.reviewLineControls}>
                    <Button
                      variant="light"
                      onClick={() => showLine(Math.max(0, lineIndex - 1))}
                      aria-label="Previous solution move"
                    >
                      ‹
                    </Button>
                    <Button variant="subtle" onClick={() => showLine(1)}>
                      {lineIndex
                        ? `${lineIndex}/${card.pv.length} · ${card.pvSan[lineIndex - 1] ?? ""}`
                        : "Show best line"}
                    </Button>
                    <Button
                      variant="light"
                      disabled={lineIndex >= card.pv.length}
                      onClick={() => showLine(lineIndex + 1)}
                      aria-label="Next solution move"
                    >
                      ›
                    </Button>
                  </div>
                  <details>
                    <summary>Why this mattered</summary>
                    <Text size="sm">{card.explanation}</Text>
                    <Text size="xs" c="dimmed">
                      Estimated winning chances: {Math.round(card.before)}% →{" "}
                      {Math.round(card.after)}% after {card.played}.
                    </Text>
                    <Text size="xs" c="dimmed">
                      {card.gameDate}
                    </Text>
                  </details>
                </>
              )}
            </div>
            <footer className={classes.reviewSessionFooter}>
              {!revealed ? (
                <Button
                  fullWidth
                  disabled={checking}
                  onClick={() => {
                    setRevealed(true);
                    showLine(1);
                  }}
                >
                  Reveal solution
                </Button>
              ) : (
                <>
                  <div className={classes.reviewGrades}>
                    <Button
                      disabled={checking}
                      color="orange"
                      variant="light"
                      onClick={() => grade("again")}
                    >
                      Again
                    </Button>
                    <Button disabled={checking} onClick={() => grade("good")}>
                      Got it
                    </Button>
                    <Button disabled={checking} variant="light" onClick={() => grade("easy")}>
                      Easy
                    </Button>
                  </div>
                  <Button
                    fullWidth
                    variant="subtle"
                    color="gray"
                    disabled={checking}
                    onClick={() => void grade("hide")}
                  >
                    Hide this position
                  </Button>
                </>
              )}
            </footer>
          </>
        ) : (
          <div className={classes.reviewDetails}>
            <Title order={3}>Done for today</Title>
            <Text>Your next short review will be ready tomorrow.</Text>
            <Button onClick={() => setSession(null)}>Back to Review</Button>
          </div>
        )}
      </section>
    );
  return (
    <Stack className={classes.reviewWorkspace} gap="md">
      <div>
        <Title order={2}>Mistake review</Title>
        <Text c="dimmed" size="sm">
          Learn from your games, five positions at a time.
        </Text>
      </div>
      {shared && Object.values(shared.accounts).some(Boolean) && (
        <>
          <SegmentedControl
            value={otherGames ? "other" : "online"}
            onChange={(v) => setOtherGames(v === "other")}
            data={[
              { value: "online", label: "My online games" },
              { value: "other", label: "Other games" },
            ]}
          />
          {sharedMode && (
            <Stack gap="xs">
              <Text size="sm">
                {Object.entries(shared.accounts)
                  .filter(([, name]) => name)
                  .map(
                    ([source, name]) =>
                      `${source === "chesscom" ? "Chess.com" : "Lichess"}: ${name}`,
                  )
                  .join(" · ")}
              </Text>
              <Text size="sm" c="dimmed">
                {shared.reviewedGames} games prepared · {shared.usefulPositionsCount} useful
                positions. Progress is shared with En Croissant on your PC.
              </Text>
              <Text size="xs" c="dimmed">
                {shared.running
                  ? `Preparing reviews${shared.currentGame ? ` · ${shared.currentGame}` : "…"}`
                  : shared.enabled
                    ? "Checks for finished games every five minutes while your PC is on."
                    : "Automatic preparation paused."}{" "}
                You can close this screen.
              </Text>
              {(shared.error || shared.discoveryError) && (
                <Alert color="orange">
                  {shared.error || shared.discoveryError} Saved reviews remain available; automatic
                  preparation will retry.
                </Alert>
              )}
              <Button
                variant="subtle"
                size="compact-sm"
                onClick={() => {
                  void sharedReviewRequest("/settings", { enabled: !shared.enabled })
                    .then(setShared)
                    .catch(() =>
                      setSyncError("Could not change automatic preparation. Please retry."),
                    );
                }}
              >
                {shared.enabled ? "Pause automatic preparation" : "Resume automatic preparation"}
              </Button>
            </Stack>
          )}
        </>
      )}
      {syncError && (
        <Text size="sm" c="orange">
          {syncError}
        </Text>
      )}
      {!sharedMode && (
        <>
          <TextInput
            label="Your player name or username"
            description="Use the name in your games. It selects only your moves."
            value={player}
            disabled={busy}
            onChange={(e) => {
              setPlayer(e.currentTarget.value);
              onSave({ ...savedRef.current, player: e.currentTarget.value });
            }}
          />
        </>
      )}
      <Button
        size="lg"
        disabled={!queue.length || busy || (!sharedMode && !player.trim())}
        onClick={() => {
          setSession(queue);
          setRevealed(false);
          setFeedback("");
        }}
      >
        Daily review · {queue.length} positions
      </Button>
      <Text size="sm" c="dimmed">
        Meaningful swings in winning chances, recent games and spaced retries. At most two positions
        from one game. No daily backlog to clear.
      </Text>
      {sharedMode ? (
        <Button variant="light" onClick={() => setOtherGames(true)}>
          Review imported or other games
        </Button>
      ) : (
        <>
          <Title order={4}>Add games to review</Title>
          <SegmentedControl
            fullWidth
            value={source}
            disabled={busy}
            onChange={(value) => {
              setSource(value);
              if (count === "all") setCount("10");
            }}
            data={[
              { value: "saved", label: "Imported games" },
              { value: "chesscom", label: "Chess.com" },
              { value: "lichess", label: "Lichess" },
            ]}
          />
          {source === "saved" && (
            <Select
              label="Games"
              clearable
              placeholder="All imported games"
              value={database}
              disabled={busy}
              onChange={setDatabase}
              data={state.databases.map((d) => ({
                value: d.id,
                label: `${d.name} (${d.gameCount})`,
              }))}
            />
          )}
          <Group grow>
            <Select
              label="Batch size"
              allowDeselect={false}
              value={count}
              disabled={busy}
              onChange={(v) => setCount(v ?? "10")}
              data={[
                ...["10", "25", "50", "100", "300"].map((value) => ({
                  value,
                  label: `${value} recent games`,
                })),
                ...(source === "saved" ? [{ value: "all", label: "All imported games" }] : []),
              ]}
            />
            <Badge variant="light">
              {source === "saved" ? `${eligibleCount} unreviewed` : "Recent games first"}
            </Badge>
          </Group>
          <Button
            disabled={!player.trim() || (source === "saved" && eligibleCount === 0)}
            loading={busy}
            onClick={() => void scan()}
          >
            Find my mistakes
          </Button>
          {busy && (
            <>
              <Progress
                value={progress.total ? (progress.done / progress.total) * 100 : 0}
                animated
              />
              <Button
                variant="light"
                color="gray"
                onClick={() => {
                  controller.current?.abort();
                  setProgress((p) => ({
                    ...p,
                    text: "Stopped. Completed games are saved. Start again to resume.",
                  }));
                }}
              >
                Stop and keep progress
              </Button>
              <Text size="xs" c="dimmed">
                Keep this page open while scanning. Completed games are saved automatically.
              </Text>
            </>
          )}
          {progress.text && (
            <Text size="sm" role="status">
              {progress.text}
            </Text>
          )}
          {error && <Alert color="red">{error}</Alert>}
          <Text size="xs" c="dimmed">
            {
              saved.cards.filter((c) => playerKey(c.player) === playerKey(player) && !c.hidden)
                .length
            }{" "}
            useful positions saved on this device.
          </Text>
        </>
      )}
    </Stack>
  );
}
