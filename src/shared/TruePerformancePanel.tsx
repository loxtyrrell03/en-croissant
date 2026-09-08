import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PERFORMANCE_PERIODS,
  periodPerformance,
  selectPerformancePeriod,
  strengthHistory,
  type PerformanceGame,
  type PerformanceGameType,
  type PerformancePeriod,
  type StrengthPoint,
} from "./truePerformance";
import s from "./TruePerformancePanel.module.css";
const number = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString();
const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}`;
const date = (at: number) =>
  new Date(at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
function Hint({ children }: { children: ReactNode }) {
  return (
    <details className={s.hint}>
      <summary aria-label="Explain this estimate">?</summary>
      <div>{children}</div>
    </details>
  );
}
function Metric({
  label,
  value,
  detail,
  accent,
  help,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
  help?: string;
}) {
  return (
    <div className={s.metric}>
      <div className={s.label}>
        {label}
        {help && <Hint>{help}</Hint>}
      </div>
      <strong className={accent ? s.accent : undefined}>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}
export function TruePerformancePanel({
  games,
  gameType = "rated",
  title = "Your performance",
  poolLabel,
  compact = false,
  asOf = Date.now() / 1000,
  controls,
  coverage,
  onOpenGame,
  onViewAll,
}: {
  games: readonly PerformanceGame[];
  gameType?: PerformanceGameType;
  title?: string;
  poolLabel: string;
  compact?: boolean;
  asOf?: number;
  controls?: ReactNode;
  coverage?: string;
  onOpenGame?: (game: PerformanceGame) => void;
  onViewAll?: () => void;
}) {
  const [period, setPeriod] = useState<PerformancePeriod>("30d");
  const history = useMemo(() => strengthHistory(games, asOf, undefined, gameType), [games, asOf, gameType]);
  const selected = useMemo(
    () => selectPerformancePeriod(history.games, period, asOf, gameType),
    [history, period, asOf, gameType],
  );
  const selectedIds = useMemo(() => new Set(selected.map((g) => g.id)), [selected]);
  const points = useMemo(
    () => history.points.filter((p) => selectedIds.has(p.id)),
    [history, selectedIds],
  );
  const performance = useMemo(() => periodPerformance(selected, undefined, gameType), [selected, gameType]);
  const last = points.at(-1),
    enough = history.points.length >= 3 && !!last;
  const wins = selected.filter((g) => g.score === 1).length,
    draws = selected.filter((g) => g.score === 0.5).length,
    losses = selected.length - wins - draws;
  const score = selected.length ? ((wins + draws / 2) / selected.length) * 100 : null;
  const freshness = last ? Math.floor((asOf - last.at) / 86400) : 0;
  return (
    <section className={`${s.panel} ${compact ? s.compact : ""}`} aria-label={title}>
      <header className={s.heading}>
        <div>
          <h2>{title}</h2>
          <p>{poolLabel}</p>
        </div>
        {onViewAll && (
          <button type="button" className={s.button} onClick={onViewAll}>
            View all stats →
          </button>
        )}
      </header>
      {gameType !== "rated" && <p className={s.note}>Includes unrated play. These estimates describe the selected games; casual results may reflect experimentation as well as strength.</p>}
      <div className={s.controls}>
        {controls}
        <label>
          Period
          <select
            aria-label="Performance period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as PerformancePeriod)}
          >
            {PERFORMANCE_PERIODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className={s.count}>{selected.length.toLocaleString()} {gameType === "both" ? "games" : `${gameType} games`}</span>
      </div>
      {selected.length === 0 ? (
        <div className={s.empty}>
          <strong>No {gameType === "both" ? "games" : `${gameType} games`} in this period</strong>
          <p>Choose a longer period or another time control.</p>
        </div>
      ) : (
        <>
          <div className={s.overview}>
            <div className={s.metrics}>
              <Metric
                label="True strength"
                value={enough ? number(last.mean) : "—"}
                accent
                detail={
                  enough
                    ? `Model range ${number(last.low)}–${number(last.high)}`
                    : "At least 3 usable games needed"
                }
                help="Your estimated playing strength after the latest selected game. Earlier games inform it. The shaded range describes uncertainty under this model; it is not a verified guarantee of your true ability. Estimates use this website's rating scale."
              />
              <Metric
                label="Period performance"
                value={number(performance?.mean)}
                detail={`Across ${selected.length} selected games`}
                help="The constant playing strength that best explains this period, balancing all these results against the rating before its first game. Every game counts once. Short samples depend more on that starting rating."
              />
              <Metric
                label="Score"
                value={score === null ? "—" : `${score.toFixed(1)}%`}
                detail={`${wins} wins · ${draws} draws · ${losses} losses`}
              />
              {!compact && (
                <Metric
                  label="Account rating"
                  value={number(selected.at(-1)?.rating)}
                  detail="Before the latest selected game"
                />
              )}
            </div>
            {enough && <ProgressChart points={points} />}
          </div>
          {freshness > 7 && (
            <p className={s.note}>
              Latest selected game: {date(last!.at)}. This estimate describes that point in time.
            </p>
          )}
          {!compact && (
            <div className={s.detailsGrid}>
              <div className={s.card}>
                <h3>By colour</h3>
                {[true, false].map((white) => {
                  const subset = selected.filter((g) => g.white === white);
                  const pct = subset.length
                    ? (subset.reduce((a, g) => a + g.score, 0) / subset.length) * 100
                    : 0;
                  return (
                    <div className={s.colour} key={String(white)}>
                      <div>
                        <strong>{white ? "White" : "Black"}</strong>
                        <span>
                          {subset.length ? `${pct.toFixed(1)}% score` : "No games"} ·{" "}
                          {subset.length} games
                        </span>
                      </div>
                      <div className={s.bar}>
                        <span style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <h3 className={s.openingTitle}>Most played openings</h3>
                <OpeningSummary games={selected} />
              </div>
              <div className={s.card}>
                <h3>Recent games</h3>
                <div className={s.games}>
                  {selected
                    .slice(-8)
                    .reverse()
                    .map((g) => {
                      const point = history.points.find((p) => p.id === g.id);
                      return (
                        <div className={s.game} key={g.id}>
                          <span
                            className={`${s.result} ${g.score === 1 ? s.win : g.score === 0 ? s.loss : s.draw}`}
                          >
                            {g.score === 1 ? "W" : g.score === 0 ? "L" : "D"}
                          </span>
                          <div>
                            <button
                              className={s.gameLink}
                              disabled={!onOpenGame}
                              onClick={() => onOpenGame?.(g)}
                            >
                              {g.opponent || "Opponent"}
                            </button>
                            <small>
                              {date(g.at)} · {g.white ? "White" : "Black"} · Opp.{" "}
                              {number(g.opponentRating)}
                            </small>
                          </div>
                          <div className={s.gameRating}>
                            <strong>{number(point?.mean)}</strong>
                            <small>{point ? signed(point.mean - point.before) : "—"}</small>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <footer className={s.footer}>
        {coverage && <span>{coverage}</span>}
        {history.excluded > 0 && (
          <span>
            {history.excluded} duplicate, filtered, undated or incomplete records excluded.
          </span>
        )}
        <details>
          <summary>About the estimates</summary>
          <p>
            Based on results and opponent ratings, with uncertainty and changes over time. Website
            and time-control pools stay separate. Online model settings are provisional; they have
            not been calibrated on an independent online test set. These are not FIDE ratings. A
            single game shows its effect on the running estimate, not a standalone performance
            rating.
          </p>
        </details>
      </footer>
    </section>
  );
}
function OpeningSummary({ games }: { games: readonly PerformanceGame[] }) {
  const map = new Map<string, { n: number; score: number }>();
  for (const g of games) {
    if (!g.opening) continue;
    const row = map.get(g.opening) ?? { n: 0, score: 0 };
    row.n++;
    row.score += g.score;
    map.set(g.opening, row);
  }
  const rows = [...map].sort((a, b) => b[1].n - a[1].n).slice(0, 4);
  return rows.length ? (
    <div className={s.openings}>
      {rows.map(([name, row]) => (
        <div key={name}>
          <span title={name}>{name}</span>
          <small>
            {row.n} games · {Math.round((row.score / row.n) * 100)}%
          </small>
        </div>
      ))}
    </div>
  ) : (
    <p className={s.note}>No opening names in these game records.</p>
  );
}
function ProgressChart({ points }: { points: StrengthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(250, Math.min(1000, entries[0].contentRect.width))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const plotted = points.filter(
    (_, i) => i === points.length - 1 || i % Math.max(1, Math.ceil(points.length / 200)) === 0,
  );
  const min =
    Math.floor(Math.min(...plotted.map((p) => Math.min(p.low, p.rating ?? p.mean))) / 100) * 100;
  const max = Math.max(
    min + 100,
    Math.ceil(Math.max(...plotted.map((p) => Math.max(p.high, p.rating ?? p.mean))) / 100) * 100,
  );
  const x = (i: number) =>
      48 + (plotted.length === 1 ? 0.5 : i / (plotted.length - 1)) * (width - 60),
    y = (v: number) => 208 - ((v - min) / (max - min)) * 174;
  const index = Math.min(hover ?? plotted.length - 1, plotted.length - 1);
  const selected = plotted[index];
  const line = (fn: (p: StrengthPoint) => number) =>
    plotted.map((p, i) => `${x(i)},${y(fn(p))}`).join(" ");
  return (
    <div className={s.card} ref={chartRef}>
      <div className={s.chartHead}>
        <h3>Your progress</h3>
        <span>
          <i /> True strength <b /> Account rating
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} 242`}
        className={s.chart}
        role="img"
        aria-label="True strength and account rating over selected games"
      >
        {[0, 1, 2, 3].map((i) => {
          const value = min + ((max - min) * i) / 3;
          return (
            <g key={i}>
              <line x1="44" x2={width - 10} y1={y(value)} y2={y(value)} className={s.grid} />
              <text x="5" y={y(value) + 4}>
                {number(value)}
              </text>
            </g>
          );
        })}
        <polygon
          points={`${line((p) => p.low)} ${[...plotted]
            .reverse()
            .map((p, i) => `${x(plotted.length - 1 - i)},${y(p.high)}`)
            .join(" ")}`}
          className={s.band}
        />
        <path
          d={plotted
            .map((p, i) =>
              p.rating === null
                ? ""
                : `${i === 0 || plotted[i - 1].rating === null ? "M" : "L"}${x(i)},${y(p.rating)}`,
            )
            .join(" ")}
          className={s.accountLine}
        />
        <polyline points={line((p) => p.mean)} className={s.strengthLine} />
        {plotted.map((p, i) => (
          <circle
            key={p.id}
            cx={x(i)}
            cy={y(p.mean)}
            r="6"
            className={s.point}
            onMouseEnter={() => setHover(i)}
          >
            <title>
              {date(p.at)}: strength {number(p.mean)}, range {number(p.low)}–{number(p.high)}
            </title>
          </circle>
        ))}
        <text x="48" y="234">
          {date(plotted[0].at)}
        </text>
        <text x={width - 10} y="234" textAnchor="end">
          {date(plotted.at(-1)!.at)}
        </text>
      </svg>
      <label className={s.scrubber}>
        Explore games
        <input
          type="range"
          min="0"
          max={Math.max(0, plotted.length - 1)}
          value={index}
          aria-label="Explore rating history"
          onChange={(e) => setHover(Number(e.target.value))}
        />
      </label>
      <p className={s.chartReadout} aria-live="polite">
        {date(selected.at)} · Strength <strong>{number(selected.mean)}</strong> · Model range{" "}
        {number(selected.low)}–{number(selected.high)}
      </p>
    </div>
  );
}
