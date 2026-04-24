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
import type { Piece } from "@lichess-org/chessground/types";
import { commands, type PlanExplorerLine, type PlanExplorerPiece } from "@/bindings";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import PieceComponent from "@/components/common/Piece";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentLocalOptionsAtom,
  currentPlanExplorerDataAtom,
  currentPlanExplorerPreviewLineAtom,
  currentTabAtom,
  planExplorerArrowLimitAtom,
  referenceDbAtom,
  showPlanExplorerArrowsAtom,
} from "@/state/atoms";
import {
  cancelDatabaseSearch,
  getDatabases,
  getPlanExplorer,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { formatPlanRoute, PLAN_BRUSH, planLineToShapes } from "@/utils/planExplorer";
import NoDatabaseWarning from "../database/NoDatabaseWarning";

type SideFilter = "all" | "white" | "black";

function PlanExplorerPanel() {
  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const currentNode = useStore(store, (s) => s.currentNode());
  const setShapes = useStore(store, (s) => s.setShapes);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const [referenceDatabase, setReferenceDatabase] = useAtom(referenceDbAtom);
  const [showPlanExplorerArrows, setShowPlanExplorerArrows] = useAtom(
    showPlanExplorerArrowsAtom,
  );
  const [arrowLimit, setArrowLimit] = useAtom(planExplorerArrowLimitAtom);
  const currentTab = useAtomValue(currentTabAtom);
  const localOptions = useAtomValue(currentLocalOptionsAtom);
  const setPlanExplorerData = useSetAtom(currentPlanExplorerDataAtom);
  const setPreviewLine = useSetAtom(currentPlanExplorerPreviewLineAtom);
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [maxPlies, setMaxPlies] = useState("8");

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
        referenceDatabase ?? "none",
        debouncedFen,
        localOptions.type,
        localOptions.player ?? "",
        localOptions.color,
        localOptions.start_date ?? "",
        localOptions.end_date ?? "",
        localOptions.result,
        maxPlies,
      ].join("|"),
    [currentTab?.value, debouncedFen, localOptions, maxPlies, referenceDatabase],
  );

  const searchKey = referenceDatabase
    ? [
        "plan-explorer",
        requestId,
        referenceDatabase,
        debouncedFen,
        localOptions.type,
        localOptions.player ?? "",
        localOptions.color,
        localOptions.start_date ?? "",
        localOptions.end_date ?? "",
        localOptions.result,
        maxPlies,
      ]
    : null;

  const {
    data: planData,
    isLoading,
    error,
  } = useSWR(searchKey, async () => {
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

  useEffect(() => {
    setPlanExplorerData(null);
    setPreviewLine(null);
  }, [debouncedFen, maxPlies, referenceDatabase, setPlanExplorerData, setPreviewLine]);

  useEffect(() => {
    if (!referenceDatabase) return undefined;

    return () => {
      setPreviewLine(null);
      void cancelDatabaseSearch(requestId);
    };
  }, [referenceDatabase, requestId, setPreviewLine]);

  useEffect(() => {
    if (planData) {
      setPlanExplorerData(planData);
    }
  }, [planData, setPlanExplorerData]);

  const drawLine = useCallback(
    (line: PlanExplorerLine) => {
      const existing = currentNode.shapes.filter((shape) => shape.brush !== PLAN_BRUSH);
      setShapes([...existing, ...planLineToShapes(line)]);
    },
    [currentNode.shapes, setShapes],
  );

  const pieces = useMemo(() => {
    const source = planData?.pieces ?? [];
    if (sideFilter === "all") return source;
    return source.filter((piece) => piece.color === sideFilter);
  }, [planData?.pieces, sideFilter]);

  if (!referenceDatabase) {
    return (
      <Stack h="100%" gap="xs" p="sm">
        <Group justify="space-between" align="center" wrap="nowrap">
          <DatabaseSelector
            data={dbSelectData}
            value={referenceDatabase}
            onChange={setReferenceDatabase}
          />
          <AutoArrowControls
            checked={showPlanExplorerArrows}
            onChange={setShowPlanExplorerArrows}
            arrowLimit={arrowLimit}
            setArrowLimit={setArrowLimit}
          />
        </Group>
        <NoDatabaseWarning />
      </Stack>
    );
  }

  return (
    <Stack h="100%" gap="xs" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="center" wrap="nowrap">
          <DatabaseSelector
            data={dbSelectData}
            value={referenceDatabase}
            onChange={setReferenceDatabase}
          />
          <Group gap="xs" wrap="nowrap">
            <AutoArrowControls
              checked={showPlanExplorerArrows}
              onChange={setShowPlanExplorerArrows}
              arrowLimit={arrowLimit}
              setArrowLimit={setArrowLimit}
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
    </Stack>
  );
}

function AutoArrowControls({
  checked,
  onChange,
  arrowLimit,
  setArrowLimit,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  arrowLimit: number;
  setArrowLimit: (value: number) => void;
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
      flex={1}
      miw={360}
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
  drawLine: (line: PlanExplorerLine) => void;
  previewLine: (line: PlanExplorerLine | null) => void;
}) {
  const topLine = piece.lines[0];

  return (
    <Table.Tr
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
          {piece.lines.slice(0, 4).map((line) => (
            <Group
              key={line.squares.join("-")}
              gap="xs"
              wrap="nowrap"
              onMouseEnter={() => previewLine(line)}
              onMouseLeave={() => previewLine(null)}
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
          ))}
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
