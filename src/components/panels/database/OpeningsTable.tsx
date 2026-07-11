import { Badge, Group, Progress, Stack, Text, Tooltip } from "@mantine/core";
import { isNormal, makeSquare } from "chessops";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { DataTable, type DataTableSortStatus } from "mantine-datatable";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentBoardPreviewShapesAtom,
  moveNotationTypeAtom,
  moveStrengthSettingsAtom,
} from "@/state/atoms";
import { addPieceSymbol } from "@/utils/annotation";
import { positionFromFen } from "@/utils/chessops";
import type { DatabaseResultPerspective, Opening } from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { queryLichessCloudMoves } from "@/utils/lichess/api";
import {
  getOpeningMoveStrengthMap,
  resolveOpeningMoveHealthSide,
  type OpeningMoveCloudData,
  type OpeningMoveCloudSource,
  type OpeningMoveStrength,
  type OpeningMoveHealthSide,
  type OpeningMoveHealthSidePreference,
} from "@/utils/openingMoveHealth";
import classes from "./OpeningsTable.module.css";

export type OpeningSort =
  | "games"
  | "gamesLow"
  | "recent"
  | "oldest"
  | "health"
  | "blendedStrength"
  | "blendedWeakness"
  | "chessDbStrength"
  | "chessDbWeakness"
  | "winRateHigh"
  | "winRateLow"
  | "scoreHigh"
  | "scoreLow"
  | "whiteRate"
  | "blackRate"
  | "drawRate"
  | "move"
  | "moveDesc";

type OpeningSortColumn = "move" | "blendStrength" | "strengthRank" | "total" | "results";
export type OpeningTableDensity = "regular" | "compact" | "dense";
const ENGINE_EVAL_MULTIPV = 10;

