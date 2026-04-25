import { Badge, Group, Progress, Stack, Text, Tooltip } from "@mantine/core";
import { isNormal, makeSquare } from "chessops";
import { parseSan } from "chessops/san";
import { useAtom, useSetAtom } from "jotai";
import { DataTable } from "mantine-datatable";
import { memo, useCallback, useContext, useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { currentBoardPreviewShapesAtom, moveNotationTypeAtom } from "@/state/atoms";
import { addPieceSymbol } from "@/utils/annotation";
import { positionFromFen } from "@/utils/chessops";
import type { Opening } from "@/utils/db";
import { formatNumber } from "@/utils/format";
import {
  getOpeningMoveHealthMap,
  resolveOpeningMoveHealthSide,
  type OpeningMoveHealth,
  type OpeningMoveHealthSidePreference,
  type OpeningMoveHealthStatus,
} from "@/utils/openingMoveHealth";
import classes from "./OpeningsTable.module.css";

export type OpeningSort = "games" | "health" | "whiteRate" | "blackRate" | "drawRate" | "move";

export const openingSortOptions: { label: string; value: OpeningSort }[] = [
  { label: "Most played", value: "games" },
  { label: "Move health", value: "health" },
  { label: "White win rate", value: "whiteRate" },
  { label: "Black win rate", value: "blackRate" },
  { label: "Draw rate", value: "drawRate" },
  { label: "Move", value: "move" },
];

export const openingMoveHealthSideOptions: {
  label: string;
  value: OpeningMoveHealthSidePreference;
}[] = [
  { label: "Side to move", value: "sideToMove" },
  { label: "White", value: "white" },
  { label: "Black", value: "black" },
];

export function sortOpeningRows(
  openings: Opening[],
  sortBy: OpeningSort,
  healthByMove?: Map<string, OpeningMoveHealth>,
) {
  return [...openings].sort((a, b) => {
    if (sortBy === "move") {
      return a.move.localeCompare(b.move);
    }

    const aTotal = getOpeningTotal(a);
    const bTotal = getOpeningTotal(b);

    if (sortBy === "games") {
      return bTotal - aTotal;
    }

    if (sortBy === "health") {
      const aHealth = healthByMove?.get(a.move)?.score ?? 50;
      const bHealth = healthByMove?.get(b.move)?.score ?? 50;
      return aHealth - bHealth || bTotal - aTotal;
    }

    const field = sortBy === "whiteRate" ? "white" : sortBy === "blackRate" ? "black" : "draw";
    const aRate = aTotal === 0 ? 0 : a[field] / aTotal;
    const bRate = bTotal === 0 ? 0 : b[field] / bTotal;

    return bRate - aRate || bTotal - aTotal;
  });
}

function OpeningsTable({
  openings,
  loading,
  sortBy = "games",
  compact = false,
  healthSidePreference = "sideToMove",
  referenceOpenings,
}: {
  openings: Opening[];
  loading: boolean;
  sortBy?: OpeningSort;
  compact?: boolean;
  healthSidePreference?: OpeningMoveHealthSidePreference;
  referenceOpenings?: Opening[];
}) {
  const store = useContext(TreeStateContext)!;
  const makeMove = useStore(store, (s) => s.makeMove);
  const currentFen = useStore(store, (s) => s.currentNode().fen);
  const [moveNotationType] = useAtom(moveNotationTypeAtom);
  const setBoardPreviewShapes = useSetAtom(currentBoardPreviewShapesAtom);

  const clearMovePreview = useCallback(() => {
    setBoardPreviewShapes(null);
  }, [setBoardPreviewShapes]);

  useEffect(() => clearMovePreview, [clearMovePreview]);

  const previewMove = useCallback(
    (moveSan: string) => {
      if (moveSan === "Total" || moveSan === "*") {
        clearMovePreview();
        return;
      }

      const [pos] = positionFromFen(currentFen);
      if (!pos) {
        clearMovePreview();
        return;
      }

      const move = parseSan(pos, moveSan);
      if (!move || !isNormal(move)) {
        clearMovePreview();
        return;
      }

      setBoardPreviewShapes({
        fen: currentFen,
        shapes: [
          {
            orig: makeSquare(move.from),
            dest: makeSquare(move.to),
            brush: "preview",
            modifiers: {
              lineWidth: 10,
            },
          },
        ],
      });
    },
    [clearMovePreview, currentFen, setBoardPreviewShapes],
  );

  const healthSide = useMemo(() => {
    const [pos] = positionFromFen(currentFen);
    return resolveOpeningMoveHealthSide(healthSidePreference, pos?.turn ?? "white");
  }, [currentFen, healthSidePreference]);

  const healthByMove = useMemo(
    () => getOpeningMoveHealthMap(openings, healthSide, referenceOpenings),
    [healthSide, openings, referenceOpenings],
  );

  openings = sortOpeningRows(openings, sortBy, healthByMove);

  const whiteTotal = openings?.reduce((acc, curr) => acc + curr.white, 0);
  const blackTotal = openings?.reduce((acc, curr) => acc + curr.black, 0);
  const drawTotal = openings?.reduce((acc, curr) => acc + curr.draw, 0);
  const grandTotal = whiteTotal + blackTotal + drawTotal;

  if (openings.length > 0) {
    openings = [
      ...openings,
      {
        move: "Total",
        white: whiteTotal,
        black: blackTotal,
        draw: drawTotal,
      },
    ];
  }

  return (
    <DataTable
      withTableBorder
      highlightOnHover
      records={openings}
      fetching={loading || openings === null}
      rowStyle={(game, i) => {
        if (i === openings.length - 1)
          return {
            fontWeight: 700,
            position: "sticky",
            bottom: 0,
            zIndex: 10,
          };
        return {};
      }}
      columns={[
        {
          accessor: "move",
          width: compact ? 70 : 100,
          render: ({ move }) => {
            if (move === "*")
              return (
                <Text fz={compact ? "xs" : "sm"} fs="italic">
                  Game end
                </Text>
              );
            return (
              <Text fz={compact ? "xs" : "sm"}>
                {moveNotationType === "symbols" ? addPieceSymbol(move) : move}
              </Text>
            );
          },
        },
        {
          accessor: "health",
          width: compact ? 78 : 106,
          render: ({ move }) => {
            const health = healthByMove.get(move);
            if (!health) return null;

            return (
              <Tooltip
                withArrow
                multiline
                w={280}
                label={
                  <Stack gap={2}>
                    <Text size="xs" fw={700}>
                      {health.label} for {capitalize(health.side)}
                    </Text>
                    <Text size="xs">
                      {formatPercent(health.sideScore)} score vs{" "}
                      {formatPercent(health.positionScore)} line average
                    </Text>
                    {health.referenceRank ? (
                      <Text size="xs">
                        Reference #{health.referenceRank}
                        {health.referenceShare !== null
                          ? `, ${formatPercent(health.referenceShare)} share`
                          : ""}
                      </Text>
                    ) : health.topReferenceMove ? (
                      <Text size="xs">
                        Outside reference moves; top is {health.topReferenceMove}
                      </Text>
                    ) : null}
                    {health.reasons.map((reason) => (
                      <Text key={reason} size="xs">
                        {reason}
                      </Text>
                    ))}
                  </Stack>
                }
              >
                <Badge
                  color={healthStatusColor(health.status)}
                  variant="light"
                  size={compact ? "xs" : "sm"}
                  className={classes.healthBadge}
                >
                  {health.label}
                </Badge>
              </Tooltip>
            );
          },
        },
        {
          accessor: "total",
          width: compact ? 118 : 180,
          render: ({ move, white, draw, black }) => {
            const total = white + draw + black;
            const percentage = (total / grandTotal) * 100;
            return (
              <Group gap={compact ? 6 : "md"} wrap="nowrap">
                {move !== "Total" && (
                  <Text fz={compact ? "xs" : "sm"}>{percentage.toFixed(0)}%</Text>
                )}
                <Text fz={compact ? "xs" : "sm"} flex={1} ta="right">
                  {formatNumber(total)}
                </Text>
              </Group>
            );
          },
        },
        {
          accessor: "results",
          render: ({ black, white, draw }) => {
            const total = white + draw + black;
            const whitePercent = (white / total) * 100;
            const drawPercent = (draw / total) * 100;
            const blackPercent = (black / total) * 100;
            return (
              <Progress.Root size={compact ? "lg" : "xl"} className={classes.result}>
                <Progress.Section value={whitePercent} className={classes.whiteResultsSection}>
                  <Progress.Label c="black">
                    {whitePercent > 10 ? `${whitePercent.toFixed(1)}%` : ""}
                  </Progress.Label>
                </Progress.Section>
                <Progress.Section value={drawPercent} color="gray">
                  <Progress.Label>
                    {drawPercent > 10 ? `${drawPercent.toFixed(1)}%` : ""}
                  </Progress.Label>
                </Progress.Section>
                <Progress.Section value={blackPercent} color="black">
                  <Progress.Label>
                    {blackPercent > 10 ? `${blackPercent.toFixed(1)}%` : ""}
                  </Progress.Label>
                </Progress.Section>
              </Progress.Root>
            );
          },
        },
      ]}
      idAccessor="move"
      emptyState={"No games found"}
      onRowClick={({ record }) => makeMove({ payload: record.move })}
      customRowAttributes={(record) => ({
        onMouseEnter: () => previewMove(record.move),
        onMouseLeave: clearMovePreview,
      })}
    />
  );
}

export default memo(OpeningsTable);

function getOpeningTotal(opening: Opening) {
  return opening.white + opening.draw + opening.black;
}

function healthStatusColor(status: OpeningMoveHealthStatus) {
  switch (status) {
    case "weak":
      return "red";
    case "watch":
      return "orange";
    case "strong":
      return "green";
    case "sample":
      return "gray";
    case "ok":
      return "blue";
  }
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
