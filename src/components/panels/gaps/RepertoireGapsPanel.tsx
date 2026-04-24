import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBrain,
  IconDeviceFloppy,
  IconPlayerPlay,
  IconPlayerStop,
  IconSearch,
  IconTargetArrow,
} from "@tabler/icons-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useAtomValue } from "jotai";
import { memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import {
  commands,
  type RepertoireGap,
  type RepertoireGapReport,
  type ScoreValue,
} from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { enginesAtom, referenceDbAtom } from "@/state/atoms";
import { getDatabases, query_players, type SuccessDatabaseInfo } from "@/utils/db";
import { formatNumber } from "@/utils/format";
import type { LocalEngine } from "@/utils/engines";
import { unwrap } from "@/utils/unwrap";

type VerificationStatus = "engine-approved" | "likely-mistake" | "unclear";

type VerificationResult = {
  status: VerificationStatus;
  lossCp: number | null;
  bestMoveSan: string | null;
  depth: number | null;
};

function RepertoireGapsPanel() {
  const store = useContext(TreeStateContext)!;
  const rootFen = useStore(store, (s) => s.root.fen);
  const currentNode = useStore(store, (s) => s.currentNode());
  const storedReferenceDb = useAtomValue(referenceDbAtom);
  const engines = useAtomValue(enginesAtom);

  const localEngines = useMemo(
    () => (engines ?? []).filter((engine): engine is LocalEngine => engine.type === "local"),
    [engines],
  );

  const { data: databases } = useSWR("databases", () => getDatabases());
  const localDatabases = useMemo(
    () =>
      (databases ?? []).filter((database): database is SuccessDatabaseInfo => {
        return database.type === "success";
      }),
    [databases],
  );

  const [playerDb, setPlayerDb] = useState<string | null>(null);
  const [referenceDb, setReferenceDb] = useState<string | null>(storedReferenceDb);
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [color, setColor] = useState("any");
  const [maxPlies, setMaxPlies] = useState(24);
  const [minPlayerGames, setMinPlayerGames] = useState(3);
  const [minReferenceGames, setMinReferenceGames] = useState(50);
  const [topReferenceMoves, setTopReferenceMoves] = useState(3);
  const [maxPlayerScore, setMaxPlayerScore] = useState(45);
  const [minReferenceMoveShare, setMinReferenceMoveShare] = useState(10);
  const [report, setReport] = useState<RepertoireGapReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [trainingIndex, setTrainingIndex] = useState<number | null>(null);
  const [verificationEngine, setVerificationEngine] = useState<string | null>(null);
  const [verificationDepth, setVerificationDepth] = useState(10);
  const [mistakeThreshold, setMistakeThreshold] = useState(80);
  const [verification, setVerification] = useState<Record<string, VerificationResult>>({});
  const [verifying, setVerifying] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (localDatabases.length === 0) return;
    setPlayerDb((current) => current ?? localDatabases[0]?.file ?? null);
    setReferenceDb((current) => {
      if (current) return current;
      return storedReferenceDb ?? localDatabases[1]?.file ?? localDatabases[0]?.file ?? null;
    });
  }, [localDatabases, storedReferenceDb]);

  useEffect(() => {
    if (localEngines.length === 0) {
      setVerificationEngine(null);
      return;
    }
    setVerificationEngine((current) => {
      if (current && localEngines.some((engine) => engine.id === current)) return current;
      return localEngines[0].id;
    });
  }, [localEngines]);

  const { data: playerData } = useSWR(
    playerDb ? ["gap-players", playerDb, playerSearch] : null,
    async () => {
      return query_players(playerDb!, {
        name: playerSearch || null,
        range: null,
        options: {
          direction: "asc",
          page: 1,
          pageSize: 80,
          skipCount: false,
          sort: "name",
        },
      });
    },
  );

  const databaseOptions = localDatabases.map((database) => ({
    value: database.file,
    label: database.title || database.filename,
  }));
  const playerOptions =
    playerData?.data.map((player) => ({
      value: player.id.toString(),
      label: `${player.name || `Player ${player.id}`}${player.elo ? ` (${player.elo})` : ""}`,
    })) ?? [];

  const gaps = useMemo(() => report?.gaps ?? [], [report]);
  const trainingGap = trainingIndex !== null ? gaps[trainingIndex] : null;

  const loadGapOnBoard = useCallback(
    (gap: RepertoireGap, includeAnswer: boolean) => {
      const state = store.getState();
      state.setHeaders({
        ...state.headers,
        fen: gap.fen,
        orientation: gap.sideToMove === "black" ? "black" : "white",
        result: "*",
      });
      if (includeAnswer && gap.topReferenceMoves[0]) {
        store.getState().makeMoves({
          payload: [gap.topReferenceMoves[0].uci],
          mainline: true,
          changeHeaders: false,
        });
      }
      store.getState().goToStart();
    },
    [store],
  );

  useEffect(() => {
    if (!trainingGap || trainingIndex === null || rootFen !== trainingGap.fen) return;
    if (!currentNode.san || currentNode.fen === trainingGap.fen) return;

    const expected = trainingGap.topReferenceMoves[0]?.san;
    if (!expected) return;

    const correct = currentNode.san === expected;
    notifications.show({
      title: correct ? "Correct" : "Try this line instead",
      message: correct ? expected : `Expected ${expected}; you played ${currentNode.san}`,
      color: correct ? "green" : "red",
    });

    const timer = window.setTimeout(
      () => {
        const nextIndex = trainingIndex + 1;
        if (nextIndex >= gaps.length) {
          setTrainingIndex(null);
          notifications.show({
            title: "Gap trainer complete",
            message: `Reviewed ${gaps.length} flagged positions.`,
            color: "green",
          });
          return;
        }
        setTrainingIndex(nextIndex);
        loadGapOnBoard(gaps[nextIndex], false);
      },
      correct ? 450 : 1200,
    );

    return () => window.clearTimeout(timer);
  }, [currentNode.fen, currentNode.san, gaps, loadGapOnBoard, rootFen, trainingGap, trainingIndex]);

  async function analyze() {
    if (!playerDb || !referenceDb || !playerId) {
      notifications.show({
        title: "Missing setup",
        message: "Choose a player database, reference database, and player.",
        color: "yellow",
      });
      return;
    }

    setLoading(true);
    setReport(null);
    setVerification({});
    setTrainingIndex(null);

    const result = await commands.findRepertoireGaps({
      playerDb,
      referenceDb,
      playerId: Number(playerId),
      color,
      maxPlies,
      minPlayerGames,
      minReferenceGames,
      topReferenceMoves,
      maxPlayerScore: maxPlayerScore / 100,
      minReferenceMoveShare: minReferenceMoveShare / 100,
    });

    if (result.status === "ok") {
      setReport(result.data);
      notifications.show({
        title: "Repertoire scan complete",
        message: `${result.data.gaps.length} gap${result.data.gaps.length === 1 ? "" : "s"} found.`,
        color: "blue",
      });
    } else {
      notifications.show({
        title: "Could not scan repertoire",
        message: result.error,
        color: "red",
      });
    }

    setLoading(false);
  }

  function startTraining(fromIndex = 0) {
    if (gaps.length === 0) return;
    setTrainingIndex(fromIndex);
    loadGapOnBoard(gaps[fromIndex], false);
    notifications.show({
      title: "Gap trainer started",
      message: "Play the reference move on the board.",
      color: "blue",
    });
  }

  async function exportPgn() {
    if (gaps.length === 0) return;

    const dest = await save({
      defaultPath: "repertoire-gaps.pgn",
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!dest) return;

    const path = dest.toLowerCase().endsWith(".pgn") ? dest : `${dest}.pgn`;
    await writeTextFile(path, buildGapPgn(gaps));
    notifications.show({
      title: "Saved flagged positions",
      message: path,
      color: "green",
    });
  }

  async function verifyGap(gap: RepertoireGap) {
    const engine = localEngines.find((item) => item.id === verificationEngine);
    if (!engine) {
      notifications.show({
        title: "Engine required",
        message: "Add or select a local engine before verification.",
        color: "yellow",
      });
      return;
    }

    const id = gapId(gap);
    setVerifying((current) => new Set(current).add(id));

    const engineSettings = (engine.settings ?? []).map((setting) => ({
      name: setting.name,
      value: setting.value?.toString() ?? "",
    }));

    try {
      const result = unwrap(
        await commands.analyzeGame(
          `gap_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          engine.path,
          { t: "Depth", c: verificationDepth },
          {
            annotateNovelties: false,
            fen: gap.fen,
            moves: [gap.playerMoveUci],
            referenceDb: null,
            reversed: false,
          },
          engineSettings,
        ),
      );

      const before = result[0]?.best ?? [];
      const after = result[1]?.best?.[0] ?? null;
      const best = before[0] ?? null;
      const approved = before.some((line) => line.uciMoves[0] === gap.playerMoveUci);
      const lossCp =
        best && after
          ? scoreForGapSide(best.score.value, gap.sideToMove) -
            scoreForGapSide(after.score.value, gap.sideToMove)
          : null;

      const status: VerificationStatus =
        approved || (lossCp !== null && lossCp < 50)
          ? "engine-approved"
          : lossCp !== null && lossCp >= mistakeThreshold
            ? "likely-mistake"
            : "unclear";

      setVerification((current) => ({
        ...current,
        [id]: {
          status,
          lossCp,
          bestMoveSan: best?.sanMoves[0] ?? null,
          depth: best?.depth ?? null,
        },
      }));
    } catch (error) {
      notifications.show({
        title: "Verification failed",
        message: String(error),
        color: "red",
      });
    } finally {
      setVerifying((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function verifyTopGaps() {
    for (const gap of gaps.slice(0, 10)) {
      await verifyGap(gap);
    }
  }

  return (
    <Stack h="100%" gap="xs" p="sm">
      <Paper withBorder p="xs">
        <Stack gap="xs">
          <Group grow align="flex-end">
            <Select
              label="Player database"
              data={databaseOptions}
              value={playerDb}
              onChange={(value) => {
                setPlayerDb(value);
                setPlayerId(null);
              }}
              searchable
              allowDeselect={false}
            />
            <Select
              label="Reference database"
              data={databaseOptions}
              value={referenceDb}
              onChange={setReferenceDb}
              searchable
              allowDeselect={false}
            />
            <Select
              label="Player"
              data={playerOptions}
              value={playerId}
              onChange={setPlayerId}
              searchValue={playerSearch}
              onSearchChange={setPlayerSearch}
              searchable
              disabled={!playerDb}
              placeholder="Search by name"
            />
          </Group>

          <Group align="flex-end">
            <SegmentedControl
              value={color}
              onChange={setColor}
              data={[
                { value: "any", label: "Any" },
                { value: "white", label: "White" },
                { value: "black", label: "Black" },
              ]}
            />
            <NumberInput
              label="Max ply"
              value={maxPlies}
              onChange={(value) => setMaxPlies(Number(value) || 24)}
              min={2}
              max={80}
              w={100}
            />
            <NumberInput
              label="My games"
              value={minPlayerGames}
              onChange={(value) => setMinPlayerGames(Number(value) || 1)}
              min={1}
              w={105}
            />
            <NumberInput
              label="Ref games"
              value={minReferenceGames}
              onChange={(value) => setMinReferenceGames(Number(value) || 1)}
              min={1}
              w={110}
            />
            <NumberInput
              label="Top moves"
              value={topReferenceMoves}
              onChange={(value) => setTopReferenceMoves(Number(value) || 1)}
              min={1}
              max={8}
              w={110}
            />
            <NumberInput
              label="Max score %"
              value={maxPlayerScore}
              onChange={(value) => setMaxPlayerScore(Number(value) || 45)}
              min={0}
              max={100}
              w={120}
            />
            <NumberInput
              label="Min ref %"
              value={minReferenceMoveShare}
              onChange={(value) => setMinReferenceMoveShare(Number(value) || 0)}
              min={0}
              max={100}
              w={110}
            />
            <Button leftSection={<IconSearch size="1rem" />} onClick={analyze} loading={loading}>
              Find gaps
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Progress value={loading ? 100 : 0} animated={loading} size="xs" />

      {report && (
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <Badge variant="light">{formatNumber(report.playerGames)} player games</Badge>
            <Badge variant="light">{formatNumber(report.candidatePositions)} candidates</Badge>
            <Badge variant="light">{formatNumber(report.referencePositions)} in reference</Badge>
            <Badge color={gaps.length > 0 ? "orange" : "green"} variant="light">
              {formatNumber(gaps.length)} gaps
            </Badge>
            {trainingIndex !== null && trainingGap && (
              <Badge color="blue" variant="filled">
                Training {trainingIndex + 1}/{gaps.length}
              </Badge>
            )}
          </Group>

          <Group gap="xs" wrap="nowrap">
            <Select
              data={localEngines.map((engine) => ({ value: engine.id, label: engine.name }))}
              value={verificationEngine}
              onChange={setVerificationEngine}
              placeholder="Engine"
              size="xs"
              w={170}
              disabled={localEngines.length === 0}
            />
            <NumberInput
              value={verificationDepth}
              onChange={(value) => setVerificationDepth(Number(value) || 10)}
              min={1}
              max={40}
              size="xs"
              w={70}
            />
            <NumberInput
              value={mistakeThreshold}
              onChange={(value) => setMistakeThreshold(Number(value) || 80)}
              min={0}
              max={1000}
              size="xs"
              w={82}
            />
            <Button
              size="xs"
              variant="light"
              leftSection={<IconBrain size="0.875rem" />}
              onClick={verifyTopGaps}
              disabled={gaps.length === 0 || !verificationEngine}
            >
              Verify 10
            </Button>
            {trainingIndex === null ? (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlayerPlay size="0.875rem" />}
                onClick={() => startTraining()}
                disabled={gaps.length === 0}
              >
                Train
              </Button>
            ) : (
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconPlayerStop size="0.875rem" />}
                onClick={() => setTrainingIndex(null)}
              >
                Stop
              </Button>
            )}
            <Button
              size="xs"
              variant="light"
              leftSection={<IconDeviceFloppy size="0.875rem" />}
              onClick={exportPgn}
              disabled={gaps.length === 0}
            >
              Export PGN
            </Button>
          </Group>
        </Group>
      )}

      {!report && !loading && (
        <Alert color="blue" variant="light">
          Pick your imported games database, the reference database, and your player record. The scan
          flags moves that fall outside the common reference choices and score poorly in your games.
        </Alert>
      )}

      {report && gaps.length === 0 && (
        <Alert color="green" variant="light">
          No gaps matched these thresholds. Lower the game counts, raise the max score, or scan more
          plies if you want a wider net.
        </Alert>
      )}

      {gaps.length > 0 && (
        <ScrollArea flex={1} offsetScrollbars>
          <Table withTableBorder highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 80 }}>Severity</Table.Th>
                <Table.Th style={{ width: 70 }}>Ply</Table.Th>
                <Table.Th>My Move</Table.Th>
                <Table.Th>Reference</Table.Th>
                <Table.Th style={{ width: 120 }}>Score</Table.Th>
                <Table.Th style={{ width: 140 }}>Engine</Table.Th>
                <Table.Th style={{ width: 130 }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {gaps.map((gap, index) => (
                <GapRow
                  key={gapId(gap)}
                  gap={gap}
                  verification={verification[gapId(gap)]}
                  verifying={verifying.has(gapId(gap))}
                  onLoad={() => loadGapOnBoard(gap, true)}
                  onTrain={() => startTraining(index)}
                  onVerify={() => verifyGap(gap)}
                />
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}

function GapRow({
  gap,
  verification,
  verifying,
  onLoad,
  onTrain,
  onVerify,
}: {
  gap: RepertoireGap;
  verification?: VerificationResult;
  verifying: boolean;
  onLoad: () => void;
  onTrain: () => void;
  onVerify: () => void;
}) {
  const bestReference = gap.topReferenceMoves[0];
  const playedRank = gap.referenceMoveRank ? `#${gap.referenceMoveRank}` : "outside book";

  return (
    <Table.Tr>
      <Table.Td>
        <Badge color={gap.severity >= 55 ? "red" : gap.severity >= 30 ? "orange" : "yellow"}>
          {gap.severity.toFixed(0)}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text size="sm">
          {gap.ply + 1} {gap.sideToMove}
        </Text>
      </Table.Td>
      <Table.Td>
        <Stack gap={2}>
          <Text size="sm" fw={700}>
            {gap.playerMoveSan}
          </Text>
          <Text size="xs" c="dimmed">
            {formatNumber(gap.playerGames)} games, {playedRank},{" "}
            {formatPercent(gap.referenceMoveShare)} ref share
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        <Stack gap={3}>
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={700}>
              {bestReference?.san ?? "-"}
            </Text>
            {bestReference && (
              <Text size="xs" c="dimmed">
                {formatPercent(bestReference.share)} of {formatNumber(gap.referenceGames)}
              </Text>
            )}
          </Group>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {gap.topReferenceMoves
              .slice(0, 4)
              .map((move) => `${move.san} ${formatPercent(move.share)}`)
              .join("  ")}
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        <Stack gap={2}>
          <Text size="sm" fw={700}>
            {formatPercent(gap.playerScore)}
          </Text>
          <Text size="xs" c="dimmed">
            {gap.playerWhite}-{gap.playerDraw}-{gap.playerBlack}
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        {verification ? (
          <Stack gap={2}>
            <Badge
              color={
                verification.status === "likely-mistake"
                  ? "red"
                  : verification.status === "engine-approved"
                    ? "green"
                    : "yellow"
              }
              variant="light"
            >
              {verification.status === "likely-mistake"
                ? "mistake"
                : verification.status === "engine-approved"
                  ? "approved"
                  : "unclear"}
            </Badge>
            <Text size="xs" c="dimmed">
              {verification.lossCp === null ? "" : `${verification.lossCp.toFixed(0)} cp`}
              {verification.bestMoveSan ? `, best ${verification.bestMoveSan}` : ""}
            </Text>
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">
            Not checked
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Load line">
            <ActionIcon variant="subtle" onClick={onLoad}>
              <IconTargetArrow size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Train from here">
            <ActionIcon variant="subtle" onClick={onTrain}>
              <IconPlayerPlay size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Verify with engine">
            <ActionIcon variant="subtle" loading={verifying} onClick={onVerify}>
              <IconBrain size="1rem" />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

function gapId(gap: RepertoireGap) {
  return `${gap.fen}|${gap.playerMoveUci}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function scoreForGapSide(score: ScoreValue, sideToMove: string) {
  const cp = score.type === "cp" ? score.value : score.value > 0 ? 100000 : -100000;
  return sideToMove === "black" ? -cp : cp;
}

function buildGapPgn(gaps: RepertoireGap[]) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", ".");
  return gaps
    .map((gap, index) => {
      const best = gap.topReferenceMoves[0];
      const tags = [
        ["Event", "Repertoire Gap"],
        ["Site", "En Croissant"],
        ["Date", date],
        ["Round", (index + 1).toString()],
        ["White", gap.sideToMove === "white" ? "Trainer" : "?"],
        ["Black", gap.sideToMove === "black" ? "Trainer" : "?"],
        ["Result", "*"],
        ["SetUp", "1"],
        ["FEN", gap.fen],
      ]
        .map(([tag, value]) => `[${tag} "${escapePgnTag(value)}"]`)
        .join("\n");

      const comment = sanitizePgnComment(
        `Flagged because ${gap.playerMoveSan} scored ${formatPercent(gap.playerScore)} in ` +
          `${gap.playerGames} games and ranked ${gap.referenceMoveRank ?? "outside the top moves"} ` +
          `in the reference database. Reference choice: ${best?.san ?? "-"} ` +
          `(${best ? formatPercent(best.share) : "0%"}).`,
      );

      return `${tags}\n\n{ ${comment} }\n${moveTextForFen(gap.fen, best?.san ?? gap.playerMoveSan)} *`;
    })
    .join("\n\n");
}

function moveTextForFen(fen: string, san: string) {
  const parts = fen.trim().split(/\s+/);
  const turn = parts[1] ?? "w";
  const fullMove = parts[5] ?? "1";
  return turn === "b" ? `${fullMove}... ${san}` : `${fullMove}. ${san}`;
}

function escapePgnTag(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sanitizePgnComment(value: string) {
  return value.replace(/[{}]/g, " ").replace(/\s+/g, " ").trim();
}

export default memo(RepertoireGapsPanel);
