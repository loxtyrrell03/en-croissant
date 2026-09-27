import { PerformanceHelp } from "./PerformanceHelp";
import { useEffect, useMemo, useId, useRef, useState, type ReactNode } from "react";
import {
  PERFORMANCE_PERIODS,
  periodPerformance,
  selectResultPeriod,
  periodPerformanceHistory,
  preparePerformanceGames,
  strengthHistory,
  type PerformanceGame,
  type PerformanceGameType,
  type PerformancePeriod,
  type StrengthPoint,
} from "./truePerformance";
import s from "./TruePerformancePanel.module.css";
import { readableOpeningName } from "./onlinePerformance";
const number = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString();
const date = (at: number) =>
  new Date(at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
function Hint({children}: {children: ReactNode}) { return <PerformanceHelp label="Explain this estimate">{children}</PerformanceHelp>; }
function Metric({
  label,
  value,
  detail,
  description,
  accent,
  help,
}: {
  label: string;
  value: string;
  detail: string;
  description?: string;
  accent?: boolean;
  help?: string;
}) {
  return (
    <div className={s.metric}>
      <div className={s.label}>
        {label}
        {help && <Hint>{help}</Hint>}
      </div>
      {description && <span className={s.metricMeaning}>{description}</span>}
      <strong className={accent ? s.accent : undefined}>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}
export function TruePerformancePanel({
  games,
  gameType = "rated",
  title = "Your chess",
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
  const [period, setPeriod] = useState<PerformancePeriod>(() => {
    try { const saved = localStorage.getItem("performance-period"); return PERFORMANCE_PERIODS.some(([p]) => p === saved) ? saved as PerformancePeriod : "30d"; } catch { return "30d"; }
  });
  const [compareOpen, setCompareOpen] = useState(false);
  const [graphMode, setGraphMode] = useState<"performance" | "history">("performance");
  const comparisonId = useId();
  const history = useMemo(() => strengthHistory(games, asOf, undefined, gameType), [games, asOf, gameType]);
  const selected = useMemo(
    () => selectResultPeriod(games, period, asOf, gameType),
    [games, period, asOf, gameType],
  );
  const selectedIds = useMemo(() => new Set(selected.map((g) => g.id)), [selected]);
  const points = useMemo(
    () => history.points.filter((p) => selectedIds.has(p.id)),
    [history, selectedIds],
  );
  const performance = useMemo(() => periodPerformance(selected, undefined, gameType), [selected, gameType]);
  const last = points.at(-1);
  const periodPoints = useMemo(() => periodPerformanceHistory(selected, asOf, gameType), [selected, asOf, gameType]);
  const usable = useMemo(() => preparePerformanceGames(selected, asOf, gameType), [selected, asOf, gameType]);
  const chartPoints = graphMode === "performance" ? periodPoints.slice(2) : points;
  const enough = history.points.length >= 3 && !!last;
  const wins = selected.filter((g) => g.score === 1).length,
    draws = selected.filter((g) => g.score === 0.5).length,
    losses = selected.length - wins - draws;
  return (
    <section className={`${s.panel} ${compact ? s.compact : ""}`} aria-label={title}>
      <header className={s.heading}>
        <div>
          <h2>{title}</h2>
        </div>
        {onViewAll && (
          <button type="button" className={s.button} onClick={onViewAll}>
            View all stats →
          </button>
        )}
      </header>
      <div className={s.controls}>
        {controls}
        <label>
          Choose your games
          <select
            aria-label="Performance period"
            value={period}
            onChange={(e) => { setPeriod(e.target.value as PerformancePeriod); try { localStorage.setItem("performance-period", e.target.value); } catch { /* Storage can be unavailable. */ } }}
          >
            {PERFORMANCE_PERIODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={s.selectionLine}>
        <span>{selected.length.toLocaleString()} {gameType === "both" ? "games" : `${gameType} games`}</span>
        {selected.length > 0 && <span> · {date(selected[0].at)}–{date(selected.at(-1)!.at)}</span>}
      </div>
      {selected.length === 0 ? (
        <div className={s.empty}>
          <strong>No {gameType === "both" ? "games" : `${gameType} games`} in this period</strong>
          <p>Choose a longer period or another time control.</p>
        </div>
      ) : (
        <>
          <div className={s.hero}>
            <div className={s.heroHeading}><h3>How well did you play?</h3><Hint>{`Performance in your selected games, using their results and opponents’ ratings, starting from your account rating before the first game. ${performance ? `Estimated range: ${number(performance.low)}–${number(performance.high)}.` : "Needs at least 3 usable games and a starting rating."}`}</Hint></div>
            <div className={s.heroRow}>
              <div><strong className={s.heroRating}>{number(performance?.mean)}</strong><span className={s.ratingUnit}>Performance rating · {poolLabel}</span></div>
              <button className={s.button} aria-expanded={compareOpen} aria-controls={comparisonId} onClick={() => setCompareOpen(v => !v)}>{compareOpen ? "Close comparison" : "Compare ratings"}</button>
            </div>
            {!performance && <p className={s.note}>{usable.length < 3 ? "Needs at least 3 games with opponent ratings." : "The starting account rating is missing."}</p>}
            {usable.length < selected.length && <p className={s.note}>{selected.length-usable.length} games lack usable rating data; their results are still included below.</p>}
          </div>
          {compareOpen && <div id={comparisonId} className={s.comparison}>
            <Metric label="In your selected games" value={number(performance?.mean)} detail={`${usable.length} games with rating data`} help="How well you played across the selection, using your rating before its first usable game as the starting point." />
            <Metric label="After your latest game" value={enough ? number(last.mean) : "—"} detail={`${history.games.length} games of history`} help={`Your estimated level after ${last ? date(last.at) : "the latest game"}, including earlier loaded games outside the selection. This uses the same website and time control.`} />
            <Metric label="Website rating" value={number(selected.at(-1)?.rating)} detail="Recorded before your latest game" help="The rating recorded by the website before the last selected game; it is not either of our estimates." />
          </div>}
          <div className={s.graphControls}><label>Graph <select aria-label="Rating graph" value={graphMode} onChange={e => setGraphMode(e.target.value as "performance" | "history")}><option value="performance">Performance in selected games</option><option value="history">Estimated level after each game</option></select></label><Hint>{graphMode === "performance" ? "Recalculates performance as each selected game is added. Its final point matches the headline rating; games before your selection are not included." : "Your estimated level after each game, using earlier loaded games too. The selection controls which dates are shown, not how much earlier history is used."}</Hint></div>
          {chartPoints.length > 0 ? <ProgressChart points={chartPoints} label={graphMode === "performance" ? "Performance rating" : "Estimated playing strength"} /> : <div className={s.empty}>Not enough rating data to draw this graph.</div>}
          <div className={s.results} aria-label="Game results"><div><strong className={s.winText}>{wins}</strong><span>Wins</span></div><div><strong>{draws}</strong><span>Draws</span></div><div><strong className={s.lossText}>{losses}</strong><span>Losses</span></div></div>
          {!compact && (
            <div className={s.detailsGrid}>
              <div className={s.card}>
                <h3>Openings you played</h3>
                <OpeningSummary games={selected} />
              </div>
              <div className={s.card}>
                <h3>Recent games</h3>
                <div className={s.games}>
                  {selected
                    .slice(-8)
                    .reverse()
                    .map((g) => {
                      return (
                        <div className={s.game} key={g.id}>
                          <span
                            className={`${s.result} ${g.score === 1 ? s.win : g.score === 0 ? s.loss : s.draw}`}
                          >
                            {g.score === 1 ? "Won" : g.score === 0 ? "Lost" : "Drew"}
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
                              <br />{readableOpeningName(g.opening) ?? "Opening not identified"}
                            </small>
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
        <details><summary>Game data</summary><p>{coverage}</p>{history.excluded > 0 && <p>{history.excluded} loaded records could not contribute to the longer-history estimate.</p>}</details>
        <details>
          <summary>About the estimates</summary>
          <p>
            Unrated play can reflect experimentation as well as strength. Based on results and opponent ratings, with uncertainty and changes over time. Website
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
  const [all, setAll] = useState(false);
  const map = new Map<string, { n: number; wins: number; draws: number; losses: number }>();
  for (const g of games) {
    const name = readableOpeningName(g.opening) ?? "Opening not identified";
    const row = map.get(name) ?? { n: 0, wins: 0, draws: 0, losses: 0 };
    row.n++; if (g.score === 1) row.wins++; else if (g.score === 0.5) row.draws++; else row.losses++;
    map.set(name, row);
  }
  const rows = [...map].sort((a,b) => b[1].n-a[1].n);
  return <div className={s.namedOpenings}>{rows.slice(0, all ? undefined : 4).map(([name,row]) => <div key={name}><div><strong>{name}</strong><span>{row.n} games</span></div><small>{row.wins} wins · {row.draws} draws · {row.losses} losses</small></div>)}{rows.length > 4 && <button className={s.button} onClick={() => setAll(v => !v)}>{all ? "Show fewer openings" : "See all openings"}</button>}</div>;
}
function ProgressChart({ points, label }: { points: StrengthPoint[]; label: string }) {
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
    Math.floor(Math.min(...plotted.map((p) => p.low)) / 100) * 100;
  const max = Math.max(
    min + 100,
    Math.ceil(Math.max(...plotted.map((p) => p.high)) / 100) * 100,
  );
  const x = (i: number) =>
      48 + (plotted.at(-1)!.at === plotted[0].at ? 0.5 : (plotted[i].at - plotted[0].at) / (plotted.at(-1)!.at - plotted[0].at)) * (width - 60),
    y = (v: number) => 208 - ((v - min) / (max - min)) * 174;
  const index = Math.min(hover ?? plotted.length - 1, plotted.length - 1);
  const selected = plotted[index];
  const line = (fn: (p: StrengthPoint) => number) =>
    plotted.map((p, i) => `${x(i)},${y(fn(p))}`).join(" ");
  return (
    <div className={s.card} ref={chartRef}>
      <div className={s.chartHead}>
        <h3>Rating over time</h3>
        <span>
          <i /> {label}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} 242`}
        className={s.chart}
        role="img"
        aria-label={`${label} over selected games`}
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
              {date(p.at)}: {label.toLowerCase()} {number(p.mean)}, range {number(p.low)}–{number(p.high)}
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
        {date(selected.at)} · {label} <strong>{number(selected.mean)}</strong>
      </p>
    </div>
  );
}
