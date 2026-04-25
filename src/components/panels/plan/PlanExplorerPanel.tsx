import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Group,
  NumberInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconRoute } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { Piece } from "@lichess-org/chessground/types";
import { commands, type PlanExplorerLine, type PlanExplorerPiece } from "@/bindings";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import PieceComponent from "@/components/common/Piece";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentLocalOptionsAtom,
  currentPlanExplorerDataAtom,
  currentPlanExplorerPreviewLineAtom,
  currentTabAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  planExplorerArrowLimitAtom,
  planExplorerHoverEverywhereAtom,
  planExplorerSourceAtom,
  referenceDbAtom,
  sessionsAtom,
  showPlanExplorerArrowsAtom,
} from "@/state/atoms";
import {
  cancelDatabaseSearch,
  getDatabases,
  getPlanExplorer,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { getOnlinePlanExplorer, type OnlinePlanExplorerSource } from "@/utils/lichess/planExplorer";
import {
  formatPlanRoute,
  isPlanBrush,
  planLineToShapes,
  withPlanLineColor,
  type ColoredPlanExplorerLine,
} from "@/utils/planExplorer";
import NoDatabaseWarning from "../database/NoDatabaseWarning";

type SideFilter = "all" | "white" | "black";
type PlanExplorerSource = "local" | OnlinePlanExplorerSource;

function PlanExplorerPanel() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const currentNode = useStore(store, (s) => s.currentNode());
  const setShapes = useStore(store, (s) => s.setShapes);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const [referenceDatabase, setReferenceDatabase] = useAtom(referenceDbAtom);
  const [showPlanExplorerArrows, setShowPlanExplorerArrows] = useAtom(showPlanExplorerArrowsAtom);
  const [arrowLimit, setArrowLimit] = useAtom(planExplorerArrowLimitAtom);
  const [hoverEverywhere, setHoverEverywhere] = useAtom(planExplorerHoverEverywhereAtom);
  const [source, setSource] = useAtom(planExplorerSourceAtom);
  const currentTab = useAtomValue(currentTabAtom);
  const localOptions = useAtomValue(currentLocalOptionsAtom);
  const lichessOptions = useAtomValue(lichessOptionsAtom);
  const masterOptions = useAtomValue(masterOptionsAtom);
  const sessions = useAtomValue(sessionsAtom);
  const setPlanExplorerData = useSetAtom(currentPlanExplorerDataAtom);
  const setPreviewLine = useSetAtom(currentPlanExplorerPreviewLineAtom);
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [maxPlies, setMaxPlies] = useState("8");
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const lichessOptionsKey = JSON.stringify(lichessOptions);
  const masterOptionsKey = JSON.stringify(masterOptions);
  const isLocalSource = source === "local";
  const missingExplorerToken = !isLocalSource && !explorerToken;

  const { data: databases } = useSWR("databases", () => getDatabases());
  const localDatabases = useMemo(
    () =>
      (databases ?? []).filter((database): database is SuccessDatabaseInfo => {
        return database.type === "success";
      }),
    [databases],
  );
  const dbSelectData = localDatabases.map((database) => ({
    value: database.file,
    label: database.title || database.filename,
  }));

  const requestId = useMemo(
    () =>
      [
        "plan-explorer",
        currentTab?.value ?? "tab",
        source,
        referenceDatabase ?? "none",
        debouncedFen,
        localOptions.type,
        localOptions.player ?? "",
        localOptions.color,
        localOptions.start_date ?? "",
        localOptions.end_date ?? "",
        localOptions.result,
        lichessOptionsKey,
        masterOptionsKey,
        explorerToken ? "auth" : "no-auth",
        maxPlies,
      ].join("|"),
    [
      currentTab?.value,
      debouncedFen,
      explorerToken,
      lichessOptionsKey,
      localOptions,
      masterOptionsKey,
      maxPlies,
      referenceDatabase,
      source,
    ],
  );

  const canSearch = isLocalSource ? !!referenceDatabase : !!explorerToken;
  const searchKey = canSearch
    ? [
        "plan-explorer",
        requestId,
        source,
        referenceDatabase ?? "",
        debouncedFen,
        localOptions.type,
        localOptions.player ?? "",
        localOptions.color,
        localOptions.start_date ?? "",
        localOptions.end_date ?? "",
        localOptions.result,
        lichessOptionsKey,
        masterOptionsKey,
        maxPlies,
      ]
    : null;

  const {
    data: planData,
    isLoading,
    error,
  } = useSWR(searchKey, async () => {
    if (source === "lch_all") {
      return getOnlinePlanExplorer(
        source,
        debouncedFen,
        lichessOptions,
        Number(maxPlies),
        explorerToken,
      );
    }

    if (source === "lch_master") {
      return getOnlinePlanExplorer(
        source,
        debouncedFen,
        masterOptions,
        Number(maxPlies),
        explorerToken,
      );
    }

    return getPlanExplorer(
      {
        ...localOptions,
        fen: debouncedFen,
        path: referenceDatabase,
      },
      Number(maxPlies),
      requestId,
    );
  });

  const visiblePlanData = useMemo(() => {
    if (!planData) return null;
    if (sideFilter === "all") return planData;
    return {
      ...planData,
      pieces: planData.pieces.filter((piece) => piece.color === sideFilter),
    };
  }, [planData, sideFilter]);

  useEffect(() => {
    setPlanExplorerData(null);
    setPreviewLine(null);
  }, [
    debouncedFen,
    lichessOptionsKey,
    masterOptionsKey,
    maxPlies,
    referenceDatabase,
    setPlanExplorerData,
    setPreviewLine,
    source,
  ]);

  useEffect(() => {
    if (!isLocalSource || !referenceDatabase) return undefined;

    return () => {
      setPreviewLine(null);
      void cancelDatabaseSearch(requestId);
    };
  }, [isLocalSource, referenceDatabase, requestId, setPreviewLine]);

  useEffect(() => {
    setPlanExplorerData(visiblePlanData);
    setPreviewLine(null);
  }, [setPlanExplorerData, setPreviewLine, visiblePlanData]);

  const drawLine = useCallback(
    (line: ColoredPlanExplorerLine) => {
      const existing = currentNode.shapes.filter((shape) => !isPlanBrush(shape.brush));
      setShapes([...existing, ...planLineToShapes(line)]);
    },
    [currentNode.shapes, setShapes],
  );

  const pieces = useMemo(() => {
    return visiblePlanData?.pieces ?? [];
  }, [visiblePlanData?.pieces]);

  const content = (() => {
    if (isLocalSource && !referenceDatabase) {
      return <NoDatabaseWarning />;
    }

    if (missingExplorerToken) {
      return (
        <Alert color="yellow">
          {t("Board.Database.ExplorerAuthRequired1")} <Link to="/accounts">Users</Link>{" "}
          {t("Board.Database.ExplorerAuthRequired2")}
        </Alert>
      );
    }

    return (
      <ScrollArea flex={1} offsetScrollbars>
        <Table withTableBorder highlightOnHover stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 150 }}>Piece</Table.Th>
              <Table.Th>Routes</Table.Th>
              <Table.Th style={{ width: 110 }}>Games</Table.Th>
              <Table.Th style={{ width: 150 }}>Results</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pieces.length === 0 && !isLoading ? (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text ta="center" c="dimmed" py="lg">
                    No piece routes found in the sampled continuations.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              pieces.map((piece) => (
                <PieceRow
                  key={`${piece.color}-${piece.role}-${piece.from}`}
                  piece={piece}
                  drawLine={drawLine}
                  previewLine={setPreviewLine}
                />
              ))
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    );
  })();

  return (
    <Stack h="100%" gap="xs" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap" miw={0}>
            <SegmentedControl
              size="sm"
              value={source}
              onChange={(value) => setSource(value as PlanExplorerSource)}
              data={[
                { label: t("Board.Database.Local"), value: "local" },
                { label: t("Board.Database.LichessAll"), value: "lch_all" },
                { label: t("Board.Database.LichessMaster"), value: "lch_master" },
              ]}
            />
            {isLocalSource && (
              <DatabaseSelector
                data={dbSelectData}
                value={referenceDatabase}
                onChange={setReferenceDatabase}
              />
            )}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <AutoArrowControls
              checked={showPlanExplorerArrows}
              onChange={setShowPlanExplorerArrows}
              arrowLimit={arrowLimit}
              setArrowLimit={setArrowLimit}
              hoverEverywhere={hoverEverywhere}
              setHoverEverywhere={setHoverEverywhere}
            />
            <Text size="sm" style={{ whiteSpace: "nowrap" }}>
              {formatNumber(planData?.total_games ?? 0)} matches
            </Text>
            {!!planData && planData.sampled_games < planData.total_games && (
              <Badge variant="light">{formatNumber(planData.sampled_games)} sampled</Badge>
            )}
          </Group>
        </Group>

        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            size="sm"
            value={maxPlies}
            onChange={setMaxPlies}
            data={[
              { label: "8 ply", value: "8" },
              { label: "12 ply", value: "12" },
              { label: "16 ply", value: "16" },
            ]}
          />
          <SegmentedControl
            size="sm"
            value={sideFilter}
            onChange={(value) => setSideFilter(value as SideFilter)}
            data={[
              { label: "All", value: "all" },
              { label: "White", value: "white" },
              { label: "Black", value: "black" },
            ]}
          />
        </Group>
      </Stack>

      <Progress value={isLoading ? 100 : 0} animated={isLoading} size="xs" />

      {error && (
        <Alert color="red" variant="light">
          {String(error)}
        </Alert>
      )}

      {content}
    </Stack>
  );
}

