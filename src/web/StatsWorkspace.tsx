import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChartLine, IconRefresh, IconSparkles } from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import classes from "./WebApp.module.css";
import styles from "./StatsWorkspace.module.css";
import {
  getWebChessCoachHealth,
  getWebChessCoachProgress,
  type WebChessCoachHealth,
  type WebChessCoachProgress,
} from "./chessCoach";
import { loadAnalyzedEntries, runStatsBatchAnalysis } from "./statsAnalysis";
import {
  askStatsAiReport,
  loadStatsAiReport,
  saveStatsAiReport,
  type StatsAiReportResponse,
  type StatsAiReportSection,
} from "./statsAiReport";
import {
  computeFormSummary,
  computePeriodPerformance,
  computePerformanceSeries,
  fetchCurrentRating,
  fetchStatsGames,
  type StatsFormSummary,
  type StatsGame,
  type StatsPerformancePoint,
  type StatsRatedFilter,
  type StatsSource,
  type StatsTimeClass,
} from "./statsRating";
import { computePeriodReport, type PeriodReport } from "./statsReport";
import {
  getStatsPeriodDays,
  getStatsWindow,
  isStatsPeriodKey,
  STATS_PERIOD_OPTIONS,
  type StatsPeriodKey,
  type StatsWindow,
} from "./statsPeriods";
import {
  aggregateProfile,
  anchoredStrength,
  gamePerformance,
  timeClassOf,
  type AnalyzedGameEntry,
  type PhaseProfile,
  type StrengthPhase,
  type StrengthPool,
} from "./statsStrength";

const STATS_SETTINGS_STORAGE_KEY = "en-croissant-web-stats-settings";
const STATS_MAX_GAMES = 5000;
const STATS_BASE_HISTORY_DAYS = 1;
const STATS_RECENT_REFRESH_SECONDS = 60;

// EloGuard data-semantics colors (hero/deltas/records keep the extension's
// green/red meaning while everything else stays Mantine dark + blue).
const STATS_GREEN = "#a3d160";
const STATS_POOL_ACCENTS: Record<StrengthPool, string> = {
  bullet: "#e58f2a",
  blitz: "#f0c15c",
  rapid: "#81b64c",
  classical: "#7fa9d6",
};
const STATS_POOL_ORDER: StrengthPool[] = ["bullet", "blitz", "rapid", "classical"];
const STATS_PHASE_ORDER: StrengthPhase[] = ["opening", "middlegame", "endgame"];
const STATS_PHASE_LABELS: Record<StrengthPhase, string> = {
  opening: "Opening",
  middlegame: "Middlegame",
  endgame: "Endgame",
};
const STATS_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type StatsTab = "overview" | "strength" | "report";
type StatsSettings = {
  source: StatsSource;
  chesscomUsername: string;
  lichessUsername: string;
  timeClass: StatsTimeClass;
  rated: StatsRatedFilter;
  period: StatsPeriodKey;
  tab: StatsTab;
};

type StatsCacheEntry = {
  games: StatsGame[];
  series: StatsPerformancePoint[];
  nowSec: number;
  historyDays: number;
};

type StatsPoolRatings = Partial<Record<StrengthPool, number | null>>;
type StatsChartPoint = { t: number; v: number };

const STATS_TIME_CLASSES: StatsTimeClass[] = ["bullet", "blitz", "rapid", "classical", "daily"];

function normalizeStatsSettings(
  value: (Partial<StatsSettings> & { username?: string }) | null | undefined,
): StatsSettings {
  const source: StatsSource = value?.source === "lichess" ? "lichess" : "chesscom";
  let timeClass: StatsTimeClass = STATS_TIME_CLASSES.includes(value?.timeClass as StatsTimeClass)
    ? (value?.timeClass as StatsTimeClass)
    : "blitz";
  // Each source has one slow pool: chess.com plays Daily, lichess plays Classical.
  if (source === "chesscom" && timeClass === "classical") timeClass = "daily";
  if (source === "lichess" && timeClass === "daily") timeClass = "classical";
  // Legacy persisted settings stored one shared `username`; migrate it into
  // the slot of whichever source it was saved under.
  const legacy = typeof value?.username === "string" ? value.username.trim() : "";
  const chesscomUsername =
    typeof value?.chesscomUsername === "string"
      ? value.chesscomUsername.trim()
      : source === "chesscom"
        ? legacy
        : "";
  const lichessUsername =
    typeof value?.lichessUsername === "string"
      ? value.lichessUsername.trim()
      : source === "lichess"
        ? legacy
        : "";
  return {
    source,
    chesscomUsername,
    lichessUsername,
    timeClass,
    rated: value?.rated === "rated" || value?.rated === "casual" ? value.rated : "both",
    period: isStatsPeriodKey(value?.period) ? value.period : "30",
    tab: value?.tab === "strength" || value?.tab === "report" ? value.tab : "overview",
  };
}

function getStatsSourceLabel(source: StatsSource) {
  return source === "chesscom" ? "chess.com" : "Lichess";
}

function formatStatsDate(epochSec: number) {
  const date = new Date(epochSec * 1000);
  return `${STATS_MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
}

function formatSignedStats(value: number) {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function pluralStats(count: number, noun: string, plural = `${noun}s`) {
  return `${count} ${count === 1 ? noun : plural}`;
}

function formatStatsSeconds(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value < 10 ? `${value.toFixed(1)}s` : `${Math.round(value)}s`;
}

function formatStatsPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Math.round(value)}%`;
}

