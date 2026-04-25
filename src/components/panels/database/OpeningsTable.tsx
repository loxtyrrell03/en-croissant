import { Badge, Group, Progress, Stack, Text, Tooltip } from "@mantine/core";
import { isNormal, makeSquare } from "chessops";
import { parseSan } from "chessops/san";
import { useAtom, useSetAtom } from "jotai";
import { DataTable } from "mantine-datatable";
import { memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { currentBoardPreviewShapesAtom, moveNotationTypeAtom } from "@/state/atoms";
import { addPieceSymbol } from "@/utils/annotation";
import { queryChessDbMoves, type ChessDbCloudMove } from "@/utils/chessdb/api";
import { positionFromFen } from "@/utils/chessops";
import type { Opening } from "@/utils/db";
import { formatNumber } from "@/utils/format";
import {
  getOpeningMoveStrengthMap,
  resolveOpeningMoveHealthSide,
  type OpeningMoveStrength,
  type OpeningMoveHealthSide,
  type OpeningMoveHealthSidePreference,
  type OpeningMoveStrengthStatus,
} from "@/utils/openingMoveHealth";
import classes from "./OpeningsTable.module.css";

export type OpeningSort =
  | "games"
  | "health"
  | "chessDbStrength"
  | "chessDbWeakness"
  | "winRateHigh"
  | "winRateLow"
  | "scoreHigh"
  | "scoreLow"
  | "whiteRate"
  | "blackRate"
  | "drawRate"
  | "move";

export const openingSortOptions: { label: string; value: OpeningSort }[] = [
  { label: "Most played", value: "games" },
  { label: "CP strength", value: "chessDbStrength" },
  { label: "CP weakness", value: "chessDbWeakness" },
  { label: "Highest win rate", value: "winRateHigh" },
  { label: "Lowest win rate", value: "winRateLow" },
  { label: "Highest score", value: "scoreHigh" },
  { label: "Lowest score", value: "scoreLow" },
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
  healthByMove?: Map<string, OpeningMoveStrength>,
  side: OpeningMoveHealthSide = "white",
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

    if (sortBy === "health" || sortBy === "chessDbStrength") {
      const aStrength = getChessDbStrengthSortScore(healthByMove?.get(a.move));
      const bStrength = getChessDbStrengthSortScore(healthByMove?.get(b.move));
      return bStrength - aStrength || bTotal - aTotal;
    }

    if (sortBy === "chessDbWeakness") {
      const aStrength = getChessDbStrengthSortScore(healthByMove?.get(a.move));
      const bStrength = getChessDbStrengthSortScore(healthByMove?.get(b.move));
      return aStrength - bStrength || bTotal - aTotal;
    }

    if (sortBy === "winRateHigh" || sortBy === "winRateLow") {
      const aRate = getSideWinRate(a, side);
      const bRate = getSideWinRate(b, side);
      return sortBy === "winRateHigh"
        ? bRate - aRate || bTotal - aTotal
        : aRate - bRate || bTotal - aTotal;
    }

    if (sortBy === "scoreHigh" || sortBy === "scoreLow") {
      const aScore = getSideScore(a, side);
      const bScore = getSideScore(b, side);
      return sortBy === "scoreHigh"
        ? bScore - aScore || bTotal - aTotal
        : aScore - bScore || bTotal - aTotal;
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
  const [chessDbMoves, setChessDbMoves] = useState<ChessDbCloudMove[] | null | undefined>();

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
    () =>
      getOpeningMoveStrengthMap({
        openings,
        side: healthSide,
        fen: currentFen,
        chessDbMoves,
        referenceOpenings,
      }),
    [chessDbMoves, currentFen, healthSide, openings, referenceOpenings],
  );

  openings = sortOpeningRows(openings, sortBy, healthByMove, healthSide);

  useEffect(() => {
    let cancelled = false;
    setChessDbMoves(undefined);
    void queryChessDbMoves(currentFen)
      .then((moves) => {
        if (!cancelled) {
          setChessDbMoves(moves);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChessDbMoves(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentFen]);

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
          title: "Strength",
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
                      {health.label} move
                    </Text>
                    <Text size="xs">
                      {health.source === "chessdb"
                        ? "Based on ChessDB cloud analysis."
                        : health.pending
                          ? "ChessDB is checking this position in the background."
                          : "ChessDB has no cloud move list here, so this is a quick local estimate."}
                    </Text>
                    {health.cpLoss !== null ? (
                      <Text size="xs">
                        About {Math.round(health.cpLoss)} cp behind ChessDB's best move
                      </Text>
                    ) : null}
                    {health.chessDbScoreRank ? (
                      <Text size="xs">Engine ranking #{health.chessDbScoreRank}</Text>
                    ) : null}
                    {health.chessDbWinrate !== null ? (
                      <Text size="xs">ChessDB win rate {formatPercent(health.chessDbWinrate)}</Text>
                    ) : null}
                    {health.source === "local" && health.referenceRank ? (
                      <Text size="xs">
                        Strong-games choice #{health.referenceRank}
                        {health.referenceShare !== null
                          ? `, ${formatPercent(health.referenceShare)} share`
                          : ""}
                      </Text>
                    ) : health.source === "local" && health.topReferenceMove ? (
                      <Text size="xs">
                        Outside strong-games moves; top is {health.topReferenceMove}
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
          accessor: "strengthRank",
          title: "Engine ranking",
          width: compact ? 76 : 112,
          render: ({ move }) => {
            const health = healthByMove.get(move);
            if (!health || move === "Total") return null;

            return (
              <Tooltip
                withArrow
                multiline
                w={240}
                label={
                  <Stack gap={2}>
                    <Text size="xs" fw={700}>
                      ChessDB strength rank
                    </Text>
                    {health.pending ? (
                      <Text size="xs">Checking ChessDB for this position.</Text>
                    ) : health.source !== "chessdb" ? (
                      <Text size="xs">No ChessDB score was found for this position.</Text>
                    ) : health.chessDbScoreCp === null ? (
                      <Text size="xs">ChessDB lists this move but has no usable score yet.</Text>
                    ) : (
                      <>
                        <Text size="xs">
                          Rank #{health.chessDbScoreRank ?? "-"} by centipawn score for{" "}
                          {health.side}.
                        </Text>
                        <Text size="xs">
                          Score {formatChessDbScore(health.chessDbScoreCp)}
                          {health.cpLoss !== null
                            ? `, ${Math.round(health.cpLoss)} cp behind the best move`
                            : ""}
                        </Text>
                      </>
                    )}
                  </Stack>
                }
              >
                <Stack gap={0}>
                  <Text fz={compact ? "xs" : "sm"} fw={600}>
                    {formatChessDbRank(health)}
                  </Text>
                  {!compact && health.chessDbScoreCp !== null ? (
                    <Text fz="xs" c="dimmed">
                      {formatChessDbScore(health.chessDbScoreCp)}
                    </Text>
                  ) : null}
                </Stack>
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

function getSideWinRate(opening: Opening, side: OpeningMoveHealthSide) {
  const total = getOpeningTotal(opening);
  if (total <= 0) return 0;
  return (side === "white" ? opening.white : opening.black) / total;
}

function getSideScore(opening: Opening, side: OpeningMoveHealthSide) {
  const total = getOpeningTotal(opening);
  if (total <= 0) return 0;
  const wins = side === "white" ? opening.white : opening.black;
  return (wins + opening.draw * 0.5) / total;
}

function getChessDbStrengthSortScore(health?: OpeningMoveStrength) {
  if (!health) return Number.NEGATIVE_INFINITY;
  if (health.chessDbScoreCp !== null) return health.chessDbScoreCp;
  if (health.source === "chessdb") return Number.NEGATIVE_INFINITY;
  return health.score - 50;
}

function formatChessDbRank(health: OpeningMoveStrength) {
  if (health.pending) return "...";
  if (health.source !== "chessdb") return "-";
  if (health.chessDbScoreCp === null && health.chessDbRank !== null) return "Listed";
  const rank = health.chessDbScoreRank;
  return rank ? `#${rank}` : "Out";
}

function formatChessDbScore(score: number) {
  if (Math.abs(score) > 250_00) {
    const mate = Math.floor((300_00 - Math.abs(score) + 1) / 2);
    return `${score > 0 ? "+" : "-"}M${mate}`;
  }
  if (Math.abs(score) > 150_00) {
    return score > 0 ? "Win" : "Loss";
  }
  return `${score >= 0 ? "+" : ""}${(score / 100).toFixed(2)}`;
}

function healthStatusColor(status: OpeningMoveStrengthStatus) {
  switch (status) {
    case "weak":
      return "red";
    case "strong":
      return "green";
    case "ok":
      return "gray";
  }
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}
