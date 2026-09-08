import { useEffect, useRef, useState } from "react";
import { TruePerformancePanel } from "./TruePerformancePanel";
import {
  cachedPerformance,
  performanceCacheKey,
  fetchOnlinePerformance,
  type PerformanceAccount,
  type PerformanceSnapshot,
} from "./onlinePerformance";
import type { PerformanceGame, PerformanceGameType } from "./truePerformance";
import s from "./TruePerformancePanel.module.css";
export function TruePerformanceOnline({
  accounts,
  compact = false,
  onViewAll,
  onAddAccount,
  onOpenGame,
  getHeaders,
}: {
  accounts: PerformanceAccount[];
  compact?: boolean;
  onViewAll?: () => void;
  onAddAccount?: () => void;
  onOpenGame?: (game: PerformanceGame) => void;
  getHeaders?: (provider: string) => Promise<Record<string, string>>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? ""),
    [speed, setSpeed] = useState("blitz"),
    [gameType, setGameType] = useState<PerformanceGameType>("rated"),
    [nonce, setNonce] = useState(0);
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const effectiveSpeed =
    account?.provider === "chesscom" && speed === "classical"
      ? "daily"
      : account?.provider === "lichess" && speed === "daily"
        ? "classical"
        : speed;
  const active = useRef<AbortController | null>(null);
  const key = account ? performanceCacheKey(account, effectiveSpeed, gameType) : "";
  const selectedId = account?.id, provider = account?.provider, username = account?.username;
  const [state, setState] = useState<{
    key: string;
    snapshot: PerformanceSnapshot | null;
    loading: boolean;
    message: string;
    error: string | null;
  }>({ key: "", snapshot: null, loading: false, message: "", error: null });
  useEffect(() => {
    if (!selectedId || !provider || !username) return;
    const requestAccount = { id: selectedId, provider, username };
    const controller = new AbortController(),
      cached = cachedPerformance(key);
    active.current = controller;
    setState({ key, snapshot: cached, loading: false, message: "", error: null });
    if (nonce === 0 && cached && Date.now() / 1000 - cached.fetchedAt < 6 * 3600) return;
    setState((v) => ({ ...v, loading: true, message: "Loading games…" }));
    void (async () => {
      const headers = (await getHeaders?.(provider)) ?? {};
      return fetchOnlinePerformance(
        requestAccount,
        effectiveSpeed,
        controller.signal,
        (message) => {
          if (!controller.signal.aborted) setState((v) => ({ ...v, message }));
        },
        headers,
        gameType,
      );
    })()
      .then((snapshot) => {
        if (!controller.signal.aborted)
          setState({ key, snapshot, loading: false, message: "", error: null });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState((v) => ({
            ...v,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          }));
      });
    return () => controller.abort();
  }, [key, selectedId, provider, username, effectiveSpeed, gameType, nonce, getHeaders]);
  const snapshot = state.key === key ? state.snapshot : null;
  const controls = (
    <>
      <label>
        Account
        <select
          aria-label="Performance account"
          value={account?.id ?? ""}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.provider === "chesscom" ? "Chess.com" : "Lichess"} · {a.username}
            </option>
          ))}
        </select>
      </label>
      <label>
        Time control
        <select
          aria-label="Performance time control"
          value={effectiveSpeed}
          onChange={(e) => setSpeed(e.target.value)}
        >
          {[
            "bullet",
            "blitz",
            "rapid",
            account?.provider === "chesscom" ? "daily" : "classical",
          ].map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Games
        <select aria-label="Performance game type" value={gameType} onChange={(e) => setGameType(e.target.value as PerformanceGameType)}>
          <option value="rated">Rated</option>
          <option value="unrated">Unrated</option>
          <option value="both">Both</option>
        </select>
      </label>
      <button
        type="button"
        className={s.button}
        onClick={() => {
          if (state.loading) {
            active.current?.abort();
            setState((v) => ({
              ...v,
              loading: false,
              message: "",
              error: v.snapshot ? null : "Loading stopped. Refresh to try again.",
            }));
          } else setNonce((n) => n + 1);
        }}
      >
        {state.loading ? "Stop" : "Refresh"}
      </button>
    </>
  );
  if (!account)
    return (
      <section className={s.panel}>
        <header className={s.heading}>
          <h2>Your online chess</h2>
        </header>
        <div className={s.empty}>
          Link a Chess.com or Lichess account to see performance over time.
          {onAddAccount && (
            <p>
              <button className={s.button} onClick={onAddAccount}>
                Add account
              </button>
            </p>
          )}
        </div>
      </section>
    );
  return (
    <div className={s.panel}>
      {state.loading && state.key === key && (
        <p className={s.note} role="status">
          {state.message}
        </p>
      )}
      {state.error && state.key === key && (
        <p className={s.note} role="alert">
          {state.error}
          {snapshot ? " Showing the last saved snapshot." : ""}
        </p>
      )}
      {snapshot ? (
        <TruePerformancePanel
          key={key}
          title={compact ? "Your online chess" : "Your chess"}
          games={snapshot.games}
          gameType={gameType}
          compact={compact}
          poolLabel={`${account.provider === "chesscom" ? "Chess.com" : "Lichess"} · ${effectiveSpeed}`}
          asOf={snapshot.fetchedAt}
          controls={controls}
          coverage={`${snapshot.games.length.toLocaleString()} games loaded${snapshot.limited ? " · Latest 5,000-game limit reached" : ""} · Updated ${new Date(snapshot.fetchedAt * 1000).toLocaleString()}`}
          onViewAll={onViewAll}
          onOpenGame={
            onOpenGame ??
            ((g) => {
              if (g.url && /^https:\/\/(?:lichess\.org|(?:www\.)?chess\.com)\//i.test(g.url))
                window.open(g.url, "_blank", "noopener,noreferrer");
            })
          }
        />
      ) : (
        <>
          <header className={s.heading}>
            <h2>{compact ? "Your online chess" : "Your chess"}</h2>
          </header>
          <div className={s.controls}>{controls}</div>
          {!state.loading && !state.error && <p className={s.note}>Loading account history…</p>}
        </>
      )}
    </div>
  );
}