export const openingSortOptions: { label: string; value: OpeningSort }[] = [
  { label: "Most played", value: "games" },
  { label: "Fewest played", value: "gamesLow" },
  { label: "Most recent", value: "recent" },
  { label: "Oldest played", value: "oldest" },
  { label: "Blended strength", value: "blendedStrength" },
  { label: "Blended weakness", value: "blendedWeakness" },
  { label: "Engine CP strength", value: "chessDbStrength" },
  { label: "Engine CP weakness", value: "chessDbWeakness" },
  { label: "Highest win rate", value: "winRateHigh" },
  { label: "Lowest win rate", value: "winRateLow" },
  { label: "Highest score", value: "scoreHigh" },
  { label: "Lowest score", value: "scoreLow" },
  { label: "White win rate", value: "whiteRate" },
  { label: "Black win rate", value: "blackRate" },
  { label: "Draw rate", value: "drawRate" },
  { label: "Move", value: "move" },
  { label: "Move descending", value: "moveDesc" },
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
    if (sortBy === "move" || sortBy === "moveDesc") {
      const diff = a.move.localeCompare(b.move);
      return sortBy === "move" ? diff : -diff;
    }

    const aTotal = getOpeningTotal(a);
    const bTotal = getOpeningTotal(b);

    if (sortBy === "games") {
      return bTotal - aTotal;
    }

    if (sortBy === "gamesLow") {
      return aTotal - bTotal;
    }

    if (sortBy === "recent" || sortBy === "oldest") {
      return compareOpeningDate(a, b, sortBy) || bTotal - aTotal;
    }

    if (sortBy === "blendedStrength") {
      const aStrength = getBlendedStrengthSortScore(healthByMove?.get(a.move));
      const bStrength = getBlendedStrengthSortScore(healthByMove?.get(b.move));
      return bStrength - aStrength || bTotal - aTotal;
    }

    if (sortBy === "blendedWeakness") {
      const aStrength = getBlendedStrengthSortScore(healthByMove?.get(a.move));
      const bStrength = getBlendedStrengthSortScore(healthByMove?.get(b.move));
      return aStrength - bStrength || bTotal - aTotal;
    }

    if (sortBy === "health" || sortBy === "chessDbStrength") {
      const aStrength = getEngineStrengthSortScore(healthByMove?.get(a.move));
      const bStrength = getEngineStrengthSortScore(healthByMove?.get(b.move));
      return bStrength - aStrength || bTotal - aTotal;
    }

    if (sortBy === "chessDbWeakness") {
      const aStrength = getEngineStrengthSortScore(healthByMove?.get(a.move));
      const bStrength = getEngineStrengthSortScore(healthByMove?.get(b.move));
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

export function isPlayableOpeningRow(opening: Opening) {
  return opening.move !== "Total" && opening.move !== "*" && getOpeningTotal(opening) > 0;
}

function OpeningsTable({
  openings,
  loading,
  sortBy = "games",
  onSortChange,
  compact = false,
  density,
  healthSidePreference = "sideToMove",
  resultPerspective = null,
  referenceOpenings,
}: {
  openings: Opening[];
  loading: boolean;
  sortBy?: OpeningSort;
  onSortChange?: (sortBy: OpeningSort) => void;
  compact?: boolean;
  density?: OpeningTableDensity;
  healthSidePreference?: OpeningMoveHealthSidePreference;
  resultPerspective?: DatabaseResultPerspective | null;
  referenceOpenings?: Opening[];
}) {
  const store = useContext(TreeStateContext)!;
  const makeMove = useStore(store, (s) => s.makeMove);
  const currentFen = useStore(store, (s) => s.currentNode().fen);
  const [moveNotationType] = useAtom(moveNotationTypeAtom);
  const moveStrengthSettings = useAtomValue(moveStrengthSettingsAtom);
  const setBoardPreviewShapes = useSetAtom(currentBoardPreviewShapesAtom);
  const [cloudData, setCloudData] = useState<OpeningMoveCloudData | null | undefined>();
  const [internalSortBy, setInternalSortBy] = useState(sortBy);
  const lastHeaderSortRef = useRef<OpeningSort | null>(null);
  const effectiveSortBy = onSortChange ? sortBy : internalSortBy;
  const [sortStatus, setSortStatus] = useState<DataTableSortStatus<Opening>>(() =>
    openingSortToStatus(effectiveSortBy),
  );
  const tableDensity = density ?? (compact ? "compact" : "regular");
  const isCompact = tableDensity !== "regular";
  const isDense = tableDensity === "dense";
  const textSize = isDense ? "0.68rem" : isCompact ? "xs" : "sm";
  const columnWidths = {
    move: isDense ? 52 : isCompact ? 64 : 100,
    blendStrength: isDense ? 54 : isCompact ? 68 : 104,
    strengthRank: isDense ? 48 : isCompact ? 68 : 112,
    total: isDense ? 64 : isCompact ? 90 : 180,
    results: isDense ? 88 : isCompact ? 104 : undefined,
  };
  const resultClassName = [classes.result, isDense ? classes.denseResult : null]
    .filter(Boolean)
    .join(" ");

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
  const resultSortSide = resultPerspective ?? healthSide;
  const playableOpenings = useMemo(() => openings.filter(isPlayableOpeningRow), [openings]);
  const cloudMultipv = useMemo(() => getOpeningEvalMultipv(playableOpenings), [playableOpenings]);
  const cloudMoveListKey = useMemo(
    () => playableOpenings.map((opening) => normalizeOpeningCloudSan(opening.move)).join("|"),
    [playableOpenings],
  );

  const healthByMove = useMemo(
    () =>
      getOpeningMoveStrengthMap({
        openings: playableOpenings,
        side: healthSide,
        fen: currentFen,
        cloudData,
        referenceOpenings,
        strengthSettings: moveStrengthSettings,
      }),
    [cloudData, currentFen, healthSide, moveStrengthSettings, playableOpenings, referenceOpenings],
  );

  const updateSort = useCallback(
    (status: DataTableSortStatus<Opening>) => {
      const nextSort = statusToOpeningSort(status);
      lastHeaderSortRef.current = nextSort;
      setSortStatus(status);
      if (onSortChange) {
        onSortChange(nextSort);
      } else {
        setInternalSortBy(nextSort);
      }
    },
    [onSortChange],
  );

  useEffect(() => {
    if (lastHeaderSortRef.current === effectiveSortBy) {
      lastHeaderSortRef.current = null;
      return;
    }

    setSortStatus(openingSortToStatus(effectiveSortBy));
  }, [effectiveSortBy]);

  const sortedOpenings = sortOpeningRows(
    playableOpenings,
    effectiveSortBy,
    healthByMove,
    resultSortSide,
  );

  useEffect(() => {
    let cancelled = false;
    setCloudData(undefined);
    void queryOpeningCloudData(
      currentFen,
      cloudMultipv,
      playableOpenings.map((opening) => opening.move),
    )
      .then((data) => {
        if (!cancelled) {
          setCloudData(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCloudData(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cloudMoveListKey, cloudMultipv, currentFen, playableOpenings]);

  const whiteTotal = sortedOpenings.reduce((acc, curr) => acc + curr.white, 0);
  const blackTotal = sortedOpenings.reduce((acc, curr) => acc + curr.black, 0);
  const drawTotal = sortedOpenings.reduce((acc, curr) => acc + curr.draw, 0);
  const grandTotal = whiteTotal + blackTotal + drawTotal;
  const tableOpenings =
    sortedOpenings.length > 0
      ? [
          ...sortedOpenings,
          {
            move: "Total",
            white: whiteTotal,
            black: blackTotal,
            draw: drawTotal,
          },
        ]
      : sortedOpenings;

  return (
    <DataTable
      withTableBorder
      highlightOnHover
      records={tableOpenings}
      fetching={loading}
      className={isDense ? classes.denseTable : undefined}
      horizontalSpacing={isDense ? 4 : isCompact ? 6 : "xs"}
      verticalSpacing={isDense ? 3 : isCompact ? 4 : "xs"}
      rowStyle={(game, i) => {
        if (i === tableOpenings.length - 1)
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
          title: "Move",
          width: columnWidths.move,
          ellipsis: true,
          sortable: true,
          render: ({ move }) => {
            return (
              <Text fz={textSize} lh={1.2} truncate>
                {moveNotationType === "symbols" ? addPieceSymbol(move) : move}
              </Text>
            );
          },
        },
        {
          accessor: "blendStrength",
          title: isDense ? "Mix" : isCompact ? "Blend" : "Blended strength",
          width: columnWidths.blendStrength,
          ellipsis: true,
          sortable: true,
          render: ({ move }) => {
            const health = healthByMove.get(move);
            if (!health || move === "Total") return null;

            return (
              <Tooltip
                withArrow
                multiline
                w={290}
                label={
                  <Stack gap={2}>
                    <Text size="xs" fw={700}>
                      Blended strength {health.blendedStrengthScore}
                    </Text>
                    <Text size="xs">
                      {formatMoveStrengthMode(moveStrengthSettings.mode)} mode,{" "}
                      {moveStrengthSettings.engineWeight}% engine blend, max{" "}
                      {moveStrengthSettings.maxEngineCpLoss} cp drop.
                    </Text>
                    {health.cpLoss !== null ? (
                      <Text size="xs">{Math.round(health.cpLoss)} cp behind the engine best.</Text>
                    ) : health.pending ? (
                      <Text size="xs">Checking cloud analysis for the engine side.</Text>
                    ) : (
                      <Text size="xs">No usable cloud CP score for this move.</Text>
                    )}
                    {health.databaseStrengthScore !== null ? (
                      <Text size="xs">
                        Practical WDL {formatPercent(health.databaseStrengthScore)}
                        {health.databaseWdlLoss !== null && health.databaseWdlLoss > 0
                          ? `, ${formatWdlPointLoss(health.databaseWdlLoss)} pts behind the best shown move`
                          : ", best shown move"}
                      </Text>
                    ) : null}
                    {health.engineUnsafeForBlend ? (
                      <Text size="xs">Over the configured CP-drop limit.</Text>
                    ) : null}
                  </Stack>
                }
              >
                <Stack gap={2}>
                  <Badge
                    color={health.engineUnsafeForBlend ? "yellow" : "teal"}
                    variant="light"
                    size={isCompact ? "xs" : "sm"}
                    className={`${classes.healthBadge} ${isDense ? classes.denseHealthBadge : ""}`}
                  >
                    {health.blendedStrengthLabel}
                  </Badge>
                  {!isDense ? (
                    <Progress
                      value={health.blendedStrengthScore}
                      color={health.engineUnsafeForBlend ? "yellow" : "teal"}
                      size={3}
                    />
                  ) : null}
                </Stack>
              </Tooltip>
            );
          },
        },
        {
          accessor: "strengthRank",
          title: isDense ? "Eval" : isCompact ? "Engine" : "Engine eval",
          width: columnWidths.strengthRank,
          ellipsis: true,
          sortable: true,
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
                      {health.source !== "local"
                        ? `${cloudSourceLabel(health.source)} engine eval`
                        : "Cloud engine eval"}
                    </Text>
                    {health.pending ? (
                      <Text size="xs">Checking cloud analysis for this position.</Text>
                    ) : health.source === "local" ? (
                      <Text size="xs">No cloud score was found for this position.</Text>
                    ) : health.engineScoreCp === null ? (
                      <Text size="xs">
                        {cloudSourceLabel(health.source)} lists this move but has no usable score
                        yet.
                      </Text>
                    ) : (
                      <>
                        <Text size="xs">
                          Score {formatCloudScore(health.engineScoreCp)} for {health.side}.
                        </Text>
                        <Text size="xs">
                          {health.cpLoss !== null
                            ? `${Math.round(health.cpLoss)} cp behind the best move`
                            : "Best available cloud score for this side"}
                        </Text>
                      </>
                    )}
                  </Stack>
                }
              >
                <Stack gap={0}>
                  <Text fz={textSize} fw={600} lh={1.2}>
                    {formatCloudEval(health)}
                  </Text>
                  {!isCompact && health.cpLoss !== null ? (
                    <Text fz="xs" c="dimmed">
                      {Math.round(health.cpLoss)} cp off
                    </Text>
                  ) : null}
                </Stack>
              </Tooltip>
            );
          },
        },
        {
          accessor: "total",
          title: "Games",
          width: columnWidths.total,
          ellipsis: true,
          sortable: true,
          render: ({ move, white, draw, black }) => {
            const total = white + draw + black;
            const percentage = (total / grandTotal) * 100;
            return (
              <Group gap={isDense ? 3 : isCompact ? 6 : "md"} wrap="nowrap">
                {move !== "Total" && (
                  <Text fz={textSize} lh={1.2}>
                    {percentage.toFixed(0)}%
                  </Text>
                )}
                <Text fz={textSize} flex={1} ta="right" lh={1.2}>
                  {formatNumber(total)}
                </Text>
              </Group>
            );
          },
        },
        {
          accessor: "results",
          title: resultPerspective ? "W/D/L" : isDense ? "W/D/B" : "White / draw / black",
          width: columnWidths.results,
          ellipsis: true,
          sortable: true,
          render: ({ black, white, draw }) => {
            const total = white + draw + black;
            const resultStats = getDisplayResultStats({ white, draw, black }, resultPerspective);
            const firstPercent = total > 0 ? (resultStats.first / total) * 100 : 0;
            const drawPercent = total > 0 ? (draw / total) * 100 : 0;
            const thirdPercent = total > 0 ? (resultStats.third / total) * 100 : 0;
            const showLabelThreshold = isDense ? 18 : 10;
            return (
              <Progress.Root size={isCompact ? "lg" : "xl"} className={resultClassName}>
                <Progress.Section value={firstPercent} className={classes.whiteResultsSection}>
                  <Progress.Label c="black">
                    {firstPercent > showLabelThreshold ? `${firstPercent.toFixed(1)}%` : ""}
                  </Progress.Label>
                </Progress.Section>
                <Progress.Section value={drawPercent} color="gray">
                  <Progress.Label>
                    {drawPercent > showLabelThreshold ? `${drawPercent.toFixed(1)}%` : ""}
                  </Progress.Label>
                </Progress.Section>
                <Progress.Section value={thirdPercent} color="black">
                  <Progress.Label>
                    {thirdPercent > showLabelThreshold ? `${thirdPercent.toFixed(1)}%` : ""}
                  </Progress.Label>
                </Progress.Section>
              </Progress.Root>
            );
          },
        },
      ]}
      idAccessor="move"
      sortStatus={sortStatus}
      onSortStatusChange={updateSort}
      emptyState={"No continuations found"}
      onRowClick={({ record }) => {
        if (record.move !== "Total") {
          makeMove({ payload: record.move });
        }
      }}
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

function compareOpeningDate(a: Opening, b: Opening, sortBy: "recent" | "oldest") {
  const aDate = getOpeningDateSortValue(a);
  const bDate = getOpeningDateSortValue(b);
  if (aDate === 0 && bDate === 0) return 0;
  if (aDate === 0) return 1;
  if (bDate === 0) return -1;

  return sortBy === "recent" ? bDate - aDate : aDate - bDate;
}

function getOpeningDateSortValue(opening: Opening) {
  const digits = opening.lastPlayed?.replace(/\D/g, "");
  if (!digits) return 0;
  return Number(digits.padEnd(8, "0"));
}

function getDisplayResultStats(
  opening: Pick<Opening, "white" | "draw" | "black">,
  perspective: DatabaseResultPerspective | null,
) {
  if (!perspective) {
    return {
      first: opening.white,
      third: opening.black,
    };
  }

  return {
    first: perspective === "white" ? opening.white : opening.black,
    third: perspective === "white" ? opening.black : opening.white,
  };
}

function openingSortToStatus(sortBy: OpeningSort): DataTableSortStatus<Opening> {
  if (sortBy === "move" || sortBy === "moveDesc") {
    return {
      columnAccessor: "move",
      direction: sortBy === "move" ? "asc" : "desc",
    };
  }

  if (sortBy === "games" || sortBy === "gamesLow") {
    return {
      columnAccessor: "total",
      direction: sortBy === "games" ? "desc" : "asc",
    };
  }

  if (sortBy === "recent" || sortBy === "oldest") {
    return {
      columnAccessor: "total",
      direction: sortBy === "recent" ? "desc" : "asc",
    };
  }

  if (sortBy === "chessDbWeakness") {
    return {
      columnAccessor: "health",
      direction: "asc",
    };
  }

  if (sortBy === "blendedWeakness") {
    return {
      columnAccessor: "blendStrength",
      direction: "asc",
    };
  }

  if (sortBy === "winRateLow" || sortBy === "scoreLow") {
    return {
      columnAccessor: "results",
      direction: "asc",
    };
  }

  if (sortBy === "whiteRate" || sortBy === "blackRate" || sortBy === "drawRate") {
    return {
      columnAccessor: "results",
      direction: "desc",
    };
  }

  if (sortBy === "chessDbStrength" || sortBy === "health") {
    return {
      columnAccessor: "health",
      direction: "desc",
    };
  }

  if (sortBy === "blendedStrength") {
    return {
      columnAccessor: "blendStrength",
      direction: "desc",
    };
  }

  return {
    columnAccessor: "results",
    direction: "desc",
  };
}

function statusToOpeningSort(status: DataTableSortStatus<Opening>): OpeningSort {
  const column = status.columnAccessor as OpeningSortColumn;
  const descending = status.direction === "desc";

  switch (column) {
    case "move":
      return descending ? "moveDesc" : "move";
    case "blendStrength":
      return descending ? "blendedStrength" : "blendedWeakness";
    case "strengthRank":
      return descending ? "chessDbStrength" : "chessDbWeakness";
    case "total":
      return descending ? "games" : "gamesLow";
    case "results":
      return descending ? "winRateHigh" : "winRateLow";
  }
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

async function queryOpeningCloudData(
  fen: string,
  multipv: number,
  visibleMoves: string[],
): Promise<OpeningMoveCloudData | null> {
  const lichessMoves = await queryLichessCloudMoves(fen, multipv).catch(() => null);
  const lichessCloudMoves =
    lichessMoves?.map((move, index) => ({
      san: move.san,
      scoreCpForWhite: move.scoreCpForWhite,
      rank: index + 1,
      winrate: null,
    })) ?? [];
  const coveredSans = new Set(lichessCloudMoves.map((move) => normalizeOpeningCloudSan(move.san)));
  const missingMoves = visibleMoves.filter(
    (move) => !coveredSans.has(normalizeOpeningCloudSan(move)),
  );
  const childEvaluations = await Promise.all(
    missingMoves.map((move) => queryOpeningChildEvaluation(fen, move)),
  );
  for (const evaluation of childEvaluations) {
    if (evaluation) lichessCloudMoves.push(evaluation);
  }

  const [position] = positionFromFen(fen);
  const sideToMove = position?.turn ?? "white";
  lichessCloudMoves.sort((a, b) =>
    sideToMove === "white"
      ? (b.scoreCpForWhite ?? Number.NEGATIVE_INFINITY) -
        (a.scoreCpForWhite ?? Number.NEGATIVE_INFINITY)
      : (a.scoreCpForWhite ?? Number.POSITIVE_INFINITY) -
        (b.scoreCpForWhite ?? Number.POSITIVE_INFINITY),
  );
  lichessCloudMoves.forEach((move, index) => {
    move.rank = index + 1;
  });
  if (lichessCloudMoves.length && hasOpeningCloudCoverage(lichessCloudMoves, visibleMoves)) {
    return { source: "lichess", moves: lichessCloudMoves };
  }

  return lichessCloudMoves.length ? { source: "lichess", moves: lichessCloudMoves } : null;
}

async function queryOpeningChildEvaluation(fen: string, san: string) {
  const [position] = positionFromFen(fen);
  if (!position) return null;
  const move = parseSan(position, san);
  if (!move || !isNormal(move)) return null;
  position.play(move);

  const childMoves = await queryLichessCloudMoves(makeFen(position.toSetup()), 1).catch(() => null);
  const childBest = childMoves?.[0];
  if (!childBest) return null;

  return {
    san,
    scoreCpForWhite: childBest.scoreCpForWhite,
    rank: 0,
    winrate: null,
  };
}

function hasOpeningCloudCoverage(
  cloudMoves: { san: string; scoreCpForWhite: number | null }[],
  visibleMoves: string[],
) {
  if (visibleMoves.length === 0) return true;
  const cloudSans = new Set(cloudMoves.map((move) => normalizeOpeningCloudSan(move.san)));
  return visibleMoves.every((move) => cloudSans.has(normalizeOpeningCloudSan(move)));
}

function normalizeOpeningCloudSan(value: string) {
  return value
    .trim()
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O")
    .replace(/[+#?!]+$/g, "");
}

function getOpeningEvalMultipv(openings: Opening[]) {
  const playableCount = openings.filter(
    (opening) => opening.move !== "Total" && opening.move !== "*" && getOpeningTotal(opening) > 0,
  ).length;
  return Math.max(1, Math.min(ENGINE_EVAL_MULTIPV, playableCount));
}

function getEngineStrengthSortScore(health?: OpeningMoveStrength) {
  if (!health) return Number.NEGATIVE_INFINITY;
  if (health.engineScoreCp !== null) return health.engineScoreCp;
  if (health.source !== "local") return Number.NEGATIVE_INFINITY;
  return health.score - 50;
}

function getBlendedStrengthSortScore(health?: OpeningMoveStrength) {
  return health?.blendedStrengthScore ?? Number.NEGATIVE_INFINITY;
}

function formatCloudEval(health: OpeningMoveStrength) {
  if (health.pending) return "...";
  if (health.source === "local") return "-";
  if (health.engineScoreCp !== null) return formatCloudScore(health.engineScoreCp);
  if (health.engineRank !== null) return "No eval";
  return "Out";
}

function formatCloudScore(score: number) {
  if (Math.abs(score) > 250_00) {
    const mate = Math.floor((300_00 - Math.abs(score) + 1) / 2);
    return `${score > 0 ? "+" : "-"}M${mate}`;
  }
  if (Math.abs(score) > 150_00) {
    return score > 0 ? "Win" : "Loss";
  }
  return `${score >= 0 ? "+" : ""}${(score / 100).toFixed(2)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function formatWdlPointLoss(value: number) {
  return (value * 100).toFixed(value >= 0.1 ? 0 : 1).replace(/\.0$/, "");
}

function formatMoveStrengthMode(mode: "smart" | "engine" | "practical") {
  switch (mode) {
    case "engine":
      return "Engine";
    case "practical":
      return "Practical";
    case "smart":
      return "Smart";
  }
}

function cloudSourceLabel(source: OpeningMoveCloudSource) {
  return source === "lichess" ? "Local eval" : "External eval";
}