function formatStatsDecimal(value: number | null, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function formatSignedDecimal(value: number | null, suffix = "", digits = 1) {
  if (value == null || !Number.isFinite(value)) return "-";
  const rounded = value.toFixed(digits);
  return `${value > 0 ? "+" : ""}${rounded}${suffix}`;
}

function formatEvalCp(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  const pawns = value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function formatStatsAccuracy(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function formatStatsStreak(streak: StatsFormSummary["streak"]) {
  if (!streak || streak.len <= 0) return "-";
  const noun =
    streak.type === "loss"
      ? streak.len === 1
        ? "loss"
        : "losses"
      : streak.len === 1
        ? streak.type
        : `${streak.type}s`;
  return `${streak.len} ${noun}`;
}

function formatStatsGeneratedAt(value: number) {
  const ms = value < 1e12 ? value * 1000 : value;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clampAccuracyWidth(accuracy: number) {
  return Math.min(100, Math.max(2, accuracy));
}

function createStatsRequestId() {
  return `stats-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deltaDir(value: number) {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

function usePersistentJson<T>(
  key: string,
  fallback: T,
  normalize: (value: Partial<T> | null | undefined) => T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored
        ? normalize(JSON.parse(stored) as Partial<T>)
        : normalize(fallback as Partial<T>);
    } catch {
      return normalize(fallback as Partial<T>);
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Browser storage is best-effort for these small settings.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function StatsDeltaChip({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return (
    <span className={styles.delta} data-dir={deltaDir(rounded)}>
      {formatSignedStats(rounded)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatsLineChart: React port of EloGuard's renderStxChart (popup.js:1147-1390).
// Same geometry: 264x96 viewBox, 6px pad, 8% y padding (flat +/-10), carry-
// forward extendTo point, min/max downsampling above 260 points, min/max +
// first/last date labels, and a snapping crosshair tooltip that flips/clamps
// inside the viewBox.
// ---------------------------------------------------------------------------

const STATS_CHART_W = 264;
const STATS_CHART_H = 96;
const STATS_CHART_PAD = 6;
const STATS_TOOLTIP_PAD_X = 6;
const STATS_TOOLTIP_GAP = 8;
const STATS_TOOLTIP_H = 30;
const STATS_TOOLTIP_MARGIN = 1;

// Long ranges can contain thousands of games. Keep the first/last point plus
// each bucket's local high and low so the SVG stays light without flattening
// swings.
function reduceStatsChartPoints(points: StatsChartPoint[], maxPoints = 260) {
  if (points.length <= maxPoints) return points;
  const reduced = [points[0]];
  const lastIndex = points.length - 1;
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const bucketSize = Math.ceil((points.length - 2) / bucketCount);

  for (let start = 1; start < lastIndex; start += bucketSize) {
    const end = Math.min(lastIndex, start + bucketSize);
    let minIndex = start;
    let maxIndex = start;
    for (let i = start + 1; i < end; i += 1) {
      if (points[i].v < points[minIndex].v) minIndex = i;
      if (points[i].v > points[maxIndex].v) maxIndex = i;
    }
    if (minIndex === maxIndex) reduced.push(points[minIndex]);
    else if (minIndex < maxIndex) reduced.push(points[minIndex], points[maxIndex]);
    else reduced.push(points[maxIndex], points[minIndex]);
  }

  reduced.push(points[lastIndex]);
  return reduced;
}

function StatsLineChart({
  points,
  stroke,
  fill = true,
  extendTo = null,
}: {
  points: StatsChartPoint[];
  stroke: string;
  fill?: boolean;
  extendTo?: number | null;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    setHoverIndex(null);
  }, [points]);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    // When extendTo is later than the newest observation, carry the last value
    // forward so the chart communicates the current state through today.
    const newestPoint = points.reduce(
      (latest, point) => (point.t > latest.t ? point : latest),
      points[0],
    );
    const chartPts =
      extendTo != null && Number.isFinite(extendTo) && extendTo > newestPoint.t
        ? points.concat({ t: extendTo, v: newestPoint.v })
        : points;
    const pts = reduceStatsChartPoints(chartPts);

    const x0 = STATS_CHART_PAD;
    const x1 = STATS_CHART_W - STATS_CHART_PAD;
    const y0 = STATS_CHART_PAD;
    const y1 = STATS_CHART_H - STATS_CHART_PAD;

    const vals = points.map((point) => point.v);
    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);
    const padAmt = vMax === vMin ? 10 : (vMax - vMin) * 0.08;
    const vLo = vMin - padAmt;
    const vSpan = vMax + padAmt - vLo || 1;

    const ts = chartPts.map((point) => point.t);
    const tMin = Math.min(...ts);
    const tSpan = Math.max(...ts) - tMin;

    // Single point (or all same time): center on the x-axis, no divide by zero.
    const xFor = (t: number) =>
      tSpan === 0 ? (x0 + x1) / 2 : x0 + ((t - tMin) / tSpan) * (x1 - x0);
    const yFor = (v: number) => y1 - ((v - vLo) / vSpan) * (y1 - y0);

    const hoverPts = pts.map((point) => ({
      x: xFor(point.t),
      y: yFor(point.v),
      val: String(Math.round(point.v)),
      date: formatStatsDate(point.t),
    }));
    const coords = hoverPts.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`);
    const areaPath = `M${hoverPts[0].x.toFixed(2)},${y1.toFixed(2)} L${coords.join(" L")} L${hoverPts[hoverPts.length - 1].x.toFixed(2)},${y1.toFixed(2)} Z`;

    return {
      pts,
      hoverPts,
      linePoints: coords.join(" "),
      areaPath,
      vMin,
      vMax,
      flatLabelY: yFor(vMax) - 5,
      x0,
      x1,
      y0,
      y1,
    };
  }, [extendTo, points]);

  if (!geometry) return null;

  const hover =
    hoverIndex != null && hoverIndex < geometry.hoverPts.length
      ? geometry.hoverPts[hoverIndex]
      : null;
  let tooltip: { x: number; y: number; width: number } | null = null;
  if (hover) {
    // Over-estimate glyph width (bold digits ~0.64em, date ~0.6em) so the rect
    // never clips its text without any DOM measurement.
    const contentW = Math.max(hover.val.length * 11 * 0.64, hover.date.length * 9 * 0.6);
    const width = contentW + STATS_TOOLTIP_PAD_X * 2;
    // Anchor above the dot; flip below when the top would clip, then clamp.
    let y = hover.y - STATS_TOOLTIP_GAP - STATS_TOOLTIP_H;
    if (y < STATS_TOOLTIP_MARGIN) y = hover.y + STATS_TOOLTIP_GAP;
    if (y + STATS_TOOLTIP_H > STATS_CHART_H - STATS_TOOLTIP_MARGIN) {
      y = STATS_CHART_H - STATS_TOOLTIP_MARGIN - STATS_TOOLTIP_H;
    }
    if (y < STATS_TOOLTIP_MARGIN) y = STATS_TOOLTIP_MARGIN;
    // Centered on the point; clamped inside the viewBox at the edges.
    let x = hover.x - width / 2;
    if (x < STATS_TOOLTIP_MARGIN) x = STATS_TOOLTIP_MARGIN;
    if (x + width > STATS_CHART_W - STATS_TOOLTIP_MARGIN) {
      x = STATS_CHART_W - STATS_TOOLTIP_MARGIN - width;
    }
    tooltip = { x, y, width };
  }

  return (
    <svg
      ref={svgRef}
      className={styles.chart}
      viewBox={`0 0 ${STATS_CHART_W} ${STATS_CHART_H}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      onPointerMove={(event) => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        // Map the pointer into viewBox units, then snap to the nearest vertex.
        const vbX = ((event.clientX - rect.left) / rect.width) * STATS_CHART_W;
        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < geometry.hoverPts.length; i += 1) {
          const distance = Math.abs(geometry.hoverPts[i].x - vbX);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        }
        setHoverIndex(best);
      }}
      onPointerLeave={() => setHoverIndex(null)}
    >
      <rect
        x={0}
        y={0}
        width={STATS_CHART_W}
        height={STATS_CHART_H}
        fill="transparent"
        style={{ pointerEvents: "all" }}
      />
      {fill ? <path d={geometry.areaPath} fill={stroke} fillOpacity={0.1} stroke="none" /> : null}
      <polyline
        points={geometry.linePoints}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {geometry.vMax === geometry.vMin ? (
        <text
          className={styles.chartLabel}
          x={geometry.x0 + 2}
          y={geometry.flatLabelY}
          textAnchor="start"
          fontSize={10}
        >
          {Math.round(geometry.vMax)}
        </text>
      ) : (
        <>
          <text
            className={styles.chartLabel}
            x={geometry.x0 + 2}
            y={geometry.y0 + 8}
            textAnchor="start"
            fontSize={10}
          >
            {Math.round(geometry.vMax)}
          </text>
          <text
            className={styles.chartLabel}
            x={geometry.x0 + 2}
            y={geometry.y1 - 12}
            textAnchor="start"
            fontSize={10}
          >
            {Math.round(geometry.vMin)}
          </text>
        </>
      )}
      <text
        className={styles.chartLabel}
        x={geometry.x0 + 2}
        y={geometry.y1 - 1}
        textAnchor="start"
        fontSize={9}
      >
        {formatStatsDate(geometry.pts[0].t)}
      </text>
      {geometry.pts.length > 1 ? (
        <text
          className={styles.chartLabel}
          x={geometry.x1 - 2}
          y={geometry.y1 - 1}
          textAnchor="end"
          fontSize={9}
        >
          {formatStatsDate(geometry.pts[geometry.pts.length - 1].t)}
        </text>
      ) : null}
      {hover && tooltip ? (
        <g style={{ pointerEvents: "none" }}>
          <line
            x1={hover.x}
            x2={hover.x}
            y1={geometry.y0}
            y2={geometry.y1}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1}
          />
          <circle
            cx={hover.x}
            cy={hover.y}
            r={3.5}
            fill="#111315"
            stroke={stroke}
            strokeWidth={2}
          />
          <rect
            x={tooltip.x}
            y={tooltip.y}
            width={tooltip.width}
            height={STATS_TOOLTIP_H}
            rx={6}
            fill="#101113"
            stroke="rgba(255,255,255,0.13)"
            strokeWidth={1}
          />
          <text
            className={styles.chartTooltipValue}
            x={tooltip.x + tooltip.width / 2}
            y={tooltip.y + 13}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
          >
            {hover.val}
          </text>
          <text
            className={styles.chartTooltipDate}
            x={tooltip.x + tooltip.width / 2}
            y={tooltip.y + 24}
            textAnchor="middle"
            fontSize={9}
          >
            {hover.date}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Overview tab: EloGuard popup Stats parity (performance / rating / record /
// form cards).
// ---------------------------------------------------------------------------

function StatsOverviewSection({
  games,
  series,
  currentRating,
  ratedFilter,
  nowSec,
  windowStart,
}: {
  games: StatsGame[];
  series: StatsPerformancePoint[];
  currentRating: number | null;
  ratedFilter: StatsRatedFilter;
  nowSec: number;
  windowStart: number;
}) {
  const performance = useMemo(
    () =>
      computePeriodPerformance(games, {
        currentRating,
        nowSec,
        windowStart,
        windowEnd: nowSec,
      }),
    [currentRating, games, nowSec, windowStart],
  );
  const form = useMemo(
    () => computeFormSummary(games, { currentRating, nowSec }),
    [currentRating, games, nowSec],
  );
  const ratedGames = useMemo(
    () => games.filter((game) => game.rated && Number.isFinite(game.rating)),
    [games],
  );
  const perfPoints = useMemo(
    () => series.map((point) => ({ t: point.end, v: point.perf })),
    [series],
  );
  const ratedPoints = useMemo(
    () => ratedGames.map((game) => ({ t: game.end, v: game.rating })),
    [ratedGames],
  );

  const perfDelta =
    performance && series.length >= 2 ? series[series.length - 1].perf - series[0].perf : null;
  const perfTone =
    performance && currentRating != null
      ? performance.perf >= currentRating + 15
        ? "up"
        : performance.perf <= currentRating - 15
          ? "down"
          : "flat"
      : "flat";

  const ratingDelta =
    ratedGames.length >= 2 ? ratedGames[ratedGames.length - 1].rating - ratedGames[0].rating : null;
  // Empty period with a known rating: flat carry-forward baseline, no fill, so
  // a reference line cannot be mistaken for observed movement.
  const flatBaseline = ratedPoints.length === 0 && currentRating != null;
  const ratingPoints = useMemo(
    () =>
      flatBaseline && currentRating != null
        ? [
            { t: windowStart, v: currentRating },
            { t: nowSec, v: currentRating },
          ]
        : ratedPoints,
    [currentRating, flatBaseline, nowSec, ratedPoints, windowStart],
  );

  const record = useMemo(() => {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    for (const game of games) {
      if (game.result === "win") wins += 1;
      else if (game.result === "draw") draws += 1;
      else losses += 1;
    }
    return { wins, draws, losses };
  }, [games]);

  const trend = Math.round(form.slopePerWeek);
  const trendDir = deltaDir(trend);

  return (
    <Box className={styles.cardGrid}>
      <Box className={styles.card}>
        <Box className={styles.cardHead}>
          <span className={styles.cardLabel}>Performance rating</span>
          <span className={styles.heroWrap}>
            {performance ? (
              <span className={styles.hero} data-tone={perfTone}>
                {Math.round(performance.perf)}
              </span>
            ) : null}
            <StatsDeltaChip value={perfDelta} />
          </span>
        </Box>
        {performance ? (
          <>
            <StatsLineChart points={perfPoints} stroke={STATS_GREEN} extendTo={nowSec} />
            <Text className={styles.dataLine}>
              Likely range {performance.ci68[0]} to {performance.ci68[1]} ·{" "}
              {pluralStats(performance.gamesWithOpp, "game")}
            </Text>
          </>
        ) : (
          <Text className={styles.emptyLine}>Not enough games.</Text>
        )}
      </Box>

      <Box className={styles.card}>
        <Box className={styles.cardHead}>
          <span className={styles.cardLabel}>Rating</span>
          <span className={styles.heroWrap}>
            {currentRating != null ? (
              <span className={styles.hero}>{Math.round(currentRating)}</span>
            ) : null}
            <StatsDeltaChip value={ratingDelta} />
          </span>
        </Box>
        {ratedFilter === "casual" ? (
          <Text className={styles.emptyLine}>Rated games only.</Text>
        ) : ratingPoints.length > 0 ? (
          <StatsLineChart
            points={ratingPoints}
            stroke="var(--mantine-color-blue-4)"
            fill={!flatBaseline}
            extendTo={nowSec}
          />
        ) : (
          <Text className={styles.emptyLine}>Not enough games.</Text>
        )}
      </Box>

      <Box className={styles.card}>
        <span className={styles.cardLabel}>Record</span>
        <div className={styles.recordGrid}>
          <div className={styles.recordCell}>
            <span className={styles.recordValue} data-tone="win">
              {record.wins}
            </span>
            <span className={styles.recordLabel}>Wins</span>
          </div>
          <div className={styles.recordCell}>
            <span className={styles.recordValue} data-tone="draw">
              {record.draws}
            </span>
            <span className={styles.recordLabel}>Draws</span>
          </div>
          <div className={styles.recordCell}>
            <span className={styles.recordValue} data-tone="loss">
              {record.losses}
            </span>
            <span className={styles.recordLabel}>Losses</span>
          </div>
          <div className={styles.recordCell}>
            <span className={styles.recordValue}>{games.length}</span>
            <span className={styles.recordLabel}>Games</span>
          </div>
        </div>
      </Box>

      <Box className={styles.card}>
        <span className={styles.cardLabel}>Form</span>
        {games.length === 0 ? (
          <Text className={styles.emptyLine}>No games in this period.</Text>
        ) : (
          <>
            <div className={styles.formRows}>
              <div className={styles.formRow}>
                <Text size="sm">Trend</Text>
                <Text size="sm" className={styles.formValue} data-dir={trendDir}>
                  {trendDir === "up" ? "▲ " : trendDir === "down" ? "▼ " : ""}
                  {formatSignedStats(trend)} / week
                </Text>
              </div>
              <div className={styles.formRow}>
                <Text size="sm">Current streak</Text>
                <Text size="sm" className={styles.formValue}>
                  {formatStatsStreak(form.streak)}
                </Text>
              </div>
              <div className={styles.formRow}>
                <Text size="sm">Sessions in period</Text>
                <Text size="sm" className={styles.formValue}>
                  {form.sessions}
                </Text>
              </div>
              <div className={styles.formRow}>
                <Text size="sm">Net last 10</Text>
                <Text
                  size="sm"
                  className={styles.formValue}
                  data-dir={form.net10 !== 0 ? deltaDir(form.net10) : undefined}
                >
                  {formatSignedStats(form.net10)}
                </Text>
              </div>
            </div>
            {form.tilt ? (
              <Box className={styles.tiltNote}>
                <Badge color="red" variant="light">
                  Tilt risk
                </Badge>
                <Text size="xs" c="dimmed" mt={4}>
                  Losses are stacking up in quick sessions. A short break usually earns the points
                  back.
                </Text>
              </Box>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Strength tab: EloGuard strength-profile parity (pool cards, phases, recent
// analyzed games) plus the batch-analysis controls.
// ---------------------------------------------------------------------------

function StatsStrengthSection({
  games,
  entries,
  periodWindow,
  nowSec,
  poolRatings,
  onEntriesChanged,
}: {
  games: StatsGame[];
  entries: AnalyzedGameEntry[];
  periodWindow: StatsWindow;
  nowSec: number;
  poolRatings: StatsPoolRatings;
  onEntriesChanged: () => void;
}) {
  const [analyzeCount, setAnalyzeCount] = useState("10");
  const [running, setRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    gamesDone: number;
    gamesTotal: number;
    positionsDone: number;
    positionsTotal: number;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const analysisRef = useRef<AbortController | null>(null);

  useEffect(() => () => analysisRef.current?.abort(), []);

  const periodEntries = useMemo(
    () =>
      entries.filter((entry) => entry.end >= periodWindow.start && entry.end <= periodWindow.end),
    [entries, periodWindow.end, periodWindow.start],
  );
  // The list is always period-scoped, so skip recency decay (EloGuard passes
  // noDecay for every range-filtered profile).
  const profile = useMemo(
    () => aggregateProfile(periodEntries, nowSec * 1000, { noDecay: true }),
    [nowSec, periodEntries],
  );
  const primaryPool = profile.primaryPool;
  const primaryRating = primaryPool ? (poolRatings[primaryPool] ?? null) : null;
  const phaseRows = STATS_PHASE_ORDER.map((phaseKey) => profile.phases[phaseKey]).filter(
    (phase): phase is PhaseProfile => Boolean(phase),
  );

  const runAnalysis = async () => {
    if (running) return;
    const controller = new AbortController();
    analysisRef.current = controller;
    setRunning(true);
    setAnalysisError("");
    setBatchProgress(null);
    try {
      await runStatsBatchAnalysis(games, {
        maxGames: Number.parseInt(analyzeCount, 10) || 10,
        signal: controller.signal,
        onProgress: (info) => {
          if (controller.signal.aborted) return;
          setBatchProgress({
            gamesDone: info.gamesDone,
            gamesTotal: info.gamesTotal,
            positionsDone: info.positionsDone,
            positionsTotal: info.positionsTotal,
          });
        },
      });
    } catch (analysisFailure) {
      if (!controller.signal.aborted) {
        const message =
          analysisFailure instanceof Error
            ? analysisFailure.message
            : "The games could not be analyzed.";
        setAnalysisError(message);
        notifications.show({ title: "Analysis failed", message, color: "red" });
      }
    } finally {
      if (analysisRef.current === controller) {
        analysisRef.current = null;
        setRunning(false);
        setBatchProgress(null);
      }
      // Refresh even after a cancel so partially analyzed games appear.
      onEntriesChanged();
    }
  };

  const progressValue =
    batchProgress && batchProgress.gamesTotal > 0
      ? Math.min(
          100,
          ((batchProgress.gamesDone +
            (batchProgress.positionsTotal > 0
              ? batchProgress.positionsDone / batchProgress.positionsTotal
              : 0)) /
            batchProgress.gamesTotal) *
            100,
        )
      : 0;

  const analyzeControls = (
    <>
      <Group gap="xs" wrap="nowrap" className={styles.analyzeRow}>
        <Select
          size="xs"
          className={styles.analyzeSelect}
          value={analyzeCount}
          onChange={(value) => value && setAnalyzeCount(value)}
          data={[
            { value: "10", label: "Analyze last 10" },
            { value: "25", label: "Analyze last 25" },
            { value: "50", label: "Analyze last 50" },
          ]}
          disabled={running}
          allowDeselect={false}
          aria-label="How many games to analyze"
        />
        <Button
          size="xs"
          color={running ? "red" : undefined}
          variant={running ? "light" : "filled"}
          onClick={() => {
            if (running) analysisRef.current?.abort();
            else void runAnalysis();
          }}
        >
          {running ? "Cancel" : "Analyze"}
        </Button>
      </Group>
      {running ? (
        <Box mt="xs">
          <Progress
            size="xs"
            value={progressValue}
            animated={!batchProgress || batchProgress.gamesTotal === 0}
          />
          <Text size="xs" c="dimmed" mt={4}>
            {batchProgress && batchProgress.gamesTotal > 0
              ? `Game ${Math.min(batchProgress.gamesDone + 1, batchProgress.gamesTotal)} of ${batchProgress.gamesTotal}${
                  batchProgress.positionsTotal > 0
                    ? ` · position ${batchProgress.positionsDone}/${batchProgress.positionsTotal}`
                    : ""
                }`
              : "Preparing games for analysis..."}
          </Text>
        </Box>
      ) : null}
      {analysisError ? (
        <Text size="xs" c="red.4" mt={4}>
          {analysisError}
        </Text>
      ) : null}
      <Text size="xs" c="dimmed" mt={6}>
        Analysis uses your PC's engine — start it or try later.
      </Text>
    </>
  );

  if (periodEntries.length === 0) {
    return (
      <Stack gap="xs">
        <Box className={styles.card}>
          <span className={styles.cardLabel}>Playing strength</span>
          <Text size="sm" mt={6}>
            Playing strength is a rating estimate built from your move quality — accuracy, blunders,
            and clock pressure — using the EloGuard model, independent of results.
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            No analyzed games in this period yet. Analyze a batch to unlock pool, phase, and
            per-game strength estimates.
          </Text>
          <Box mt="sm">{analyzeControls}</Box>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      <Box className={styles.card}>
        <Text size="sm" fw={600}>
          {pluralStats(periodEntries.length, "analyzed game")} in this period
        </Text>
        <Box mt="xs">{analyzeControls}</Box>
      </Box>

      <Box>
        <span className={styles.sectionLabel}>Playing strength</span>
        <div className={styles.poolGrid}>
          {STATS_POOL_ORDER.map((poolKey) => {
            const pool = profile.pools[poolKey];
            if (!pool) return null;
            const poolRating = poolRatings[poolKey] ?? null;
            const anchored =
              poolRating != null && pool.aggFeature != null
                ? anchoredStrength(pool.aggFeature, pool.effMoves, poolKey, poolRating)
                : null;
            const strength = anchored ? anchored.strength : (pool.estimate?.rating ?? null);
            const uncertainty = anchored
              ? anchored.uncertainty
              : (pool.estimate?.uncertainty ?? null);
            const accent = STATS_POOL_ACCENTS[poolKey];
            return (
              <Box className={`${styles.card} ${styles.poolCard}`} key={poolKey}>
                <Group justify="space-between" gap={4} wrap="nowrap" w="100%">
                  <span className={styles.poolName}>{poolKey}</span>
                  <Text size="xs" c="dimmed">
                    {pluralStats(pool.games, "game")}
                  </Text>
                </Group>
                {strength != null ? (
                  <div className={styles.poolStrength}>
                    ~{Math.round(strength)}
                    {uncertainty != null ? (
                      <span className={styles.poolUnc}>±{Math.round(uncertainty)}</span>
                    ) : null}
                  </div>
                ) : (
                  <Text size="xs" c="dimmed">
                    Not enough moves yet.
                  </Text>
                )}
                {anchored && poolRating != null ? (
                  <span
                    className={styles.poolDelta}
                    data-dir={deltaDir(Math.round(anchored.delta))}
                  >
                    {formatSignedStats(anchored.delta)} vs your {Math.round(poolRating)}
                  </span>
                ) : null}
                {pool.accuracy != null ? (
                  <div className={styles.accRow}>
                    <span className={styles.accLabel}>Accuracy</span>
                    <div className={styles.accBar}>
                      <div
                        className={styles.accFill}
                        style={{
                          width: `${clampAccuracyWidth(pool.accuracy)}%`,
                          background: accent,
                        }}
                      />
                    </div>
                    <span className={styles.accValue}>{pool.accuracy.toFixed(1)}%</span>
                  </div>
                ) : null}
              </Box>
            );
          })}
        </div>
      </Box>

      <Box>
        <span className={styles.sectionLabel}>By phase</span>
        <Box className={styles.card}>
          {phaseRows.length === 0 ? (
            <Text className={styles.emptyLine}>Not enough phase data yet.</Text>
          ) : (
            phaseRows.map((phase) => {
              const anchored =
                primaryPool && primaryRating != null && phase.aggFeature != null
                  ? anchoredStrength(phase.aggFeature, phase.effMoves, primaryPool, primaryRating)
                  : null;
              return (
                <div className={styles.phaseRow} key={phase.phase}>
                  <div className={styles.phaseTop}>
                    <Text size="sm" fw={700} className={styles.phaseName}>
                      {STATS_PHASE_LABELS[phase.phase]}
                    </Text>
                    {anchored ? (
                      <span
                        className={styles.poolDelta}
                        data-dir={deltaDir(Math.round(anchored.delta))}
                      >
                        {formatSignedStats(anchored.delta)}
                      </span>
                    ) : phase.estimate ? (
                      <span className={styles.phaseEst}>
                        ~{Math.round(phase.estimate.rating)} ±
                        {Math.round(phase.estimate.uncertainty)}
                      </span>
                    ) : null}
                    <Text size="xs" c="dimmed" className={styles.phaseMoves}>
                      {pluralStats(phase.moves, "move")}
                    </Text>
                    {phase.accuracy != null ? (
                      <span className={styles.phaseAcc}>{phase.accuracy.toFixed(1)}%</span>
                    ) : null}
                  </div>
                  {phase.accuracy != null ? (
                    <div className={`${styles.accBar} ${styles.phaseBar}`}>
                      <div
                        className={styles.accFill}
                        style={{
                          width: `${clampAccuracyWidth(phase.accuracy)}%`,
                          background: primaryPool ? STATS_POOL_ACCENTS[primaryPool] : STATS_GREEN,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </Box>
      </Box>

      {profile.recent.length > 0 ? (
        <Box>
          <span className={styles.sectionLabel}>Recent analyzed</span>
          <Box className={styles.card}>
            {profile.recent.map(({ entry, estimate }) => {
              const pool = estimate?.pool ?? timeClassOf(entry.timeControl);
              const accent = STATS_POOL_ACCENTS[pool];
              // Same estimator as the single-game review card, anchored to the
              // pool rating when it is known.
              const perf = gamePerformance(
                entry.stats,
                entry.timeControl,
                poolRatings[pool] ?? null,
              );
              const shown = perf
                ? Math.round(perf.perf)
                : estimate
                  ? Math.round(estimate.rating)
                  : null;
              return (
                <div className={styles.recentRow} key={entry.key}>
                  <span className={styles.recentDate}>{formatStatsDate(entry.end)}</span>
                  <span
                    className={styles.poolPill}
                    style={{
                      color: accent,
                      background: `color-mix(in srgb, ${accent} 16%, transparent)`,
                    }}
                  >
                    {pool}
                  </span>
                  <span className={styles.recentAcc}>
                    {formatStatsAccuracy(entry.stats.accuracy)}
                  </span>
                  <span className={styles.recentPerf}>{shown != null ? `~${shown}` : "-"}</span>
                </div>
              );
            })}
          </Box>
        </Box>
      ) : null}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Report tab: aimchess-like period report + AI coach report.
// ---------------------------------------------------------------------------

function StatsMetricRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.metricRow}>
      <div className={styles.metricLabel}>
        <Text size="sm">{label}</Text>
        {hint ? (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        ) : null}
      </div>
      <Text size="sm" className={styles.metricValue}>
        {value}
      </Text>
    </div>
  );
}

function StatsComparisonRow({
  label,
  hint,
  player,
  opponent,
  baseline,
}: {
  label: string;
  hint?: string;
  player: string;
  opponent: string;
  baseline: string;
}) {
  return (
    <div className={styles.compareRow}>
      <div className={styles.compareLabel}>
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <strong>{player}</strong>
      <span>{opponent}</span>
      <span>{baseline}</span>
    </div>
  );
}

function StatsOpponentsCard({ report }: { report: PeriodReport }) {
  const opponents = report.opponents;
  return (
    <Box className={`${styles.card} ${styles.cardWide}`}>
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.cardLabel}>Opponent strength</span>
          <Text size="xs" c="dimmed">
            Results versus the rating you actually faced
          </Text>
        </div>
        <Badge variant="light" color="gray" size="sm">
          {opponents.gamesWithOpponentRating} with ratings
        </Badge>
      </div>

      <div className={styles.insightStrip}>
        <div>
          <strong>
            {opponents.avgOpponentRating != null ? Math.round(opponents.avgOpponentRating) : "-"}
          </strong>
          <span>Average opponent</span>
        </div>
        <div>
          <strong>
            {opponents.medianOpponentRating != null
              ? Math.round(opponents.medianOpponentRating)
              : "-"}
          </strong>
          <span>Median opponent</span>
        </div>
        <div>
          <strong>
            {opponents.avgRatingGap != null ? formatSignedStats(opponents.avgRatingGap) : "-"}
          </strong>
          <span>Average rating gap</span>
        </div>
        <div>
          <strong
            data-dir={
              opponents.scoreDeltaPct != null ? deltaDir(opponents.scoreDeltaPct) : undefined
            }
          >
            {formatSignedDecimal(opponents.scoreDeltaPct, "pp")}
          </strong>
          <span>Score vs expected</span>
        </div>
      </div>

      {opponents.bands.length > 0 ? (
        <div className={styles.bandTable}>
          <div className={styles.bandHead}>
            <span>Opponent band</span>
            <span>G</span>
            <span>Score</span>
            <span>M/G</span>
            <span>B/G</span>
          </div>
          {opponents.bands.map((band) => {
            const useEnginePair =
              band.analyzedGames > 0 && band.opponentAnalyzedGames === band.analyzedGames;
            const useProviderPair = !useEnginePair && band.providerQualityMethod === "lichess";
            const playerMistakes = useEnginePair
              ? band.mistakesPerAnalyzedGame
              : useProviderPair
                ? band.providerMistakesPerGame
                : null;
            const opponentMistakes = useEnginePair
              ? band.opponentMistakesPerAnalyzedGame
              : useProviderPair
                ? band.opponentProviderMistakesPerGame
                : null;
            const playerBlunders = useEnginePair
              ? band.blundersPerAnalyzedGame
              : useProviderPair
                ? band.providerBlundersPerGame
                : null;
            const opponentBlunders = useEnginePair
              ? band.opponentBlundersPerAnalyzedGame
              : useProviderPair
                ? band.opponentProviderBlundersPerGame
                : null;
            const qualityCoverage = useEnginePair
              ? band.analysisCoveragePct
              : useProviderPair
                ? (band.providerAnalyzedGames / band.games) * 100
                : null;
            return (
              <div className={styles.bandRow} key={band.label}>
                <div className={styles.bandIdentity}>
                  <span>
                    {band.label}
                    {band.containsCurrentRating ? <em>Your band</em> : null}
                  </span>
                  <small>
                    Avg {Math.round(band.avgOpponentRating)} ·{" "}
                    {qualityCoverage != null
                      ? `${Math.round(qualityCoverage)}% ${useEnginePair ? "engine" : "Lichess"}`
                      : "not paired"}
                  </small>
                </div>
                <strong>{band.games}</strong>
                <div className={styles.bandStack}>
                  <strong>{Math.round(band.scorePct)}%</strong>
                  <small data-dir={deltaDir(band.scoreDeltaPct)}>
                    {formatSignedDecimal(band.scoreDeltaPct, "pp")}
                  </small>
                </div>
                <div className={styles.bandStack}>
                  <strong>{formatStatsDecimal(playerMistakes)}</strong>
                  <small>opp {formatStatsDecimal(opponentMistakes)}</small>
                </div>
                <div className={styles.bandStack}>
                  <strong>{formatStatsDecimal(playerBlunders)}</strong>
                  <small>opp {formatStatsDecimal(opponentBlunders)}</small>
                </div>
              </div>
            );
          })}
          <Text size="xs" c="dimmed" className={styles.tableNote}>
            Score subline is the difference from Elo expectation. Error sublines compare you with
            the opponents in these same games. Standardized engine analysis is preferred; Lichess
            server counts are used only when it is unavailable.
          </Text>
        </div>
      ) : (
        <Text className={styles.emptyLine}>No opponent ratings in this period.</Text>
      )}
    </Box>
  );
}

function StatsQualityCard({ report }: { report: PeriodReport }) {
  const mistakes = report.mistakes;
  if (!mistakes || mistakes.analyzedGames === 0) {
    const provider = report.providerQuality;
    if (provider) {
      const providerName = provider.provider === "chesscom" ? "Chess.com" : "Lichess";
      const providerRows = [
        {
          label: "Accuracy",
          player: formatStatsAccuracy(provider.avgPlayerAccuracy),
          opponent: formatStatsAccuracy(provider.avgOpponentAccuracy),
        },
        {
          label: "ACPL",
          hint: "lower is better",
          player: formatStatsDecimal(provider.avgPlayerAcpl),
          opponent: formatStatsDecimal(provider.avgOpponentAcpl),
        },
        {
          label: "Inaccuracies / game",
          player: formatStatsDecimal(provider.playerInaccuraciesPerGame),
          opponent: formatStatsDecimal(provider.opponentInaccuraciesPerGame),
        },
        {
          label: "Mistakes / game",
          player: formatStatsDecimal(provider.playerMistakesPerGame),
          opponent: formatStatsDecimal(provider.opponentMistakesPerGame),
        },
        {
          label: "Blunders / game",
          player: formatStatsDecimal(provider.playerBlundersPerGame),
          opponent: formatStatsDecimal(provider.opponentBlundersPerGame),
        },
      ];
      return (
        <Box className={`${styles.card} ${styles.cardWide}`}>
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.cardLabel}>Move quality</span>
              <Text size="xs" c="dimmed">
                Existing {providerName} analysis, available without a new engine run
              </Text>
            </div>
            <Badge variant="light" color="gray" size="sm">
              {Math.max(provider.playerSamples, provider.playerErrorSamples)} games
            </Badge>
          </div>
          <div className={styles.compareTable}>
            <div className={`${styles.compareRow} ${styles.compareHead}`}>
              <span>Metric</span>
              <span>You</span>
              <span>Opp</span>
              <span>Source</span>
            </div>
            {providerRows.map((row) => (
              <StatsComparisonRow key={row.label} {...row} baseline={providerName} />
            ))}
          </div>
          <Text size="xs" c="dimmed" className={styles.tableNote}>
            Provider formulas stay separate from En Croissant engine accuracy. Analyze games in
            Strength to add standardized phase, clock, conversion, and rating-model comparisons.
          </Text>
        </Box>
      );
    }
    return (
      <Box className={`${styles.card} ${styles.cardWide}`}>
        <span className={styles.cardLabel}>Move quality</span>
        <Text className={styles.emptyLine}>
          Analyze games in the Strength tab to unlock decision quality, opponent comparisons, and
          position insights. Analysis only runs when you ask for it.
        </Text>
      </Box>
    );
  }

  const player = mistakes.player;
  const comparisonPlayer = mistakes.pairedPlayer ?? player;
  const opponent = mistakes.opponents;
  const benchmark = mistakes.peerBenchmark;
  const comparisonRows = [
    {
      label: "Accuracy",
      player: formatStatsAccuracy(comparisonPlayer.avgAccuracy),
      opponent: formatStatsAccuracy(opponent?.avgAccuracy ?? null),
      baseline: benchmark ? formatStatsAccuracy(benchmark.expectedAccuracy) : "-",
    },
    {
      label: "ACPL",
      hint: "lower is better",
      player: formatStatsDecimal(comparisonPlayer.avgAcpl),
      opponent: formatStatsDecimal(opponent?.avgAcpl ?? null),
      baseline: benchmark ? formatStatsDecimal(benchmark.expectedAcpl) : "-",
    },
    {
      label: "Inaccuracies / game",
      player: formatStatsDecimal(comparisonPlayer.inaccuraciesPerGame),
      opponent: formatStatsDecimal(opponent?.inaccuraciesPerGame ?? null),
      baseline: "-",
    },
    {
      label: "Mistakes / game",
      player: formatStatsDecimal(comparisonPlayer.mistakesPerGame),
      opponent: formatStatsDecimal(opponent?.mistakesPerGame ?? null),
      baseline: "-",
    },
    {
      label: "Blunders / game",
      player: formatStatsDecimal(comparisonPlayer.blundersPerGame),
      opponent: formatStatsDecimal(opponent?.blundersPerGame ?? null),
      baseline: "-",
    },
    {
      label: "Errors / 100 moves",
      hint: "mistakes + blunders",
      player: formatStatsDecimal(comparisonPlayer.errorsPer100Moves),
      opponent: formatStatsDecimal(opponent?.errorsPer100Moves ?? null),
      baseline: "-",
    },
    {
      label: "Clean games",
      hint: "no mistake or blunder",
      player: formatStatsPercent(comparisonPlayer.cleanGamePct),
      opponent: formatStatsPercent(opponent?.cleanGamePct ?? null),
      baseline: "-",
    },
  ];

  return (
    <Box className={`${styles.card} ${styles.cardWide}`}>
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.cardLabel}>Move quality</span>
          <Text size="xs" c="dimmed">
            {mistakes.pairedGames > 0
              ? `Standardized engine analysis · ${mistakes.pairedGames} paired games`
              : "Standardized engine analysis for your moves"}
          </Text>
        </div>
        <Badge variant="light" color="blue" size="sm">
          {mistakes.analyzedGames}/{report.record.games} games ·{" "}
          {Math.round(mistakes.analysisCoveragePct)}%
        </Badge>
      </div>

      <div className={styles.compareTable}>
        <div className={`${styles.compareRow} ${styles.compareHead}`}>
          <span>Metric</span>
          <span>You</span>
          <span>Opp</span>
          <span>Band model</span>
        </div>
        {comparisonRows.map((row) => (
          <StatsComparisonRow key={row.label} {...row} />
        ))}
      </div>

      {mistakes.pairedGames > 0 && mistakes.pairedGames < mistakes.analyzedGames ? (
        <Text size="xs" c="dimmed" className={styles.tableNote}>
          You/Opp and band-model columns use the same {mistakes.pairedGames} paired games. Phase
          rows retain all {mistakes.analyzedGames} player analyses; reanalyzing legacy games adds
          their opponent side.
        </Text>
      ) : mistakes.pairedGames === 0 ? (
        <Text size="xs" c="dimmed" className={styles.tableNote}>
          These legacy results cover your moves only. Reanalyze them in Strength to add a paired
          opponent comparison; no provider or engine formulas are mixed.
        </Text>
      ) : null}

      {benchmark ? (
        <div className={styles.benchmarkNote}>
          <span>
            Estimated {benchmark.ratingBandLabel} baseline · {benchmark.samples} matched games
          </span>
          <strong
            data-dir={
              benchmark.accuracyDelta != null ? deltaDir(benchmark.accuracyDelta) : undefined
            }
          >
            {formatSignedDecimal(benchmark.accuracyDelta, "pp")} accuracy
          </strong>
          <small>
            Calibrated EloGuard model, not a live population percentile. Opp is the empirical
            comparison from your games.
          </small>
        </div>
      ) : null}

      {report.providerQuality ? (
        <div className={styles.providerLine}>
          <span>
            {report.providerQuality.provider === "chesscom" ? "Chess.com" : "Lichess"} provider
            accuracy
          </span>
          <strong>{formatStatsAccuracy(report.providerQuality.avgPlayerAccuracy)}</strong>
          <span>vs {formatStatsAccuracy(report.providerQuality.avgOpponentAccuracy)} opp</span>
          <small>
            {report.providerQuality.playerSamples} games · kept separate from engine accuracy
          </small>
        </div>
      ) : null}

      <div className={styles.phaseQualityTable}>
        <div className={styles.phaseQualityHead}>
          <span>Phase</span>
          <span>Moves</span>
          <span>Accuracy</span>
          <span>ACPL</span>
          <span>Blunders</span>
        </div>
        {STATS_PHASE_ORDER.map((phase) => {
          const quality = mistakes.phaseQuality[phase];
          return (
            <div className={styles.phaseQualityRow} key={phase}>
              <strong>{STATS_PHASE_LABELS[phase]}</strong>
              <span>{quality.moves}</span>
              <span>{formatStatsAccuracy(quality.avgAccuracy)}</span>
              <span>{formatStatsDecimal(quality.avgAcpl)}</span>
              <span>{mistakes.byPhase[phase].blunders}</span>
            </div>
          );
        })}
      </div>

      {mistakes.worstGames.length > 0 ? (
        <div className={styles.worstList}>
          {mistakes.worstGames.map(({ entry, game }) => (
            <div className={styles.worstRow} key={entry.key}>
              <span className={styles.recentDate}>{formatStatsDate(entry.end)}</span>
              <Text size="xs" className={styles.openingName} truncate>
                {entry.openingName ?? game?.openingName ?? entry.eco ?? "Unknown opening"}
              </Text>
              <span className={styles.recentAcc}>{formatStatsAccuracy(entry.stats.accuracy)}</span>
              <span className={styles.worstBlunders}>
                {pluralStats(entry.counts.blunder, "blunder")}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <Text size="xs" c="dimmed" className={styles.tableNote}>
        Inaccuracy: &gt;5 percentage-point win-chance loss; mistake: &gt;10; blunder: ≥20. Forced
        and book moves are excluded.
      </Text>
    </Box>
  );
}

function StatsSituationsCard({ report }: { report: PeriodReport }) {
  const situations = report.mistakes?.situations;
  if (!situations) return null;
  const decisionRows = [
    { label: "Advantage", hint: "started ≥ +1.5", value: situations.advantage },
    { label: "Defence", hint: "started ≤ -1.5", value: situations.defence },
    { label: "Balanced", hint: "between -1.5 and +1.5", value: situations.balanced },
    { label: "Critical", hint: "volatile positions", value: situations.critical },
    { label: "Fast", hint: "snap decisions", value: situations.fast },
    { label: "Long think", hint: "≥8s or 8% base", value: situations.longThink },
    { label: "Low clock", hint: "≤12% base", value: situations.timeTrouble },
  ].filter((row) => row.value.moves > 0);

  return (
    <Box className={`${styles.card} ${styles.cardWide}`}>
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.cardLabel}>Position outcomes</span>
          <Text size="xs" c="dimmed">
            What happens after the evaluation or clock changes the task
          </Text>
        </div>
        <Badge variant="light" color="gray" size="sm">
          {situations.games} analyzed
        </Badge>
      </div>

      <div className={styles.outcomeGrid}>
        <div>
          <span>Advantage conversion</span>
          <strong>{formatStatsPercent(situations.conversionPct)}</strong>
          <small>
            {situations.convertedWinningChances}/{situations.winningChances} wins after reaching +3
          </small>
        </div>
        <div>
          <span>Resourcefulness</span>
          <strong>{formatStatsPercent(situations.savePct)}</strong>
          <small>
            {situations.savedLosingChances}/{situations.losingChances} saved after falling to -3
          </small>
        </div>
        <div>
          <span>Evaluation after move 15</span>
          <strong>{formatEvalCp(situations.avgMove15EvalCp)}</strong>
          <small>Average, from your perspective</small>
        </div>
        <div>
          <span>Opening exit chance</span>
          <strong>{formatStatsPercent(situations.avgOpeningExitWinPct)}</strong>
          <small>Average win probability</small>
        </div>
      </div>

      {decisionRows.length > 0 ? (
        <div className={styles.decisionTable}>
          <div className={styles.decisionHead}>
            <span>Decision context</span>
            <span>Moves</span>
            <span>Accuracy</span>
            <span>Error rate</span>
          </div>
          {decisionRows.map((row) => (
            <div className={styles.decisionRow} key={row.label}>
              <div>
                <strong>{row.label}</strong>
                <small>{row.hint}</small>
              </div>
              <span>{row.value.moves}</span>
              <span>{formatStatsAccuracy(row.value.accuracy)}</span>
              <span>{formatStatsPercent(row.value.errorPct)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {situations.endgames.games > 0 ? (
        <div className={styles.endgameGrid}>
          {(["better", "equal", "worse"] as const).map((key) => {
            const bucket = situations.endgames[key];
            return (
              <div key={key}>
                <span>Entered {key}</span>
                <strong>{formatStatsPercent(bucket.scorePct)}</strong>
                <small>{pluralStats(bucket.games, "game")}</small>
              </div>
            );
          })}
        </div>
      ) : null}
    </Box>
  );
}

function StatsPatternsCard({ report }: { report: PeriodReport }) {
  const rows = [...report.patterns.byColor, ...report.patterns.byWeekday];
  if (rows.length === 0) return null;
  return (
    <Box className={styles.card}>
      <span className={styles.cardLabel}>Performance patterns</span>
      <div className={styles.patternRows}>
        {rows.map((row, index) => (
          <div
            className={styles.patternRow}
            data-group-start={index === report.patterns.byColor.length ? "true" : undefined}
            key={`${row.key}-${row.label}`}
          >
            <span>{row.label}</span>
            <div className={styles.wdlBar}>
              {row.wins > 0 ? (
                <span className={styles.wdlWin} style={{ flexGrow: row.wins }} />
              ) : null}
              {row.draws > 0 ? (
                <span className={styles.wdlDraw} style={{ flexGrow: row.draws }} />
              ) : null}
              {row.losses > 0 ? (
                <span className={styles.wdlLoss} style={{ flexGrow: row.losses }} />
              ) : null}
            </div>
            <small>{row.games}g</small>
            <strong>{Math.round(row.scorePct)}%</strong>
          </div>
        ))}
      </div>
    </Box>
  );
}

function StatsAiSectionGroup({
  title,
  items,
  tone,
}: {
  title: string;
  items: StatsAiReportSection[];
  tone: "good" | "bad" | "focus";
}) {
  if (items.length === 0) return null;
  return (
    <Box>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>
        {title}
      </Text>
      <Stack gap={6}>
        {items.map((item, index) => (
          <Box className={styles.aiCard} data-tone={tone} key={`${title}-${index}`}>
            <Text size="sm" fw={700}>
              {item.title}
            </Text>
            <Text size="sm">{item.detail}</Text>
            {item.drill ? (
              <Text size="xs" c="dimmed" mt={2}>
                Drill: {item.drill}
              </Text>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function StatsAiReportCard({
  report,
  periodLabel,
  cacheKey,
  source,
  username,
  timeClass,
}: {
  report: PeriodReport;
  periodLabel: string;
  cacheKey: string;
  source: StatsSource;
  username: string;
  timeClass: StatsTimeClass;
}) {
  const [cached, setCached] = useState<StatsAiReportResponse | null>(() =>
    loadStatsAiReport(cacheKey),
  );
  const [health, setHealth] = useState<WebChessCoachHealth | null>(null);
  const [healthError, setHealthError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<WebChessCoachProgress | null>(null);
  const [aiError, setAiError] = useState("");
  const healthRequestRef = useRef<AbortController | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const cacheKeyRef = useRef(cacheKey);

  useEffect(() => {
    if (cacheKeyRef.current === cacheKey) return;
    cacheKeyRef.current = cacheKey;
    setCached(loadStatsAiReport(cacheKey));
    setAiError("");
  }, [cacheKey]);

  const loadHealth = useCallback(() => {
    if (healthRequestRef.current) return;
    const controller = new AbortController();
    healthRequestRef.current = controller;
    setHealthError("");
    void getWebChessCoachHealth(controller.signal)
      .then((nextHealth) => setHealth(nextHealth))
      .catch((healthFailure) => {
        if (controller.signal.aborted) return;
        setHealth(null);
        setHealthError(
          healthFailure instanceof Error ? healthFailure.message : "The PC coach is unreachable.",
        );
      })
      .finally(() => {
        if (healthRequestRef.current === controller) healthRequestRef.current = null;
      });
  }, []);

  useEffect(() => {
    loadHealth();
    return () => {
      healthRequestRef.current?.abort();
      requestRef.current?.abort();
      if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current);
    };
  }, [loadHealth]);

  useEffect(() => {
    if (health?.ok) return;
    const retryId = window.setInterval(loadHealth, 5000);
    return () => window.clearInterval(retryId);
  }, [health?.ok, loadHealth]);

  const coachReady = Boolean(health?.ok && health.modelAvailable);

  async function generateReport() {
    if (generating || !coachReady) return;
    const controller = new AbortController();
    const requestId = createStatsRequestId();
    requestRef.current = controller;
    setGenerating(true);
    setAiError("");
    setProgress({
      requestId,
      phase: "queued",
      label: "Sending this period's numbers to the PC...",
      completed: 0,
      total: 0,
    });
    try {
      let progressFetchRunning = false;
      const pollProgress = async () => {
        if (progressFetchRunning || controller.signal.aborted) return;
        progressFetchRunning = true;
        try {
          const nextProgress = await getWebChessCoachProgress(requestId, controller.signal);
          if (!controller.signal.aborted) setProgress(nextProgress);
        } catch {
          // The POST may not have registered its progress record yet.
        } finally {
          progressFetchRunning = false;
        }
      };
      progressTimerRef.current = window.setInterval(() => void pollProgress(), 750);
      const result = await askStatsAiReport({
        payload: { requestId, periodLabel, source, username, timeClass, aggregate: report },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      saveStatsAiReport(cacheKey, result);
      setCached(result);
    } catch (reportFailure) {
      if (controller.signal.aborted) return;
      setAiError(
        reportFailure instanceof Error
          ? reportFailure.message
          : "The PC could not write the report.",
      );
      loadHealth();
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
        setGenerating(false);
        setProgress(null);
      }
    }
  }

  return (
    <Box className={`${styles.card} ${styles.cardWide}`}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <span className={styles.cardLabel}>AI coach report</span>
        {cached ? (
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={!coachReady || generating}
            onClick={() => void generateReport()}
          >
            Regenerate
          </Button>
        ) : null}
      </Group>

      {!coachReady && !generating ? (
        <Text size="xs" c="dimmed" mt={6}>
          {healthError ||
            (health && !health.modelAvailable
              ? "The PC coach model is not ready yet. This card retries automatically."
              : "The PC coach is offline. This card reconnects automatically once your PC is reachable.")}
        </Text>
      ) : null}

      {generating ? (
        <Box mt="xs">
          <Text size="sm" fw={600}>
            {progress?.label || "Writing your report on the PC..."}
          </Text>
          <Progress
            value={
              progress && progress.total > 0
                ? Math.min(100, (progress.completed / progress.total) * 100)
                : 100
            }
            animated={!progress || progress.total === 0}
            size="sm"
            mt="xs"
          />
        </Box>
      ) : null}

      {aiError ? (
        <Text size="xs" c="red.4" mt={6}>
          {aiError}
        </Text>
      ) : null}

      {cached ? (
        <Stack gap="sm" mt="sm">
          <Box className={classes.coachAnswer}>
            <ReactMarkdown>{cached.report.overview}</ReactMarkdown>
          </Box>
          <StatsAiSectionGroup title="Strengths" items={cached.report.strengths} tone="good" />
          <StatsAiSectionGroup title="Weaknesses" items={cached.report.weaknesses} tone="bad" />
          <StatsAiSectionGroup title="Focus areas" items={cached.report.focusAreas} tone="focus" />
          {cached.report.themes.length > 0 ? (
            <Group gap={6}>
              {cached.report.themes.map((theme) => (
                <Badge key={theme} variant="light" color="gray">
                  {theme}
                </Badge>
              ))}
            </Group>
          ) : null}
          <Text size="xs" c="dimmed">
            Generated {formatStatsGeneratedAt(cached.generatedAt)} · {cached.model ?? "PC coach"}
          </Text>
        </Stack>
      ) : (
        <Box mt="sm">
          <Button
            leftSection={<IconSparkles size={16} />}
            disabled={!coachReady}
            loading={generating}
            onClick={() => void generateReport()}
          >
            Generate AI report
          </Button>
        </Box>
      )}
    </Box>
  );
}

function StatsReportSection({
  games,
  analyzed,
  periodWindow,
  nowSec,
  currentRating,
  source,
  username,
  timeClass,
  ratedFilter,
  periodKey,
}: {
  games: StatsGame[];
  analyzed: AnalyzedGameEntry[];
  periodWindow: StatsWindow;
  nowSec: number;
  currentRating: number | null;
  source: StatsSource;
  username: string;
  timeClass: StatsTimeClass;
  ratedFilter: StatsRatedFilter;
  periodKey: StatsPeriodKey;
}) {
  const [openingColor, setOpeningColor] = useState<"w" | "b">("w");
  const report = useMemo(
    () =>
      computePeriodReport({
        games,
        analyzed,
        windowStart: periodWindow.start,
        windowEnd: periodWindow.end,
        label: periodWindow.label,
        nowSec,
        currentRating,
      }),
    [
      analyzed,
      currentRating,
      games,
      nowSec,
      periodWindow.end,
      periodWindow.label,
      periodWindow.start,
    ],
  );

  const time = report.time;
  const phaseSeconds = time
    ? STATS_PHASE_ORDER.map((phase) => ({ phase, seconds: time.byPhaseSeconds[phase] })).filter(
        (row): row is { phase: StrengthPhase; seconds: number } =>
          row.seconds != null && Number.isFinite(row.seconds),
      )
    : [];
  const maxPhaseSeconds = phaseSeconds.reduce((max, row) => Math.max(max, row.seconds), 0);

  const openingRows = (openingColor === "w" ? report.openings.white : report.openings.black).slice(
    0,
    5,
  );
  const selectedGames = games.filter(
    (game) => game.end >= periodWindow.start && game.end <= periodWindow.end,
  );
  const analyzedStamp = analyzed.reduce((latest, entry) => Math.max(latest, entry.ts), 0);
  const cacheKey = [
    "stats-v2",
    source,
    username.toLowerCase(),
    timeClass,
    ratedFilter,
    periodKey,
    selectedGames.length,
    selectedGames[0]?.end ?? 0,
    selectedGames.at(-1)?.end ?? 0,
    analyzedStamp,
  ].join("|");

  return (
    <Box className={styles.cardGrid}>
      <Box className={`${styles.card} ${styles.cardWide}`}>
        <span className={styles.cardLabel}>{periodWindow.label}</span>
        <div className={styles.tileGrid}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{report.record.games}</span>
            <span className={styles.tileLabel}>Games</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{formatStatsPercent(report.record.scorePct)}</span>
            <span className={styles.tileLabel}>Score</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>
              {report.perf ? Math.round(report.perf.perf) : "-"}
            </span>
            <span className={styles.tileLabel}>Performance</span>
          </div>
          <div className={styles.tile}>
            <span
              className={styles.tileValue}
              data-dir={
                report.rating.delta != null && report.rating.delta !== 0
                  ? deltaDir(report.rating.delta)
                  : undefined
              }
            >
              {report.rating.delta != null ? formatSignedStats(report.rating.delta) : "-"}
            </span>
            <span className={styles.tileLabel}>Rating Δ</span>
          </div>
        </div>
      </Box>

      <StatsOpponentsCard report={report} />

      {report.weekly.length > 0 ? (
        <Box className={`${styles.card} ${styles.cardWide}`}>
          <span className={styles.cardLabel}>Week by week</span>
          <div className={styles.weekTable}>
            <div className={styles.weekRow} data-head="true">
              <span>Week</span>
              <span>Games</span>
              <span>Score</span>
              <span>Perf</span>
              <span>Rating</span>
            </div>
            {report.weekly.map((week) => (
              <div
                className={styles.weekRow}
                data-current={nowSec >= week.start && nowSec < week.end ? "true" : undefined}
                key={week.start}
              >
                <span>{week.label}</span>
                <span>{week.games}</span>
                <span>{formatStatsPercent(week.scorePct)}</span>
                <span>{week.perf != null ? Math.round(week.perf) : "-"}</span>
                <span>{week.ratingEnd != null ? Math.round(week.ratingEnd) : "-"}</span>
              </div>
            ))}
          </div>
        </Box>
      ) : null}

      {time && time.gamesWithClocks > 0 ? (
        <Box className={styles.card}>
          <span className={styles.cardLabel}>Time management</span>
          <div className={styles.metricRows}>
            <StatsMetricRow label="Avg move time" value={formatStatsSeconds(time.avgMoveSeconds)} />
            <StatsMetricRow
              label="Median move time"
              value={formatStatsSeconds(time.medianMoveSeconds)}
            />
            <StatsMetricRow
              label="Fast moves"
              value={formatStatsPercent(time.fastMovePct)}
              hint="premoves & snap decisions"
            />
            <StatsMetricRow
              label="Scramble"
              value={formatStatsPercent(time.scramblePct)}
              hint="moves under 12% clock"
            />
            <StatsMetricRow
              label="Clock left at finish"
              value={formatStatsPercent(time.avgRemainingPctAtEnd)}
              hint={`average across ${time.gamesWithClocks} clocked games`}
            />
            <StatsMetricRow
              label="Timeout losses"
              value={`${time.timeoutLosses}${
                time.timeoutLossPct != null
                  ? ` (${Math.round(time.timeoutLossPct)}% of losses)`
                  : ""
              }`}
            />
          </div>
          {phaseSeconds.length > 0 ? (
            <div className={styles.miniBars}>
              {phaseSeconds.map((row) => (
                <div className={styles.miniBarRow} key={row.phase}>
                  <span className={styles.miniBarLabel}>{STATS_PHASE_LABELS[row.phase]}</span>
                  <div className={styles.miniBarTrack}>
                    <div
                      className={styles.miniBarFill}
                      style={{
                        width: `${
                          maxPhaseSeconds > 0
                            ? Math.max(3, (row.seconds / maxPhaseSeconds) * 100)
                            : 0
                        }%`,
                        background: "var(--mantine-color-blue-4)",
                      }}
                    />
                  </div>
                  <span className={styles.miniBarValue}>{formatStatsSeconds(row.seconds)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {Object.values(time.clockBalanceAtMove20).some((bucket) => bucket.games > 0) ? (
            <div className={styles.clockBalanceTable}>
              <div className={styles.clockBalanceHead}>
                <span>Clock at move 20</span>
                <span>Games</span>
                <span>Score</span>
              </div>
              {(["ahead", "even", "behind"] as const).map((state) => {
                const bucket = time.clockBalanceAtMove20[state];
                return (
                  <div className={styles.clockBalanceRow} key={state}>
                    <span>
                      {state === "ahead"
                        ? "20%+ more time"
                        : state === "behind"
                          ? "20%+ less time"
                          : "Within 20%"}
                    </span>
                    <strong>{bucket.games}</strong>
                    <strong>{formatStatsPercent(bucket.scorePct)}</strong>
                  </div>
                );
              })}
            </div>
          ) : null}
          {time.clockCurve.length > 0 ? (
            <div className={styles.clockCurve}>
              <div className={styles.clockCurveHead}>
                <span>Clock remaining</span>
                <span>You</span>
                <span>Opp</span>
              </div>
              {time.clockCurve.map((checkpoint) => (
                <div className={styles.clockCurveRow} key={checkpoint.move}>
                  <span>
                    Move {checkpoint.move} <small>({checkpoint.games}g)</small>
                  </span>
                  <strong>{formatStatsPercent(checkpoint.playerRemainingPct)}</strong>
                  <span>{formatStatsPercent(checkpoint.opponentRemainingPct)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </Box>
      ) : (
        <Box className={styles.card}>
          <span className={styles.cardLabel}>Time management</span>
          <Text className={styles.emptyLine}>No clock data in these games.</Text>
        </Box>
      )}

      <Box className={styles.card}>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <span className={styles.cardLabel}>Openings</span>
          <SegmentedControl
            size="xs"
            value={openingColor}
            onChange={(value) => setOpeningColor(value === "b" ? "b" : "w")}
            data={[
              { value: "w", label: "White" },
              { value: "b", label: "Black" },
            ]}
            aria-label="Opening color"
          />
        </Group>
        {openingRows.length === 0 ? (
          <Text className={styles.emptyLine}>No games in this period.</Text>
        ) : (
          <div className={styles.openingRows}>
            {openingRows.map((opening) => (
              <div className={styles.openingRow} key={opening.key}>
                <Text size="sm" className={styles.openingName} truncate>
                  {opening.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {opening.games}
                </Text>
                <div className={styles.wdlBar}>
                  {opening.wins > 0 ? (
                    <span className={styles.wdlWin} style={{ flexGrow: opening.wins }} />
                  ) : null}
                  {opening.draws > 0 ? (
                    <span className={styles.wdlDraw} style={{ flexGrow: opening.draws }} />
                  ) : null}
                  {opening.losses > 0 ? (
                    <span className={styles.wdlLoss} style={{ flexGrow: opening.losses }} />
                  ) : null}
                </div>
                <span className={styles.openingScore}>{Math.round(opening.scorePct)}%</span>
              </div>
            ))}
          </div>
        )}
        {report.openings.best || report.openings.worst ? (
          <div className={styles.openingCallouts}>
            {report.openings.best ? (
              <Text size="xs">
                <Text component="span" size="xs" c="green.3" fw={700}>
                  Best:
                </Text>{" "}
                {report.openings.best.name} {Math.round(report.openings.best.scorePct)}%
              </Text>
            ) : null}
            {report.openings.worst ? (
              <Text size="xs">
                <Text component="span" size="xs" c="red.3" fw={700}>
                  Struggling:
                </Text>{" "}
                {report.openings.worst.name} {Math.round(report.openings.worst.scorePct)}%
              </Text>
            ) : null}
          </div>
        ) : null}
      </Box>

      <StatsQualityCard report={report} />
      <StatsSituationsCard report={report} />

      <StatsPatternsCard report={report} />

      <Box className={styles.card}>
        <span className={styles.cardLabel}>Highlights</span>
        <div className={styles.metricRows}>
          <StatsMetricRow
            label="Best win"
            value={
              report.highlights.bestWin
                ? `Beat ${report.highlights.bestWin.oppName ?? "opponent"}${
                    report.highlights.bestWin.opp != null
                      ? ` (${report.highlights.bestWin.opp})`
                      : ""
                  } · ${formatStatsDate(report.highlights.bestWin.end)}`
                : "-"
            }
          />
          <StatsMetricRow
            label="Lowest-rated loss"
            value={
              report.highlights.worstLoss
                ? `Lost to ${report.highlights.worstLoss.oppName ?? "opponent"}${
                    report.highlights.worstLoss.opp != null
                      ? ` (${report.highlights.worstLoss.opp})`
                      : ""
                  }`
                : "-"
            }
          />
          <StatsMetricRow
            label="Upset wins"
            hint="opponent rated 100+ higher"
            value={
              report.highlights.upsetOpportunities > 0
                ? `${report.highlights.upsetWins}/${report.highlights.upsetOpportunities} · ${formatStatsPercent(
                    report.highlights.upsetRatePct,
                  )}`
                : "-"
            }
          />
          <StatsMetricRow
            label="After a loss"
            hint="score in the next game"
            value={formatStatsPercent(report.highlights.postLossScorePct)}
          />
          <StatsMetricRow
            label="Longest win streak"
            value={
              report.highlights.longestWinStreak > 0
                ? pluralStats(report.highlights.longestWinStreak, "win")
                : "-"
            }
          />
          <StatsMetricRow
            label="Most played opponent"
            value={
              report.highlights.mostPlayedOpponent
                ? `${report.highlights.mostPlayedOpponent.name} · ${pluralStats(
                    report.highlights.mostPlayedOpponent.games,
                    "game",
                  )} · ${Math.round(report.highlights.mostPlayedOpponent.scorePct)}%`
                : "-"
            }
          />
        </div>
      </Box>

      <StatsAiReportCard
        report={report}
        periodLabel={periodWindow.label}
        cacheKey={cacheKey}
        source={source}
        username={username}
        timeClass={timeClass}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// StatsWorkspace: full-page Stats view (header, controls, sub-nav, tabs).
// ---------------------------------------------------------------------------

export default function StatsWorkspace({ lichessToken = "" }: { lichessToken?: string }) {
  const [settings, setSettings] = usePersistentJson<StatsSettings>(
    STATS_SETTINGS_STORAGE_KEY,
    normalizeStatsSettings(null),
    normalizeStatsSettings,
  );
  const updateSettings = useCallback(
    (patch: Partial<StatsSettings>) => {
      setSettings((current) => normalizeStatsSettings({ ...current, ...patch }));
    },
    [setSettings],
  );

  const activeUsername =
    settings.source === "chesscom" ? settings.chesscomUsername : settings.lichessUsername;
  const trimmedUsername = activeUsername.trim();
  const [usernameDraft, setUsernameDraft] = useState(activeUsername);
  useEffect(() => {
    setUsernameDraft(activeUsername);
  }, [activeUsername]);

  const [data, setData] = useState<StatsCacheEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedRating, setFetchedRating] = useState<number | null>(null);
  const [poolRatings, setPoolRatings] = useState<StatsPoolRatings>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [analyzedEntries, setAnalyzedEntries] = useState<AnalyzedGameEntry[]>([]);
  const cacheRef = useRef(new Map<string, StatsCacheEntry>());
  const [clockNowSec, setClockNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setClockNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setAnalyzedEntries(loadAnalyzedEntries());
  }, []);
  const refreshAnalyzedEntries = useCallback(() => {
    setAnalyzedEntries(loadAnalyzedEntries());
  }, []);

  const requestedDays = Math.max(STATS_BASE_HISTORY_DAYS, getStatsPeriodDays(settings.period));
  const cacheKey = `${settings.source}|${trimmedUsername.toLowerCase()}|${settings.timeClass}|${settings.rated}`;
  const recentPeriod = ["1h", "6h", "24h", "today"].includes(settings.period);
  const recentRefreshTick = recentPeriod
    ? Math.floor(clockNowSec / STATS_RECENT_REFRESH_SECONDS)
    : 0;

  // Game + rolling-series fetch. Period switches inside the cached coverage
  // only re-filter; only a larger period (or manual refresh) refetches.
  useEffect(() => {
    if (!trimmedUsername) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const cached = cacheRef.current.get(cacheKey);
    const recentCacheIsFresh =
      !recentPeriod ||
      (cached !== undefined && clockNowSec - cached.nowSec < STATS_RECENT_REFRESH_SECONDS);
    if (cached && cached.historyDays >= requestedDays && recentCacheIsFresh) {
      setData(cached);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    void fetchStatsGames({
      source: settings.source,
      username: trimmedUsername,
      timeClass: settings.timeClass,
      ratedFilter: settings.rated,
      maxGames: STATS_MAX_GAMES,
      maxDays: requestedDays,
      monthsCap: Math.ceil(requestedDays / 28) + 1,
      lichessToken: settings.source === "lichess" ? lichessToken.trim() || null : null,
      signal: controller.signal,
    })
      .then((games) => {
        if (!active) return;
        const nowSec = Math.floor(Date.now() / 1000);
        const series = computePerformanceSeries(games, { windowSize: 20 });
        const entry: StatsCacheEntry = { games, series, nowSec, historyDays: requestedDays };
        const existing = cacheRef.current.get(cacheKey);
        if (!existing || existing.historyDays <= entry.historyDays) {
          cacheRef.current.set(cacheKey, entry);
        }
        setData(entry);
      })
      .catch((fetchError) => {
        if (!active) return;
        setData(null);
        setError(fetchError instanceof Error ? fetchError.message : "Couldn't load your games.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    cacheKey,
    clockNowSec,
    recentPeriod,
    recentRefreshTick,
    refreshKey,
    requestedDays,
    lichessToken,
    settings.rated,
    settings.source,
    settings.timeClass,
    trimmedUsername,
  ]);

  // Live rating for the selected time class (Overview hero fallback).
  useEffect(() => {
    if (!trimmedUsername) {
      setFetchedRating(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    void fetchCurrentRating({
      source: settings.source,
      username: trimmedUsername,
      timeClass: settings.timeClass,
      signal: controller.signal,
    })
      .then((rating) => {
        if (active) setFetchedRating(rating);
      })
      .catch(() => {
        if (active) setFetchedRating(null);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshKey, settings.source, settings.timeClass, trimmedUsername]);

  // Per-pool baselines for the Strength tab (chess.com has no classical pool,
  // so classical anchors to the rapid rating, matching EloGuard).
  useEffect(() => {
    if (!trimmedUsername) {
      setPoolRatings({});
      return;
    }
    const controller = new AbortController();
    let active = true;
    const poolClasses: [StrengthPool, StatsTimeClass][] =
      settings.source === "lichess"
        ? [
            ["bullet", "bullet"],
            ["blitz", "blitz"],
            ["rapid", "rapid"],
            ["classical", "classical"],
          ]
        : [
            ["bullet", "bullet"],
            ["blitz", "blitz"],
            ["rapid", "rapid"],
            ["classical", "rapid"],
          ];
    void Promise.all(
      poolClasses.map(async ([pool, poolTimeClass]) => {
        const rating = await fetchCurrentRating({
          source: settings.source,
          username: trimmedUsername,
          timeClass: poolTimeClass,
          signal: controller.signal,
        }).catch(() => null);
        return [pool, rating] as const;
      }),
    ).then((ratings) => {
      if (!active) return;
      setPoolRatings(Object.fromEntries(ratings));
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshKey, settings.source, trimmedUsername]);

  // Recent rolling windows advance while the page stays open. Calendar windows
  // still clamp their effective "now" at the end of the selected week.
  const nowSec = clockNowSec;
  const periodWindow = useMemo(
    () => getStatsWindow(settings.period, nowSec),
    [nowSec, settings.period],
  );
  const effectiveNowSec = Math.min(nowSec, periodWindow.end);
  const periodGames = useMemo(
    () =>
      data
        ? data.games.filter(
            (game) => game.end >= periodWindow.start && game.end <= periodWindow.end,
          )
        : [],
    [data, periodWindow.end, periodWindow.start],
  );
  const periodSeries = useMemo(
    () =>
      data
        ? data.series.filter(
            (point) => point.end >= periodWindow.start && point.end <= periodWindow.end,
          )
        : [],
    [data, periodWindow.end, periodWindow.start],
  );

  // Current rating: last rated game in period, then the live fetched rating,
  // then the newest rated game in the wider cache (EloGuard order).
  const currentRating = useMemo(() => {
    const ratedInPeriod = periodGames.filter((game) => game.rated && Number.isFinite(game.rating));
    if (ratedInPeriod.length > 0) return ratedInPeriod[ratedInPeriod.length - 1].rating;
    if (fetchedRating != null && Number.isFinite(fetchedRating)) return fetchedRating;
    const lastKnown = data?.games
      .filter((game) => game.rated && Number.isFinite(game.rating))
      .at(-1);
    return lastKnown ? lastKnown.rating : null;
  }, [data, fetchedRating, periodGames]);

  const commitUsername = useCallback(() => {
    const trimmed = usernameDraft.trim();
    updateSettings(
      settings.source === "chesscom" ? { chesscomUsername: trimmed } : { lichessUsername: trimmed },
    );
  }, [settings.source, updateSettings, usernameDraft]);

  const handleRefresh = useCallback(() => {
    cacheRef.current.delete(cacheKey);
    setRefreshKey((value) => value + 1);
  }, [cacheKey]);

  const timeClassOptions = useMemo(
    () =>
      settings.source === "chesscom"
        ? [
            { value: "bullet", label: "Bullet" },
            { value: "blitz", label: "Blitz" },
            { value: "rapid", label: "Rapid" },
            { value: "daily", label: "Daily" },
          ]
        : [
            { value: "bullet", label: "Bullet" },
            { value: "blitz", label: "Blitz" },
            { value: "rapid", label: "Rapid" },
            { value: "classical", label: "Classical" },
          ],
    [settings.source],
  );

  return (
    <Box className={styles.workspace}>
      <Group className={styles.pageHeader} justify="space-between" gap="xs" wrap="nowrap">
        <Box miw={0}>
          <Title order={2} className={styles.pageTitle}>
            Stats
          </Title>
          <Text size="xs" c="dimmed" className={styles.pageSubtitle} truncate>
            {trimmedUsername
              ? `${trimmedUsername} · ${getStatsSourceLabel(settings.source)}`
              : "Performance, strength, and reports"}
          </Text>
        </Box>
        <ActionIcon
          aria-label="Refresh stats"
          className={styles.refreshButton}
          size="lg"
          loading={loading}
          onClick={handleRefresh}
        >
          <IconRefresh size={20} />
        </ActionIcon>
      </Group>

      <Box className={`${classes.panel} ${styles.controlsCard}`}>
        <Group gap="xs" wrap="nowrap" className={styles.controlsRow}>
          <SegmentedControl
            size="xs"
            value={settings.source}
            onChange={(value) =>
              updateSettings({ source: value === "lichess" ? "lichess" : "chesscom" })
            }
            data={[
              { value: "chesscom", label: "chess.com" },
              { value: "lichess", label: "Lichess" },
            ]}
            aria-label="Stats source"
          />
          <TextInput
            size="xs"
            className={styles.usernameInput}
            value={usernameDraft}
            onChange={(event) => setUsernameDraft(event.currentTarget.value)}
            onBlur={commitUsername}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder={settings.source === "chesscom" ? "chess.com username" : "Lichess username"}
            aria-label="Username"
          />
        </Group>
        <div className={styles.selectRow}>
          <Select
            size="xs"
            value={settings.timeClass}
            onChange={(value) => value && updateSettings({ timeClass: value as StatsTimeClass })}
            data={timeClassOptions}
            allowDeselect={false}
            aria-label="Time class"
          />
          <Select
            size="xs"
            value={settings.rated}
            onChange={(value) => value && updateSettings({ rated: value as StatsRatedFilter })}
            data={[
              { value: "rated", label: "Rated" },
              { value: "casual", label: "Casual" },
              { value: "both", label: "All games" },
            ]}
            allowDeselect={false}
            aria-label="Rated filter"
          />
          <Select
            size="xs"
            value={settings.period}
            onChange={(value) => value && updateSettings({ period: value as StatsPeriodKey })}
            data={STATS_PERIOD_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            allowDeselect={false}
            aria-label="Stats period"
          />
        </div>
        {data ? (
          <Text size="xs" c="dimmed" className={styles.syncLine}>
            Synced{" "}
            {new Date(data.nowSec * 1000).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {recentPeriod ? " · refreshes each minute" : ""} · ranges use local time
          </Text>
        ) : null}
      </Box>

      <SegmentedControl
        fullWidth
        size="sm"
        className={styles.subNav}
        value={settings.tab}
        onChange={(value) => updateSettings({ tab: value as StatsTab })}
        data={[
          { value: "overview", label: "Overview" },
          { value: "strength", label: "Strength" },
          { value: "report", label: "Report" },
        ]}
        aria-label="Stats section"
      />

      {!trimmedUsername ? (
        <Box className={`${classes.panel} ${styles.emptyState}`}>
          <IconChartLine size={30} stroke={1.5} />
          <Text fw={600}>Add your chess.com or Lichess username</Text>
          <Text size="xs" c="dimmed" maw="22rem">
            Pick a source above, type the account name, and press Enter. Games load straight from
            the public APIs.
          </Text>
        </Box>
      ) : loading ? (
        <Center mih={200}>
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text size="xs" c="dimmed">
              Loading your games...
            </Text>
          </Stack>
        </Center>
      ) : error ? (
        <Box className={`${classes.panel} ${styles.emptyState}`}>
          <Text size="sm">{error}</Text>
          <Button size="xs" variant="light" onClick={handleRefresh}>
            Retry
          </Button>
        </Box>
      ) : data ? (
        settings.tab === "overview" ? (
          <StatsOverviewSection
            games={periodGames}
            series={periodSeries}
            currentRating={currentRating}
            ratedFilter={settings.rated}
            nowSec={effectiveNowSec}
            windowStart={periodWindow.start}
          />
        ) : settings.tab === "strength" ? (
          <StatsStrengthSection
            games={periodGames}
            entries={analyzedEntries}
            periodWindow={periodWindow}
            nowSec={effectiveNowSec}
            poolRatings={poolRatings}
            onEntriesChanged={refreshAnalyzedEntries}
          />
        ) : (
          <StatsReportSection
            games={data.games}
            analyzed={analyzedEntries}
            periodWindow={periodWindow}
            nowSec={effectiveNowSec}
            currentRating={currentRating}
            source={settings.source}
            username={trimmedUsername}
            timeClass={settings.timeClass}
            ratedFilter={settings.rated}
            periodKey={settings.period}
          />
        )
      ) : null}
    </Box>
  );
}
