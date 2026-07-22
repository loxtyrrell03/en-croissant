import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Progress,
  Stack,
  Text,
  TextInput,
  Tooltip,
  type MantineSize,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCloudSearch, IconFilePlus, IconX } from "@tabler/icons-react";
import { appCacheDir, resolve, tempDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { mutate } from "swr";
import { commands, events, type OtbImportProgress, type OtbImportReport } from "@/bindings";
import { databaseConversionStateAtom } from "@/state/atoms";
import { getDatabases, type SuccessDatabaseInfo } from "@/utils/db";
import { getDatabasesDir } from "@/utils/directories";
import {
  DEFAULT_OTB_IMPORT_SOURCES,
  OTB_IMPORT_SOURCE_DETAILS,
  createOtbImportRequest,
  getOtbImportDescription,
  getOtbImportProgressPercent,
  getOtbImportTitle,
  getOtbImportWarningCount,
  sanitizeOtbImportFilename,
  validateOtbImportRequest,
  type OtbImportSourceSelection,
} from "@/utils/otbGameImport";
import { resetDatabaseConversionState } from "@/utils/onlineGameImport";
import { unwrap } from "@/utils/unwrap";

export type OtbImportComplete = {
  dbPath: string;
  title: string;
  temporary: boolean;
  importedGameCount: number;
  report: OtbImportReport;
};

export default function OtbGameImportPanel({
  initialPlayerName,
  databaseDir,
  localDatabases,
  controlSize,
  dense,
  forceSaveDatabase = false,
  onImported,
}: {
  initialPlayerName: string;
  databaseDir: string;
  localDatabases: SuccessDatabaseInfo[];
  controlSize: MantineSize;
  dense: boolean;
  forceSaveDatabase?: boolean;
  onImported: (result: OtbImportComplete) => void | Promise<void>;
}) {
  const currentYear = new Date().getFullYear();
  const [playerName, setPlayerName] = useState(initialPlayerName);
  const [fideId, setFideId] = useState("");
  const [fromYear, setFromYear] = useState(Math.max(2020, currentYear - 2));
  const [sources, setSources] = useState<OtbImportSourceSelection>(DEFAULT_OTB_IMPORT_SOURCES);
  const [localPgnPaths, setLocalPgnPaths] = useState<string[]>([]);
  const [saveDatabase, setSaveDatabase] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OtbImportProgress | null>(null);
  const [report, setReport] = useState<OtbImportReport | null>(null);
  const [importedGameCount, setImportedGameCount] = useState<number | null>(null);
  const shouldSaveDatabase = forceSaveDatabase || saveDatabase;
  const [, setConversionState] = useAtom(databaseConversionStateAtom);
  const activeJobIdRef = useRef<string | null>(null);
  const initialNameAppliedRef = useRef(initialPlayerName);

  useEffect(() => {
    if (initialPlayerName && (!playerName.trim() || playerName === initialNameAppliedRef.current)) {
      setPlayerName(initialPlayerName);
      initialNameAppliedRef.current = initialPlayerName;
    }
  }, [initialPlayerName, playerName]);

  useEffect(() => {
    const unlisten = events.otbImportProgress.listen(({ payload }) => {
      if (payload.jobId === activeJobIdRef.current) setProgress(payload);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  const progressPercent = getOtbImportProgressPercent(progress);
  const sourceWarnings = report ? getOtbImportWarningCount(report) : 0;
  const localPgnLabels = useMemo(
    () => localPgnPaths.map((path) => path.split(/[\\/]/).at(-1) ?? path),
    [localPgnPaths],
  );

  const addLocalPgnSources = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "PGN sources",
          extensions: ["pgn", "zip", "zst"],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setLocalPgnPaths((current) => Array.from(new Set([...current, ...paths])));
  };

  const runImport = async () => {
    if (running) return;
    const jobId = `otb-import-${Date.now()}`;
    const baseTitle = getOtbImportTitle(playerName, fromYear);
    const title = shouldSaveDatabase
      ? getUniqueOtbDatabaseTitle(baseTitle, localDatabases)
      : baseTitle;
    const filename = sanitizeOtbImportFilename(title);
    const targetDir = shouldSaveDatabase
      ? databaseDir || (await getDatabasesDir())
      : await tempDir();
    const dbPath = await resolve(
      targetDir,
      shouldSaveDatabase ? `${filename}.db3` : `${filename}-${jobId}.db3`,
    );
    const pgnPath = await resolve(
      targetDir,
      shouldSaveDatabase ? `${filename}.pgn` : `${filename}-${jobId}.pgn`,
    );
    const cacheDir = await resolve(await appCacheDir(), "otb-game-import");
    const request = createOtbImportRequest({
      jobId,
      playerName,
      fideId,
      fromYear,
      sources,
      localPgnPaths,
      cacheDir,
      outputPath: pgnPath,
    });
    const validationError = validateOtbImportRequest(request, currentYear);
    if (validationError) {
      notifications.show({
        title: "OTB import needs more information",
        message: validationError,
        color: "yellow",
      });
      return;
    }

    activeJobIdRef.current = jobId;
    setRunning(true);
    setProgress(null);
    setReport(null);
    setImportedGameCount(null);
    const startedAt = Date.now();
    setConversionState((current) => ({
      ...current,
      inProgress: true,
      phase: "downloading",
      progress: null,
      progressId: jobId,
      sourceKind: "otb-games",
      startedAt,
      updatedAt: startedAt,
      totalGames: 0,
      totalGamesExpected: null,
      elapsedSeconds: 0,
      targetDatabasePath: dbPath,
      targetDatabaseTitle: title,
      sourceFileName: pgnPath.split(/[\\/]/).at(-1) ?? null,
    }));

    try {
      const result = unwrap(await commands.collectOtbGames(request));
      setReport(result);
      if (result.gamesFound === 0) {
        const sourceError = result.sources.flatMap((source) => source.errors).at(0);
        throw new Error(sourceError || "No verified public OTB PGNs were found for this player.");
      }

      setConversionState((current) => ({
        ...current,
        phase: "converting",
        progress: 0,
        updatedAt: Date.now(),
        totalGames: 0,
        totalGamesExpected: result.gamesFound,
      }));
      unwrap(
        await commands.convertPgn(pgnPath, dbPath, null, title, getOtbImportDescription(result)),
      );
      unwrap(await commands.deleteDuplicatedGames(dbPath));
      unwrap(await commands.deleteEmptyGames(dbPath));
      const databaseInfo = unwrap(await commands.getDbInfo(dbPath));
      const convertedGameCount = databaseInfo.game_count;
      setImportedGameCount(convertedGameCount);
      setConversionState((current) => ({
        ...current,
        progress: 100,
        totalGames: convertedGameCount,
        updatedAt: Date.now(),
      }));
      await commands.clearGames();

      if (shouldSaveDatabase) {
        const nextDatabases = await getDatabases();
        await mutate("databases", nextDatabases, { revalidate: false });
      }
      await onImported({
        dbPath,
        title,
        temporary: !shouldSaveDatabase,
        importedGameCount: convertedGameCount,
        report: result,
      });
      notifications.show({
        title: "OTB prep database ready",
        message:
          convertedGameCount === result.gamesFound
            ? `${convertedGameCount} OTB game${convertedGameCount === 1 ? "" : "s"} imported; ${result.duplicatesRemoved} duplicate${result.duplicatesRemoved === 1 ? "" : "s"} removed.`
            : `${convertedGameCount} usable OTB game${convertedGameCount === 1 ? "" : "s"} imported from ${result.gamesFound} unique source records; ${result.gamesFound - convertedGameCount} malformed or empty record${result.gamesFound - convertedGameCount === 1 ? "" : "s"} skipped.`,
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Could not build the OTB prep database",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      activeJobIdRef.current = null;
      resetDatabaseConversionState(setConversionState);
      setRunning(false);
    }
  };

  return (
    <Stack gap={dense ? 4 : "xs"}>
      <Alert color="blue" variant="light" p={dense ? 6 : "xs"}>
        <Text size="xs">
          OTB only. Personal Chess.com and Lichess account games are never included. FIDE ID is
          strongly recommended to avoid same-name players. Coverage is exhaustive across the
          selected public PGN sources, but events that publish results without moves cannot be
          imported.
        </Text>
      </Alert>
      <Group gap={dense ? 4 : "xs"} wrap="wrap" align="flex-end">
        <TextInput
          label="Opponent"
          placeholder="Surname, Firstname"
          value={playerName}
          onChange={(event) => setPlayerName(event.currentTarget.value)}
          size={controlSize}
          w={dense ? 180 : 230}
        />
        <TextInput
          label="FIDE ID"
          placeholder="Recommended"
          value={fideId}
          onChange={(event) => setFideId(event.currentTarget.value)}
          size={controlSize}
          w={dense ? 112 : 132}
        />
        <NumberInput
          label="Since"
          value={fromYear}
          onChange={(value) => setFromYear(Number(value) || currentYear - 2)}
          min={1900}
          max={currentYear}
          step={1}
          size={controlSize}
          w={dense ? 92 : 108}
        />
        {!forceSaveDatabase ? (
          <Checkbox
            label="Save database"
            checked={saveDatabase}
            onChange={(event) => setSaveDatabase(event.currentTarget.checked)}
            size={controlSize}
          />
        ) : null}
      </Group>
      <Group gap={dense ? 6 : "sm"} wrap="wrap">
        {OTB_IMPORT_SOURCE_DETAILS.map((source) => (
          <Tooltip key={source.key} label={source.detail}>
            <Checkbox
              label={source.label}
              checked={sources[source.key]}
              onChange={(event) =>
                setSources((current) => ({
                  ...current,
                  [source.key]: event.currentTarget.checked,
                }))
              }
              size={controlSize}
            />
          </Tooltip>
        ))}
      </Group>
      <Group gap={dense ? 4 : "xs"} wrap="wrap" align="center">
        <Tooltip label="Add public PGN, ZIP, or Zstandard files exported from ChessBase or another source">
          <Button
            variant="default"
            size={controlSize}
            leftSection={<IconFilePlus size="0.95rem" />}
            onClick={() => void addLocalPgnSources()}
          >
            Add PGN sources
          </Button>
        </Tooltip>
        {localPgnLabels.map((label, index) => (
          <Badge
            key={`${localPgnPaths[index]}-${label}`}
            variant="light"
            rightSection={
              <IconX
                size={11}
                style={{ cursor: "pointer" }}
                onClick={() =>
                  setLocalPgnPaths((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              />
            }
          >
            {label}
          </Badge>
        ))}
        <Button
          size={controlSize}
          leftSection={<IconCloudSearch size="0.95rem" />}
          loading={running}
          onClick={() => void runImport()}
        >
          Find OTB games + use
        </Button>
      </Group>
      {running && progress ? (
        <Stack gap={3}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed" truncate>
              {progress.message}
            </Text>
            <Badge variant="light" size="sm">
              {progress.gamesFound} found
            </Badge>
          </Group>
          <Progress value={progressPercent ?? 100} animated={progressPercent === null} size="xs" />
        </Stack>
      ) : null}
      {report ? (
        <Alert color={sourceWarnings > 0 ? "yellow" : "green"} variant="light" p={dense ? 6 : "xs"}>
          <Stack gap={3}>
            <Text size="xs" fw={600}>
              {report.gamesFound} unique source games · {report.duplicatesRemoved} duplicates
              removed · {report.suspectedOnlineGamesExcluded} online records excluded
            </Text>
            {importedGameCount !== null ? (
              <Text size="xs" fw={600}>
                {importedGameCount} usable games imported into the prep database
              </Text>
            ) : null}
            {report.sources.map((source) => (
              <Text key={source.source} size="xs" c="dimmed">
                {source.source}: {source.uniqueGamesAdded} unique from {source.archivesChecked}{" "}
                files/pages{source.errors.length ? ` · ${source.errors.length} warning(s)` : ""}
              </Text>
            ))}
          </Stack>
        </Alert>
      ) : null}
    </Stack>
  );
}

function getUniqueOtbDatabaseTitle(base: string, databases: SuccessDatabaseInfo[]) {
  const titles = new Set(databases.map((database) => database.title.toLocaleLowerCase()));
  if (!titles.has(base.toLocaleLowerCase())) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base} (${suffix})`;
    if (!titles.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}