function AutoArrowControls({
  checked,
  onChange,
  arrowLimit,
  setArrowLimit,
  hoverEverywhere,
  setHoverEverywhere,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  arrowLimit: number;
  setArrowLimit: (value: number) => void;
  hoverEverywhere: boolean;
  setHoverEverywhere: (value: boolean) => void;
}) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Switch
        label="Auto arrows"
        size="sm"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        styles={{
          label: { whiteSpace: "nowrap" },
          track: { cursor: "pointer" },
        }}
      />
      <NumberInput
        aria-label="Auto arrow limit"
        value={arrowLimit}
        onChange={(value) => setArrowLimit(Math.max(1, Number(value) || 1))}
        min={1}
        max={64}
        clampBehavior="strict"
        size="xs"
        w={72}
        disabled={!checked}
      />
      <Switch
        label="Board hover"
        size="sm"
        checked={hoverEverywhere}
        onChange={(event) => setHoverEverywhere(event.currentTarget.checked)}
        styles={{
          label: { whiteSpace: "nowrap" },
          track: { cursor: "pointer" },
        }}
      />
    </Group>
  );
}

function DatabaseSelector({
  data,
  value,
  onChange,
}: {
  data: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selectedLabel = data.find((item) => item.value === value)?.label ?? "Reference database";
  const widthCh = Math.min(Math.max(selectedLabel.length + 4, 18), 34);

  return (
    <Select
      data={data}
      value={value}
      onChange={async (next) => {
        await commands.clearGames();
        onChange(next);
      }}
      placeholder="Reference database"
      size="sm"
      w={`${widthCh}ch`}
      miw={180}
      maw="100%"
      searchable
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

function PieceRow({
  piece,
  drawLine,
  previewLine,
}: {
  piece: PlanExplorerPiece;
  drawLine: (line: ColoredPlanExplorerLine) => void;
  previewLine: (line: ColoredPlanExplorerLine | null) => void;
}) {
  const topLine = piece.lines[0] ? withPlanLineColor(piece.lines[0], piece.color) : null;

  return (
    <Table.Tr
      onMouseEnter={() => topLine && previewLine(topLine)}
      onMouseLeave={() => previewLine(null)}
      onClick={() => topLine && drawLine(topLine)}
      style={{ cursor: topLine ? "pointer" : "default" }}
    >
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <Box w={24} h={24}>
            <PieceComponent piece={toChessgroundPiece(piece)} size={24} />
          </Box>
          <Box>
            <Text size="sm" fw={700}>
              {capitalize(piece.role)}
            </Text>
            <Text size="xs" c="dimmed">
              {piece.from}
            </Text>
          </Box>
        </Group>
      </Table.Td>
      <Table.Td>
        <Stack gap={4}>
          {piece.lines.slice(0, 4).map((rawLine) => {
            const line = withPlanLineColor(rawLine, piece.color);
            return (
              <Group
                key={line.squares.join("-")}
                gap="xs"
                wrap="nowrap"
                onMouseEnter={() => previewLine(line)}
                onMouseLeave={() => topLine && previewLine(topLine)}
              >
                <Tooltip label="Draw route">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={(event) => {
                      event.stopPropagation();
                      drawLine(line);
                    }}
                  >
                    <IconRoute size="1rem" />
                  </ActionIcon>
                </Tooltip>
                <Text size="sm" ff="monospace" truncate>
                  {formatPlanRoute(line.squares)}
                </Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {formatNumber(line.games)}
                </Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {piece.total > 0 ? `${((line.games / piece.total) * 100).toFixed(0)}%` : "0%"}
                </Text>
              </Group>
            );
          })}
        </Stack>
      </Table.Td>
      <Table.Td>
        <Badge variant="light">{formatNumber(piece.total)}</Badge>
      </Table.Td>
      <Table.Td>{topLine && <ResultBar line={topLine} />}</Table.Td>
    </Table.Tr>
  );
}

function ResultBar({ line }: { line: PlanExplorerLine }) {
  const total = line.white + line.draw + line.black;
  if (total === 0) {
    return (
      <Text size="sm" c="dimmed">
        -
      </Text>
    );
  }

  return (
    <Progress.Root size="sm">
      <Progress.Section value={(line.white / total) * 100} color="gray.3" />
      <Progress.Section value={(line.draw / total) * 100} color="gray" />
      <Progress.Section value={(line.black / total) * 100} color="dark" />
    </Progress.Root>
  );
}

function toChessgroundPiece(piece: PlanExplorerPiece): Piece {
  return {
    color: piece.color as Piece["color"],
    role: piece.role as Piece["role"],
  };
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default memo(PlanExplorerPanel);
