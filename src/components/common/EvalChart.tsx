import { AreaChart } from "@mantine/charts";
import {
  Alert,
  Box,
  LoadingOverlay,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  useMantineTheme,
} from "@mantine/core";
import equal from "fast-deep-equal";
import { useAtom } from "jotai";
import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CategoricalChartFunc } from "recharts/types/chart/types";
import { useStore } from "zustand";
import { reportTypeAtom } from "@/state/atoms";
import { ANNOTATION_INFO, isBasicAnnotation } from "@/utils/annotation";
import { positionFromFen } from "@/utils/chessops";
import { skipWhile, takeWhile } from "@/utils/misc";
import { getGamePhases } from "@/utils/phase";
import { formatScore } from "@/utils/score";
import type { TreeStore } from "@/state/store/tree";
import { type ListNode, type TreeNode, treeIteratorMainLine } from "@/utils/treeReducer";
import classes from "./EvalChart.module.css";
import { TreeStateContext } from "./TreeStateContext";

interface EvalChartProps {
  isAnalysing: boolean;
  startAnalysis: () => void;
}

type DataPoint = {
  name: string;
  cpText: string;
  wdlText: string;
  yValue: number | "none";
  movePath: number[];
  color: string;
  annotation?: string;
  White: number;
  Draw: number;
  Black: number;
};

function gradientOffset(data: DataPoint[]) {
  const dataMax = Math.max(...data.map((i) => (i.yValue !== "none" ? i.yValue : 0)));
  const dataMin = Math.min(...data.map((i) => (i.yValue !== "none" ? i.yValue : 0)));

  if (dataMax <= 0) return 0;
  if (dataMin >= 0) return 1;

  return dataMax / (dataMax - dataMin);
}

