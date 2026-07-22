import { Box, Divider, Group, LoadingOverlay, Stack, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import equal from "fast-deep-equal";
import type React from "react";
import { useContext, useMemo } from "react";
import { useStore } from "zustand";
import { buildGameAnalysisReport, type GameAnalysisSideStats } from "@/utils/gameAnalysisReport";
import { TreeStateContext } from "./TreeStateContext";
import classes from "./GameAnalysisReport.module.css";

function GameAnalysisReport({ isAnalysing }: { isAnalysing: boolean }) {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const position = useStore(store, (s) => s.position);
  const goToMove = useStore(store, (s) => s.goToMove);

  const report = useMemo(() => buildGameAnalysisReport(root, headers), [headers, root]);

  return (
    <Box className={classes.report}>
      <Box className={classes.reportGrid}>
        <EvalReportChart
          report={report}
          position={position}
          goToMove={goToMove}
          isAnalysing={isAnalysing}
        />
        <Stack gap={0} className={classes.statsPanel}>
          <PlayerStats color="white" stats={report.white} />
          <Divider my={4} />
          <PlayerStats color="black" stats={report.black} />
        </Stack>
      </Box>
    </Box>
  );
}

function EvalReportChart({
  report,
  position,
  goToMove,
  isAnalysing,
}: {
  report: ReturnType<typeof buildGameAnalysisReport>;
  position: number[];
  goToMove: (path: number[]) => void;
  isAnalysing: boolean;
}) {
  const coords = useMemo(() => {
    const last = Math.max(1, report.chart.length - 1);
    return report.chart.map((point, index) => ({
      point,
      x: (index / last) * 100,
      y: (1 - (point.y + 1) / 2) * 100,
    }));
  }, [report.chart]);

  const linePath = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const activePoint = coords.find(({ point }) => equal(point.path, position));
  const phaseMarkers = [
    { label: "Middlegame", index: report.phases.middlegamePly },
    { label: "Endgame", index: report.phases.endgamePly },
  ]
    .filter((marker): marker is { label: string; index: number } => marker.index !== null)
    .map((marker) => ({
      ...marker,
      x: coords.find(({ point }) => point.index >= marker.index)?.x ?? null,
    }))
    .filter((marker): marker is { label: string; index: number; x: number } => marker.x !== null);

  function handleChartClick(event: React.MouseEvent<HTMLDivElement>) {
    if (coords.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = ((event.clientX - rect.left) / rect.width) * 100;
    const nearest = coords.reduce((best, point) =>
      Math.abs(point.x - clickX) < Math.abs(best.x - clickX) ? point : best,
    );
    goToMove(nearest.point.path);
  }

  return (
    <Box className={classes.chartFrame} onClick={handleChartClick} aria-label="Game analysis chart">
      <LoadingOverlay visible={isAnalysing} />
      <div className={classes.zeroLine} />
      <span className={classes.phaseLabel} style={{ left: "1%" }}>
        Opening
      </span>
      {phaseMarkers.map((marker) => (
        <span key={marker.label} className={classes.phaseLabel} style={{ left: `${marker.x}%` }}>
          {marker.label}
        </span>
      ))}
      {phaseMarkers.map((marker) => (
        <span
          key={`${marker.label}-line`}
          className={classes.phaseLine}
          style={{ left: `${marker.x}%` }}
        />
      ))}
      {activePoint && <span className={classes.activeLine} style={{ left: `${activePoint.x}%` }} />}
      <svg className={classes.chartSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        {linePath && (
          <polyline
            points={linePath}
            fill="none"
            stroke="var(--mantine-color-orange-7)"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {coords.map(({ point, x, y }) =>
          point.judgement ? (
            <circle
              key={`${point.index}-${point.judgement}`}
              cx={x}
              cy={y}
              r={1.2}
              className={classes[judgementDotClass(point.judgement)]}
            />
          ) : null,
        )}
      </svg>
      {coords.length === 0 && (
        <Text className={classes.emptyReport} size="sm" c="dimmed">
          Run Stockfish analysis to see the game report.
        </Text>
      )}
    </Box>
  );
}

function PlayerStats({ color, stats }: { color: "white" | "black"; stats: GameAnalysisSideStats }) {
  return (
    <Group align="flex-start" wrap="nowrap" gap="sm" className={classes.playerStats}>
      <span className={color === "white" ? classes.whiteDisc : classes.blackDisc} />
      <Stack gap={1} className={classes.playerValues}>
        <Text fw={700} size="xs" className={classes.playerName}>
          {stats.name}
        </Text>
        <ReportStat value={stats.inaccuracies} label="Inaccuracies" tone="inaccuracy" />
        <ReportStat value={stats.mistakes} label="Mistakes" tone="mistake" />
        <ReportStat
          value={stats.blunders}
          label={stats.blunders === 1 ? "Blunder" : "Blunders"}
          tone="blunder"
        />
        <ReportStat
          value={stats.averageCentipawnLoss === null ? "-" : Math.round(stats.averageCentipawnLoss)}
          label="Average centipawn loss"
        />
        <Group gap={5} wrap="nowrap" className={classes.statRow}>
          <Text span fw={700} size="xs" className={classes.statValue}>
            {stats.accuracy === null ? "-" : `${Math.round(stats.accuracy)}%`}
          </Text>
          <Text span size="xs" className={classes.statLabel}>
            Accuracy
          </Text>
          <Tooltip label="Lichess-style game accuracy: a blend of volatility-weighted mean and harmonic mean over move accuracies.">
            <IconInfoCircle size={13} className={classes.infoIcon} />
          </Tooltip>
        </Group>
      </Stack>
    </Group>
  );
}

function ReportStat({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone?: "inaccuracy" | "mistake" | "blunder";
}) {
  return (
    <Group gap={8} wrap="nowrap" className={classes.statRow}>
      <Text span fw={700} size="xs" className={`${classes.statValue} ${tone ? classes[tone] : ""}`}>
        {value}
      </Text>
      <Text span size="xs" className={`${classes.statLabel} ${tone ? classes[tone] : ""}`}>
        {label}
      </Text>
    </Group>
  );
}

function judgementDotClass(judgement: "inaccuracy" | "mistake" | "blunder") {
  switch (judgement) {
    case "inaccuracy":
      return "inaccuracyDot";
    case "mistake":
      return "mistakeDot";
    case "blunder":
      return "blunderDot";
  }
}

export default GameAnalysisReport;
