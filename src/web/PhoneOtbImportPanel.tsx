import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  Progress,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconChevronDown,
  IconDeviceDesktop,
  IconPlayerStop,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { FidePlayerSearchInput } from "@/components/common/FidePlayerSearchInput";
import {
  FIDE_IMPORT_FALLBACK_YEAR,
  getFideImportStartYear,
  type FidePlayer,
} from "@/utils/fidePlayer";
import {
  DEFAULT_WEB_OTB_IMPORT_SOURCES,
  cancelWebOtbImport,
  findExactWebFidePlayer,
  getWebOtbImportedGames,
  getWebOtbProgressValue,
  searchWebFidePlayers,
  startWebOtbImport,
  watchWebOtbImportJob,
  WEB_OTB_JOB_STORAGE_KEY,
  WEB_OTB_PREP_HANDLED_JOB_STORAGE_KEY,
  type WebOtbImportedGame,
  type WebOtbImportJob,
  type WebOtbImportSources,
} from "./otbImport";
import classes from "./OnlineGameAnalysisPanel.module.css";

const WEB_OTB_PLAYER_KEY = "encroissant-web-otb-player";

export default function PhoneOtbImportPanel({
  onAnalyzeGame,
}: {
  onAnalyzeGame: (game: WebOtbImportedGame) => Promise<void>;
}) {
  const currentYear = new Date().getFullYear();
  const [playerName, setPlayerName] = useStoredString(WEB_OTB_PLAYER_KEY);
  const [fideId, setFideId] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<FidePlayer | null>(null);
  const [fideIdAuto, setFideIdAuto] = useState(false);
  const [fromYear, setFromYear] = useState(FIDE_IMPORT_FALLBACK_YEAR);
  const [sources, setSources] = useState<WebOtbImportSources>(DEFAULT_WEB_OTB_IMPORT_SOURCES);
  const [visibleGames, setVisibleGames] = useState(20);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [job, setJob] = useState<WebOtbImportJob | null>(null);
  const [jobId, setJobId] = useState(() => window.localStorage.getItem(WEB_OTB_JOB_STORAGE_KEY));
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fromYearManuallyEditedRef = useRef(false);
  const games = useMemo(() => (job ? getWebOtbImportedGames(job) : []), [job]);
  const running = job?.status === "queued" || job?.status === "running";
  const openedInPrep = Boolean(
    job?.id && window.localStorage.getItem(WEB_OTB_PREP_HANDLED_JOB_STORAGE_KEY) === job.id,
  );

  useEffect(() => {
    if (!jobId) return;
    return watchWebOtbImportJob(
      jobId,
      (next) => {
        setJob(next);
        setError(next.status === "failed" ? next.error || "The PC OTB import failed." : null);
      },
      () => setError("The PC connection dropped. Reconnecting automatically…"),
    );
  }, [jobId]);

  function selectFidePlayer(player: FidePlayer) {
    setSelectedPlayer(player);
    setPlayerName(player.name);
    setFideId(String(player.id));
    setFideIdAuto(true);
    if (!fromYearManuallyEditedRef.current) {
      setFromYear(getFideImportStartYear(player, currentYear));
    }
    setError(null);
  }

  function clearSelectedPlayer() {
    setSelectedPlayer(null);
    if (fideIdAuto) {
      setFideId("");
      setFideIdAuto(false);
    }
  }

  function changePlayerName(value: string) {
    setPlayerName(value);
    if (selectedPlayer && value.trim() !== selectedPlayer.name) clearSelectedPlayer();
  }

  function changeFideId(value: string) {
    const clean = value.replace(/\D/g, "");
    setFideId(clean);
    setFideIdAuto(false);
    if (selectedPlayer && clean !== String(selectedPlayer.id)) setSelectedPlayer(null);
  }

  async function autofillFromFideId() {
    const id = fideId.trim();
    if (!/^\d{4,}$/.test(id) || id === String(selectedPlayer?.id ?? "")) return;
    const player = (await searchWebFidePlayers(id)).find(
      (candidate) => String(candidate.id) === id,
    );
    if (player) selectFidePlayer(player);
  }

  async function resolveIdentity() {
    let name = playerName.trim();
    let id = fideId.trim();
    let resolvedPlayer = selectedPlayer;
    const lookup = /^\d+$/.test(name) ? name : /^\d{4,}$/.test(id) ? id : "";
    if (!selectedPlayer && lookup) {
      const player = (await searchWebFidePlayers(lookup)).find(
        (candidate) => String(candidate.id) === lookup,
      );
      if (player) {
        resolvedPlayer = player;
        selectFidePlayer(player);
        name = player.name;
        id = String(player.id);
      }
    }
    if (!selectedPlayer && !lookup && name) {
      const player = findExactWebFidePlayer(await searchWebFidePlayers(name).catch(() => []), name);
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
  }

  async function startSearch() {
    if (starting || running) return;
    setStarting(true);
    setError(null);
    try {
      const identity = await resolveIdentity();
      const next = await startWebOtbImport({
        playerName: identity.name,
        fideId: identity.id,
        fromYear: identity.fromYear,
        sources,
      });
      setJob(next);
      setJobId(next.id);
      window.localStorage.setItem(WEB_OTB_JOB_STORAGE_KEY, next.id);
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : "The PC OTB search could not start.",
      );
    } finally {
      setStarting(false);
    }
  }

  async function analyze(game: WebOtbImportedGame) {
    if (analyzingId) return;
    setAnalyzingId(game.id);
    setError(null);
    try {
      await onAnalyzeGame(game);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "This OTB game could not be opened for analysis.",
      );
    } finally {
      setAnalyzingId(null);
    }
  }

  async function stopSearch() {
    if (!job?.id || !running || stopping) return;
    setStopping(true);
    setError(null);
    try {
      await cancelWebOtbImport(job.id);
      window.localStorage.removeItem(WEB_OTB_JOB_STORAGE_KEY);
      setJobId(null);
      setJob(null);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "The PC search could not stop.");
    } finally {
      setStopping(false);
    }
  }

  const progress = job?.progress;
  const progressValue = getWebOtbProgressValue(progress, running);
  const overallFinished = progress?.overallCurrent ?? 0;
  const overallTotal = progress?.overallTotal ?? 0;
  const progressMessage =
    overallTotal > 0 && overallFinished >= overallTotal
      ? "Finishing and saving the verified games on your PC…"
      : overallTotal > 0 && progress
        ? `Latest source update — ${progress.source}: ${progress.message}`
        : progress?.message;

  return (
    <Stack className={classes.otbForm} gap="sm">
      <Alert color="blue" icon={<IconDeviceDesktop size={17} />} variant="light">
        The phone only controls this search. Your PC downloads, filters, validates, deduplicates,
        stores every OTB result, and resolves FIDE player suggestions.
      </Alert>
      <FidePlayerSearchInput
        disabled={running}
        label="Player full name"
        onChange={changePlayerName}
        onSelect={selectFidePlayer}
        searchPlayers={searchWebFidePlayers}
        selected={selectedPlayer}
        mobileInline
        size="md"
        value={playerName}
      />
      <Box className={classes.identityFields}>
        <TextInput
          autoCapitalize="none"
          disabled={running}
          inputMode="numeric"
          label="FIDE ID"
          placeholder="Autofilled"
          size="md"
          value={fideId}
          onBlur={() => void autofillFromFideId()}
          onChange={(event) => changeFideId(event.currentTarget.value)}
        />
        <NumberInput
          disabled={running}
          label="Games since"
          max={currentYear}
          min={FIDE_IMPORT_FALLBACK_YEAR}
          size="md"
          value={fromYear}
          onChange={(value) => {
            fromYearManuallyEditedRef.current = true;
            setFromYear(Number(value) || FIDE_IMPORT_FALLBACK_YEAR);
          }}
        />
      </Box>
      <Text c="dimmed" size="xs">
        Defaults to the selected player&apos;s FIDE birth year, or 1900 when it is unavailable.
        Enter a later year only to narrow the import.
      </Text>

      <Button
        justify="space-between"
        onClick={() => setAdvancedOpen((open) => !open)}
        rightSection={<IconChevronDown size={15} />}
        size="md"
        variant="subtle"
      >
        PC search sources
      </Button>
      <Collapse in={advancedOpen}>
        <Stack gap={6}>
          <SourceCheckbox
            detail="FIDE-linked Lichess events plus Chessscope"
            disabled={running}
            label="Targeted broadcasts"
            source="lichessBroadcasts"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Chess-Results player and event PGNs"
            disabled={running}
            label="Chess-Results"
            source="chessResults"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Public tournament PGNs linked from ChessBase news coverage"
            disabled={running}
            label="ChessBase news PGNs"
            source="chessbaseNews"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Organiser archives, BritBase and PGN Mentor"
            disabled={running}
            label="Official public PGN indexes"
            source="officialPgnIndexes"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="The Week in Chess public PGNs"
            disabled={running}
            label="TWIC"
            source="twic"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Searches indexed official monthly Lichess broadcasts"
            disabled={running}
            label="Full Lichess archive"
            source="broadcastArchives"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Checks user-created Lichess broadcasts not covered elsewhere"
            disabled={running}
            label="Community broadcasts"
            source="communityBroadcasts"
            sources={sources}
            setSources={setSources}
          />
        </Stack>
      </Collapse>

      {running ? (
        <Button
          color="red"
          leftSection={<IconPlayerStop size={16} />}
          loading={stopping}
          onClick={() => void stopSearch()}
          size="md"
          variant="light"
        >
          Stop search
        </Button>
      ) : (
        <Button
          disabled={!playerName.trim()}
          leftSection={<IconSearch size={16} />}
          loading={starting}
          onClick={() => void startSearch()}
          size="md"
        >
          Search OTB games on PC
        </Button>
      )}

      {running && progress ? (
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text c="dimmed" size="xs" truncate>
              {progressMessage}
            </Text>
            <Badge variant="light">{progress.gamesFound} found</Badge>
          </Group>
          {overallTotal > 0 ? (
            <Text c="dimmed" size="0.65rem">
              {Math.min(overallFinished, overallTotal)} of {overallTotal} source lanes finished
            </Text>
          ) : null}
          <Progress animated={running} size="xs" value={progressValue} />
        </Stack>
      ) : null}
      {job?.status === "completed" ? (
        <Alert color={games.length > 0 ? "green" : "yellow"} variant="light">
          {games.length > 0
            ? `${games.length} verified OTB game${games.length === 1 ? "" : "s"} ready from ${job.request.fromYear <= FIDE_IMPORT_FALLBACK_YEAR ? "the full career" : `since ${job.request.fromYear}`}. ${openedInPrep ? "Saved to your imported games." : "Saving your games…"}`
            : "The PC search completed without any usable OTB games."}
        </Alert>
      ) : null}
      {error ? (
        <Alert className={classes.importError} color="red" variant="light">
          {error}
        </Alert>
      ) : null}

      {games.length > 0 ? (
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={700} size="xs">
              Imported OTB games
            </Text>
            <Badge variant="light">{games.length}</Badge>
          </Group>
          <ScrollArea.Autosize mah={420}>
            <Box className={classes.gameList}>
              {games.slice(0, visibleGames).map((game) => (
                <Box className={classes.gameCard} key={game.id}>
                  <Box className={classes.gameDetails}>
                    <Group gap={6} wrap="nowrap">
                      <Text fw={700} size="xs" truncate>
                        {game.white} – {game.black}
                      </Text>
                      <Badge size="xs" variant="light">
                        {game.result}
                      </Badge>
                    </Group>
                    <Text c="dimmed" size="0.68rem" truncate>
                      {formatOtbDate(game.date)} · {game.event}
                    </Text>
                  </Box>
                  <Button
                    loading={analyzingId === game.id}
                    onClick={() => void analyze(game)}
                    size="compact-xs"
                    variant="light"
                  >
                    Analyze
                  </Button>
                </Box>
              ))}
            </Box>
          </ScrollArea.Autosize>
          {games.length > visibleGames && (
            <Button variant="light" onClick={() => setVisibleGames((n) => n + 20)}>
              Show more games
            </Button>
          )}
        </Stack>
      ) : null}
    </Stack>
  );
}

function SourceCheckbox({
  source,
  label,
  detail,
  sources,
  setSources,
  disabled,
}: {
  source: keyof WebOtbImportSources;
  label: string;
  detail: string;
  sources: WebOtbImportSources;
  setSources: Dispatch<SetStateAction<WebOtbImportSources>>;
  disabled: boolean;
}) {
  return (
    <Checkbox
      checked={sources[source]}
      description={detail}
      disabled={disabled}
      label={label}
      onChange={(event) =>
        setSources((current) => ({ ...current, [source]: event.currentTarget.checked }))
      }
    />
  );
}

function formatOtbDate(value: string) {
  return value ? value.replace(/\./g, "-").replace(/\?+/g, "") : "Date unavailable";
}

function useStoredString(key: string) {
  const [value, setValue] = useState(() => window.localStorage.getItem(key) ?? "");
  useEffect(() => {
    if (value.trim()) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  }, [key, value]);
  return [value, setValue] as const;
}