function getYValue(node: TreeNode): number | undefined {
  if (node.score) {
    let cp: number = node.score.value.value;
    if (node.score.value.type === "mate") {
      cp = node.score.value.value > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    return 2 / (1 + Math.exp(-0.004 * cp)) - 1;
  }
  if (node.children.length === 0) {
    // Only terminal nodes without a score need a FEN parse (mate/stalemate check).
    const [pos] = positionFromFen(node.fen);
    if (pos) {
      if (pos.isCheckmate()) {
        return pos?.turn === "white" ? -1 : 1;
      }
      if (pos.isStalemate()) {
        return 0;
      }
    }
  }
}

type TranslateFn = (key: string) => string;

function getEvalText(node: TreeNode, type: "cp" | "wdl", t: TranslateFn): string {
  if (node.score) {
    if (type === "cp") {
      return `${t("Board.Analysis.Advantage")}: ${formatScore(node.score.value)}`;
    }
    if (type === "wdl" && node.score.wdl) {
      return `
         White: ${node.score.wdl[0] / 10}%
         Draw: ${node.score.wdl[1] / 10}%
         Black: ${node.score.wdl[2] / 10}%`;
    }
  }
  if (node.children.length === 0) {
    const [pos] = positionFromFen(node.fen);
    if (pos) {
      if (pos.isCheckmate()) return t("Common.Checkmate");
      if (pos.isStalemate()) return t("Common.Stalemate");
    }
  }
  return t("Board.Analysis.NotAnalysed");
}

// Phase detection parses every mainline FEN — only redo it when the mainline
// actually changes, not on every score/variation update to the tree.
const phasesCache = new WeakMap<
  TreeStore,
  { key: string; phases: ReturnType<typeof getGamePhases> }
>();

function getCachedGamePhases(store: TreeStore, nodes: ListNode[]) {
  const key = nodes.length ? `${nodes.length}:${nodes[nodes.length - 1].node.fen}` : "";
  const cached = phasesCache.get(store);
  if (cached && cached.key === key) return cached.phases;

  const validBoards = nodes.map((n) => positionFromFen(n.node.fen)[0]).filter((b) => b !== null);
  const phases = getGamePhases(validBoards);
  phasesCache.set(store, { key, phases });
  return phases;
}

function EvalChart(props: EvalChartProps) {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);
  const goToMove = useStore(store, (s) => s.goToMove);
  const theme = useMantineTheme();

  const nodes = useMemo<ListNode[]>(() => {
    const allNodes = treeIteratorMainLine(root);
    const withoutRoot = skipWhile(allNodes, (node: ListNode) => node.position.length === 0);
    const withMoves = takeWhile(withoutRoot, (node: ListNode) => node.node.move !== undefined);
    return [...withMoves];
  }, [root]);

  const data = useMemo<DataPoint[]>(
    () =>
      nodes.map((currentNode) => {
        const node = currentNode.node;
        const yValue = getYValue(node);
        const wdl = node.score?.wdl;
        // halfMoves parity gives the side that just moved without parsing the FEN
        const whiteJustMoved = node.halfMoves % 2 === 1;

        return {
          name: `${Math.ceil(node.halfMoves / 2)}.${
            whiteJustMoved ? "" : ".."
          } ${node.san}${node.annotations}`,
          cpText: getEvalText(node, "cp", t),
          wdlText: getEvalText(node, "wdl", t),
          yValue: yValue ?? ("none" as const),
          movePath: currentNode.position,
          color: ANNOTATION_INFO[node.annotations[0]]?.color || "gray",
          annotation: node.annotations[0],
          White: wdl ? wdl[0] : 0,
          Draw: wdl ? wdl[1] : 0,
          Black: wdl ? wdl[2] : 0,
        };
      }),
    [nodes, t],
  );

  const onChartClick: CategoricalChartFunc = (e) => {
    const match = data.find((d) => d.name === e.activeLabel);
    if (match) {
      goToMove(match.movePath);
    }
  };

  const phases = getCachedGamePhases(store, nodes);

  const currentPositionName = data.find((point) => equal(point.movePath, position))?.name;

  const middlegamePositionName =
    phases.middlegamePly !== null ? data[phases.middlegamePly]?.name : null;
  const endgamePositionName = phases.endgamePly !== null ? data[phases.endgamePly]?.name : null;

  const colouroffset = gradientOffset(data);

  const [chartType, setChartType] = useAtom(reportTypeAtom);

  const isWDLDisabled = useMemo(() => {
    return !data.some((point) => point.White !== 0 || point.Black !== 0 || point.Draw !== 0);
  }, [data]);

  return (
    <Stack>
      <Box pos="relative">
        <LoadingOverlay visible={props.isAnalysing === true} />
        <SegmentedControl
          data={["CP", "WDL"]}
          size="xs"
          value={chartType}
          onChange={(v) => setChartType(v as "CP" | "WDL")}
        />
        {chartType === "CP" && (
          <AreaChart
            h={150}
            curveType="monotone"
            data={data}
            dataKey={"name"}
            series={[{ name: "yValue", color: "gray.5" }]}
            connectNulls={false}
            withXAxis={false}
            withYAxis={false}
            yAxisProps={{ domain: [-1, 1] }}
            type="split"
            fillOpacity={0.8}
            splitColors={["gray.1", "black"]}
            splitOffset={colouroffset}
            activeDotProps={{ r: 3, strokeWidth: 1 }}
            dotProps={{ r: 0 }}
            referenceLines={[
              {
                x: currentPositionName,
                color: theme.colors[theme.primaryColor][7],
              },
              ...(middlegamePositionName
                ? [
                    {
                      x: middlegamePositionName,
                      color: "gray.5",
                      strokeDasharray: "5 5",
                      label: t("Board.Analysis.Middlegame"),
                      labelPosition: "insideTopLeft" as const,
                    },
                  ]
                : []),
              ...(endgamePositionName
                ? [
                    {
                      x: endgamePositionName,
                      color: "gray.5",
                      strokeDasharray: "5 5",
                      label: t("Board.Analysis.Endgame"),
                      labelPosition: "insideTopLeft" as const,
                    },
                  ]
                : []),
            ]}
            areaChartProps={{
              onClick: onChartClick,
              style: { cursor: "pointer" },
            }}
            areaProps={{
              isAnimationActive: false,
              dot: <CustomDot />,
            }}
            gridAxis="none"
            tooltipProps={{
              content: ({ payload, active }) => (
                <CustomTooltip active={active} payload={payload} type="cp" />
              ),
            }}
          />
        )}
        {chartType === "WDL" &&
          (isWDLDisabled ? (
            <Alert variant="outline" title="Enable WDL" mt="sm">
              {t("Board.Analysis.EnableWDL")}
            </Alert>
          ) : (
            <AreaChart
              h={150}
              curveType="monotone"
              data={data}
              dataKey={"name"}
              series={[
                { name: "White", color: "white" },
                { name: "Draw", color: "gray" },
                { name: "Black", color: "black" },
              ]}
              connectNulls={false}
              withXAxis={false}
              withYAxis={false}
              type="percent"
              fillOpacity={0.8}
              activeDotProps={{ r: 3, strokeWidth: 1 }}
              dotProps={{ r: 0 }}
              referenceLines={
                [
                  {
                    x: currentPositionName,
                    color: theme.colors[theme.primaryColor][7],
                  },
                  ...(endgamePositionName
                    ? [
                        {
                          x: endgamePositionName,
                          color: "gray.5",
                          strokeDasharray: "5 5",
                          label: t("Board.Analysis.Endgame"),
                        },
                      ]
                    : []),
                ] as any
              }
              areaChartProps={{
                onClick: onChartClick,
                style: { cursor: "pointer" },
              }}
              gridAxis="none"
              tooltipProps={{
                content: ({ payload, active }) => (
                  <CustomTooltip active={active} payload={payload} type="wdl" />
                ),
              }}
            />
          ))}
      </Box>
    </Stack>
  );
}

function CustomTooltip({
  active,
  payload,
  type,
}: {
  active?: boolean;
  payload: readonly { payload: DataPoint }[];
  type: "cp" | "wdl";
}) {
  if (active && payload && payload.length && payload[0].payload) {
    const dataPoint = payload[0].payload;
    return (
      <Paper px="md" py="sm" withBorder shadow="md" radius="md">
        <Text
          className={classes.tooltipTitle}
          c={dataPoint.color === "gray" ? undefined : dataPoint.color}
        >
          {dataPoint.name}
        </Text>
        <Text>{type === "cp" ? dataPoint.cpText : dataPoint.wdlText}</Text>
      </Paper>
    );
  }
  return null;
}

function CustomDot(props: { cx?: number; cy?: number; payload?: any }) {
  const { cx, cy, payload } = props;
  if (!payload || !payload.annotation || !isBasicAnnotation(payload.annotation)) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={`var(--mantine-color-${payload.color}-7)`}
      stroke="var(--mantine-color-body)"
      strokeWidth={1}
      style={{ pointerEvents: "none" }}
    />
  );
}

export default EvalChart;
