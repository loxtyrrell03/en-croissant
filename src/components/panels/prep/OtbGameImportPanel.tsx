import {
  Alert,
  Badge,
  Box,
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
import { FidePlayerSearchInput } from "@/components/common/FidePlayerSearchInput";
import { databaseConversionStateAtom } from "@/state/atoms";
import { getDatabases, type SuccessDatabaseInfo } from "@/utils/db";
import { getDatabasesDir } from "@/utils/directories";
import {
  FIDE_IMPORT_FALLBACK_YEAR,
  getFideImportStartYear,
  type FidePlayer,
} from "@/utils/fidePlayer";
import { searchFidePlayers } from "@/utils/lichess/api";
import {
  DEFAULT_OTB_IMPORT_SOURCES,
  OTB_IMPORT_SOURCE_DETAILS,
  applyOtbImportLaneProgress,
  createOtbImportRequest,
  formatOtbImportEta,
  getOtbImportDescription,
  getOtbImportEtaSeconds,
  getOtbImportLaneLabel,
  getOtbImportLaneSummary,
  getOtbImportTitle,
  getOtbImportWarningCount,
  mergeOtbImportProgress,
  sanitizeOtbImportFilename,
  validateOtbImportRequest,
  type OtbImportLaneMap,
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
  variant = "inline",
  submitLabel = "Find OTB games + use",
  onImported,
}: {
  initialPlayerName: string;
  databaseDir: string;
  localDatabases: SuccessDatabaseInfo[];
  controlSize: MantineSize;
  dense: boolean;
  forceSaveDatabase?: boolean;
  /** "dialog" drops the explanatory alert and fills the dialog width; the
   *  surrounding modal already sets the context the alert would repeat. */
  variant?: "inline" | "dialog";
  submitLabel?: string;
  onImported: (result: OtbImportComplete) => void | Promise<void>;
}) {
  const asDialog = variant === "dialog";
  const currentYear = new Date().getFullYear();
  const [playerName, setPlayerName] = useState(initialPlayerName);
  const [fideId, setFideId] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<FidePlayer | null>(null);
  const [fideIdAuto, setFideIdAuto] = useState(false);
  const [fromYear, setFromYear] = useState(FIDE_IMPORT_FALLBACK_YEAR);
  const [sources, setSources] = useState<OtbImportSourceSelection>(DEFAULT_OTB_IMPORT_SOURCES);
  const [localPgnPaths, setLocalPgnPaths] = useState<string[]>([]);
  const [saveDatabase, setSaveDatabase] = useState(true);
  const [running, setRunning] = useState(false);
  const [resolvingIdentity, setResolvingIdentity] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<OtbImportProgress | null>(null);
  const [lanes, setLanes] = useState<OtbImportLaneMap>({});
  const [laneTotal, setLaneTotal] = useState(0);
  const [report, setReport] = useState<OtbImportReport | null>(null);
  const [importedGameCount, setImportedGameCount] = useState<number | null>(null);
  const [etaNow, setEtaNow] = useState(() => Date.now());
  const shouldSaveDatabase = forceSaveDatabase || saveDatabase;
  const [, setConversionState] = useAtom(databaseConversionStateAtom);
  const activeJobIdRef = useRef<string | null>(null);
  const laneStartedAtRef = useRef<Record<string, number>>({});
  const initialNameAppliedRef = useRef(initialPlayerName);
  const fromYearManuallyEditedRef = useRef(false);

  useEffect(() => {
    if (initialPlayerName && (!playerName.trim() || playerName === initialNameAppliedRef.current)) {
      setPlayerName(initialPlayerName);
      initialNameAppliedRef.current = initialPlayerName;
    }
  }, [initialPlayerName, playerName]);

  useEffect(() => {
    const unlisten = events.otbImportProgress.listen(({ payload }) => {
      if (payload.jobId !== activeJobIdRef.current) return;
      setProgress((current) => mergeOtbImportProgress(current, payload));
      // Sources search in parallel; each event narrates one lane.
      if (payload.source === "All sources") setLaneTotal(payload.total);
      else {
        if (payload.source !== "Complete" && !(payload.source in laneStartedAtRef.current)) {
          laneStartedAtRef.current[payload.source] = Date.now();
        }
        setLanes((current) => applyOtbImportLaneProgress(current, payload));
      }
      setEtaNow(Date.now());
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (!running || !progress) return;
    const timer = window.setInterval(() => setEtaNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [progress, running]);

  const laneSummary = getOtbImportLaneSummary(lanes, laneTotal);
  const etaSeconds = getOtbImportEtaSeconds(laneSummary.entries, laneStartedAtRef.current, etaNow);
  const etaLabel = etaSeconds === null ? "estimating" : formatOtbImportEta(etaSeconds);
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

  const selectFidePlayer = (player: FidePlayer) => {
    setSelectedPlayer(player);
    setPlayerName(player.name);
    setFideId(String(player.id));
    setFideIdAuto(true);
    if (!fromYearManuallyEditedRef.current) {
      setFromYear(getFideImportStartYear(player, currentYear));
    }
  };

  const clearSelectedPlayer = () => {
    setSelectedPlayer(null);
    if (fideIdAuto) {
      setFideId("");
      setFideIdAuto(false);
    }
  };

  const changePlayerName = (value: string) => {
    setPlayerName(value);
    if (selectedPlayer && value.trim() !== selectedPlayer.name) clearSelectedPlayer();
  };

  const changeFideId = (value: string) => {
    const clean = value.replace(/\D/g, "");
    setFideId(clean);
    setFideIdAuto(false);
    if (selectedPlayer && clean !== String(selectedPlayer.id)) setSelectedPlayer(null);
  };

  const autofillFromFideId = async () => {
    const id = fideId.trim();
    if (!/^\d{4,}$/.test(id) || id === String(selectedPlayer?.id ?? "")) return;
    const player = (await searchFidePlayers(id)).find((candidate) => String(candidate.id) === id);
    if (player) selectFidePlayer(player);
  };

  const resolveImportIdentity = async () => {
    let name = playerName.trim();
    let id = fideId.trim();
    let resolvedPlayer = selectedPlayer;
    const lookup = /^\d+$/.test(name) ? name : /^\d{4,}$/.test(id) ? id : "";
    if (!selectedPlayer && lookup) {
      const player = (await searchFidePlayers(lookup)).find(
        (candidate) => String(candidate.id) === lookup,
      );
      if (player) {
        resolvedPlayer = player;
        selectFidePlayer(player);
        name = player.name;
        id = String(player.id);
      }
    }
    if (!resolvedPlayer && !lookup && name) {
      const normalizedName = name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const player = (await searchFidePlayers(name).catch(() => [])).find(
        (candidate) =>
          candidate.name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() ===
          normalizedName,
      );
      if (player) {
        resolvedPlayer = player;
        selectFidePlayer(player);
        name = player.name;
        id = String(player.id);
      }
    }
    const resolvedFromYear = getFideImportStartYear(
      resolvedPlayer,
      currentYear,
      fromYearManuallyEditedRef.current ? fromYear : null,
    );
    if (!fromYearManuallyEditedRef.current && resolvedFromYear !== fromYear) {
      setFromYear(resolvedFromYear);
    }
    return { name, id, fromYear: resolvedFromYear };
  };

  const runImport = async () => {
    if (running || resolvingIdentity) return;
    setResolvingIdentity(true);
    const identity = await resolveImportIdentity();
    setResolvingIdentity(false);
    const jobId = `otb-import-${Date.now()}`;
    const baseTitle = getOtbImportTitle(identity.name, identity.fromYear);
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
      playerName: identity.name,
      fideId: identity.id,
      fromYear: identity.fromYear,
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
    setLanes({});
    setLaneTotal(0);
    laneStartedAtRef.current = {};
    setEtaNow(Date.now());
    setReport(null);
    setImportedGameCount(null);
    setStopping(false);
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
        throw new Error(
          result.cancelled
            ? "The search was stopped before any games were found."
            : sourceError || "No verified public OTB PGNs were found for this player.",
        );
      }
      if (!result.coverageComplete && !result.cancelled) {
        throw new Error(
          `The search kept its verified games but did not build a database because not every selected source completed: ${result.coverageGaps.join(" ")}`,
        );
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
        title: result.cancelled ? "Partial OTB database ready" : "OTB prep database ready",
        message:
          convertedGameCount === result.gamesFound
            ? `${convertedGameCount} OTB game${convertedGameCount === 1 ? "" : "s"} imported${result.cancelled ? " from the stopped search" : ""}; ${result.duplicatesRemoved} duplicate${result.duplicatesRemoved === 1 ? "" : "s"} removed.`
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
      setStopping(false);
      resetDatabaseConversionState(setConversionState);
      setRunning(false);
    }
  };

  const stopAndCreateDatabase = async () => {
    const jobId = activeJobIdRef.current;
    if (!jobId || stopping) return;
    setStopping(true);
    try {
      const accepted = await commands.cancelOtbGames(jobId);
      if (!accepted) setStopping(false);
    } catch (error) {
      setStopping(false);
      notifications.show({
        title: "Could not stop the OTB search",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    }
  };

  return (
    <Stack gap={dense ? 4 : "md"}>
      {asDialog ? null : (
        <Alert color="blue" variant="light" p={dense ? 6 : "xs"}>
          <Text size="xs">
            OTB only. Search and select a FIDE player to autofill the canonical name and ID. A
            selected ID also safely enables initials, alternate name order, and one-letter typo
            matching in public PGNs. Personal Chess.com and Lichess games are never included.
          </Text>
        </Alert>
      )}
      <Group gap={dense ? 4 : "sm"} wrap="wrap" align="flex-end">
        <Box style={asDialog ? { flex: 1, minWidth: 220 } : { width: dense ? 210 : 260 }}>
          <FidePlayerSearchInput
            disabled={running || resolvingIdentity}
            label={asDialog ? "Player" : "Opponent"}
            onChange={changePlayerName}
            onSelect={selectFidePlayer}
            searchPlayers={searchFidePlayers}
            selected={selectedPlayer}
            size={controlSize}
            value={playerName}
          />
        </Box>
        <TextInput
          label="FIDE ID"
          placeholder="Autofilled"
          value={fideId}
          onBlur={() => void autofillFromFideId()}
          onChange={(event) => changeFideId(event.currentTarget.value)}
          size={controlSize}
          w={dense ? 112 : 132}
        />
        <NumberInput
          label="Since"
          value={fromYear}
          onChange={(value) => {
            fromYearManuallyEditedRef.current = true;
            setFromYear(Number(value) || FIDE_IMPORT_FALLBACK_YEAR);
          }}
          min={FIDE_IMPORT_FALLBACK_YEAR}
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
      <Group gap={dense ? 6 : "md"} wrap="wrap">
        {OTB_IMPORT_SOURCE_DETAILS.map((source) => (
          <Tooltip key={source.key} label={source.detail}>
            <Checkbox
              label={
                <span>
                  {source.label}
                  {"note" in source && source.note ? ` · ${source.note}` : ""}
                </span>
              }
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
      <Group gap={dense ? 4 : "sm"} wrap="wrap" align="center">
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
          ml={asDialog ? "auto" : undefined}
          color={running ? "orange" : undefined}
          variant={running ? "light" : "filled"}
          leftSection={running ? <IconX size="0.95rem" /> : <IconCloudSearch size="0.95rem" />}
          loading={stopping || resolvingIdentity}
          onClick={() => void (running ? stopAndCreateDatabase() : runImport())}
        >
          {running ? "Stop and create database" : submitLabel}
        </Button>
      </Group>
      {running && progress ? (
        <Stack gap={4}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed" truncate>
              {laneSummary.total > 0
                ? `Searching ${laneSummary.total} source lanes in parallel · ${laneSummary.done} finished`
                : progress.message}
            </Text>
            <Badge variant="light" size="sm">
              {progress.gamesFound} found · {etaLabel}
            </Badge>
          </Group>
          <Progress
            value={laneSummary.total > 0 ? (laneSummary.done / laneSummary.total) * 100 : 100}
            animated={laneSummary.total === 0}
            size="xs"
          />
          {laneSummary.entries.length > 0 ? (
            <Stack gap={2}>
              {laneSummary.entries.map((lane) => (
                <Group key={lane.source} justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed" truncate>
                    {getOtbImportLaneLabel(lane.source)}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {lane.phase === "done"
                      ? "done"
                      : lane.total > 0
                        ? `${lane.current}/${lane.total}`
                        : "…"}
                  </Text>
                </Group>
              ))}
            </Stack>
          ) : null}
        </Stack>
      ) : null}
      {report ? (
        <Alert
          color={!report.coverageComplete || sourceWarnings > 0 ? "yellow" : "green"}
          variant="light"
          p={dense ? 6 : "xs"}
        >
          <Stack gap={3}>
            <Text size="xs" fw={600}>
              {report.cancelled ? "Stopped early · " : ""}
              {report.gamesFound} unique source games · {report.duplicatesRemoved} duplicates
              removed · {report.suspectedOnlineGamesExcluded} online records excluded
            </Text>
            {importedGameCount !== null ? (
              <Text size="xs" fw={600}>
                {importedGameCount} usable games imported into the prep database
              </Text>
            ) : null}
            {!report.coverageComplete ? (
              <Text size="xs" c="yellow.8">
                Coverage incomplete · {report.coverageGaps.join(" · ")}
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
