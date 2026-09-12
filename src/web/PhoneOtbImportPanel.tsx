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
import { useFideIdentityRequest } from "@/components/common/useFideIdentityRequest";
import { resolveFideImportIdentity } from "@/utils/fideImportIdentity";
import {
  FIDE_IMPORT_FALLBACK_YEAR,
  getFideImportStartYear,
  type FidePlayer,
} from "@/utils/fidePlayer";
import {
  DEFAULT_WEB_OTB_IMPORT_SOURCES,
  cancelWebOtbImport,
  getWebOtbImportedGames,
  getWebOtbProgressValue,
  searchWebFidePlayers,
  startWebOtbImport,
  watchWebOtbImportJob,
  WEB_OTB_JOB_STORAGE_KEY,
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
  const [resolvingIdentity, setResolvingIdentity] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const mounted = useRef(true);
  const stopRequest = useRef<symbol | null>(null);
  const analyzeRequest = useRef<symbol | null>(null);
  const currentJobId = useRef(jobId);
  const restoredIdentityId = useRef<string | null>(null);
  currentJobId.current = jobId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopRequest.current = null;
      analyzeRequest.current = null;
    };
  }, []);
  const fromYearManuallyEditedRef = useRef(false);
  const identityRequest = useFideIdentityRequest();
  const preflightRef = useRef(false);
  const games = useMemo(() => (job ? getWebOtbImportedGames(job) : []), [job]);
  const running = job?.status === "queued" || job?.status === "running";
  const restoring = Boolean(jobId && !job);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const unsubscribe = watchWebOtbImportJob(
      jobId,
      (next) => {
        if (!active || currentJobId.current !== next.id) return;
        if (restoredIdentityId.current !== next.id && next.request?.playerName) {
          restoredIdentityId.current = next.id;
          const id = String(next.request.fideId || "");
          setPlayerName(next.request.playerName);
          setFideId(id);
          setFideIdAuto(Boolean(id));
          setSelectedPlayer(
            /^\d+$/.test(id) ? { id: Number(id), name: next.request.playerName } : null,
          );
          setFromYear(next.request.fromYear);
          fromYearManuallyEditedRef.current = true;
        }
        setJob(next);
        setJobError(next.status === "failed" ? next.error || "The PC OTB import failed." : null);
      },
      (caught) => {
        if (active) {
          const message =
            caught instanceof Error ? caught.message : "The PC search could not be loaded.";
          setJobError(`${message} Retrying automatically…`);
        }
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [jobId, setPlayerName]);

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
    identityRequest.cancel();
    setError(null);
    setPlayerName(value);
    if (selectedPlayer && value.trim() !== selectedPlayer.name) clearSelectedPlayer();
  }

  function changeFideId(value: string) {
    identityRequest.cancel();
    setError(null);
    const clean = value.replace(/\D/g, "");
    setFideId(clean);
    setFideIdAuto(false);
    if (selectedPlayer && clean !== String(selectedPlayer.id)) setSelectedPlayer(null);
  }

  async function autofillFromFideId() {
    const id = fideId.trim();
    if (
      running ||
      preflightRef.current ||
      !/^\d{4,}$/.test(id) ||
      id === String(selectedPlayer?.id ?? "")
    )
      return;
    const controller = identityRequest.begin();
    try {
      const players = await searchWebFidePlayers(id, controller.signal);
      if (controller.signal.aborted) return;
      const player = players.find((candidate) => candidate.id === Number(id));
      if (player) selectFidePlayer(player);
      else setError("No player was found for that FIDE ID. Check the ID or search by full name.");
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : "FIDE lookup failed. Retry the search.");
    }
  }

  async function resolveIdentity(signal: AbortSignal) {
    const identity = await resolveFideImportIdentity(
      playerName,
      fideId,
      selectedPlayer,
      searchWebFidePlayers,
      signal,
    );
    if (signal.aborted) throw signal.reason;
    if (identity.player) selectFidePlayer(identity.player);
    const resolvedFromYear = getFideImportStartYear(
      identity.player,
      currentYear,
      fromYearManuallyEditedRef.current ? fromYear : null,
    );
    if (!fromYearManuallyEditedRef.current) setFromYear(resolvedFromYear);
    return { ...identity, fromYear: resolvedFromYear };
  }

  async function startSearch() {
    if (preflightRef.current || starting || running || restoring || stopRequest.current) return;
    preflightRef.current = true;
    const controller = identityRequest.begin();
    setStarting(true);
    setResolvingIdentity(true);
    setError(null);
    setJobError(null);
    try {
      const identity = await resolveIdentity(controller.signal);
      if (controller.signal.aborted) return;
      setResolvingIdentity(false);
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
      if (controller.signal.aborted) return;
      setError(
        startError instanceof Error ? startError.message : "The PC OTB search could not start.",
      );
    } finally {
      preflightRef.current = false;
      setStarting(false);
      setResolvingIdentity(false);
    }
  }

  async function analyze(game: WebOtbImportedGame) {
    if (analyzeRequest.current) return;
    const request = Symbol();
    analyzeRequest.current = request;
    setAnalyzingId(game.id);
    setError(null);
    try {
      await onAnalyzeGame(game);
    } catch (analysisError) {
      if (!mounted.current || analyzeRequest.current !== request) return;
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "This OTB game could not be opened for analysis.",
      );
    } finally {
      if (mounted.current && analyzeRequest.current === request) {
        analyzeRequest.current = null;
        setAnalyzingId(null);
      }
    }
  }

  async function stopSearch() {
    if (!job?.id || !running || stopRequest.current) return;
    const request = Symbol();
    const id = job.id;
    stopRequest.current = request;
    setStopping(true);
    setError(null);
    try {
      const next = await cancelWebOtbImport(id);
      if (!mounted.current || stopRequest.current !== request || currentJobId.current !== id)
        return;
      // Completion can win the race with Stop. Retain its ID so the shared
      // watcher and Prep handoff can still fetch the complete PC artifact.
      setJob((current) => (current?.id === id && current.status === "completed" ? current : next));
      setJobError(next.status === "failed" ? next.error || "The PC search stopped." : null);
    } catch (stopError) {
      if (!mounted.current || stopRequest.current !== request || currentJobId.current !== id)
        return;
      setError(stopError instanceof Error ? stopError.message : "The PC search could not stop.");
    } finally {
      if (mounted.current && stopRequest.current === request) {
        stopRequest.current = null;
        setStopping(false);
      }
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
        Your PC searches and saves these games. Keep it on until the search finishes.
      </Alert>
      {resolvingIdentity && (
        <Button variant="subtle" onClick={() => identityRequest.cancel()}>
          Stop FIDE search
        </Button>
      )}
      <FidePlayerSearchInput
        disabled={running || starting || restoring || stopping}
        label="Player full name"
        onChange={changePlayerName}
        onSelect={(player) => {
          identityRequest.cancel();
          selectFidePlayer(player);
        }}
        searchPlayers={searchWebFidePlayers}
        selected={selectedPlayer}
        mobileInline
        size="md"
        value={playerName}
      />
      <Box className={classes.identityFields}>
        <TextInput
          autoCapitalize="none"
          disabled={running || starting || restoring || stopping}
          inputMode="numeric"
          label="FIDE ID"
          placeholder="Autofilled"
          size="md"
          value={fideId}
          onBlur={() => void autofillFromFideId()}
          onChange={(event) => changeFideId(event.currentTarget.value)}
        />
        <NumberInput
          disabled={running || starting || restoring || stopping}
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
        className={classes.otbAction}
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
            disabled={running || starting || restoring || stopping}
            label="Targeted broadcasts"
            source="lichessBroadcasts"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Chess-Results player and event PGNs"
            disabled={running || starting || restoring || stopping}
            label="Chess-Results"
            source="chessResults"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Public tournament PGNs linked from ChessBase news coverage"
            disabled={running || starting || restoring || stopping}
            label="ChessBase news PGNs"
            source="chessbaseNews"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Organiser archives, BritBase and PGN Mentor"
            disabled={running || starting || restoring || stopping}
            label="Official public PGN indexes"
            source="officialPgnIndexes"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="The Week in Chess public PGNs"
            disabled={running || starting || restoring || stopping}
            label="TWIC"
            source="twic"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Searches indexed official monthly Lichess broadcasts"
            disabled={running || starting || restoring || stopping}
            label="Full Lichess archive"
            source="broadcastArchives"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Checks user-created Lichess broadcasts not covered elsewhere"
            disabled={running || starting || restoring || stopping}
            label="Community broadcasts"
            source="communityBroadcasts"
            sources={sources}
            setSources={setSources}
          />
        </Stack>
      </Collapse>

      {running ? (
        <Button
          className={classes.otbAction}
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
          className={classes.otbAction}
          disabled={!playerName.trim() || restoring || stopping}
          leftSection={<IconSearch size={16} />}
          loading={starting || restoring}
          onClick={() => void startSearch()}
          size="md"
        >
          Search OTB games on PC
        </Button>
      )}

      {restoring && (
        <Text role="status" size="sm">
          Checking the saved PC search…
        </Text>
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
      {job?.status === "completed" &&
      job.artifactAvailable &&
      !job.artifactLoaded &&
      games.length === 0 ? (
        <Text role="status" size="sm">
          Loading the saved games from your PC…
        </Text>
      ) : job?.status === "completed" ? (
        <Alert color={games.length > 0 ? "green" : "yellow"} variant="light">
          {games.length > 0
            ? `${games.length} verified OTB game${games.length === 1 ? "" : "s"} ready ${job.request.fromYear <= FIDE_IMPORT_FALLBACK_YEAR ? "from the full career" : `since ${job.request.fromYear}`}.`
            : "The PC search completed without any usable OTB games."}
        </Alert>
      ) : null}
      {error ? (
        <Alert className={classes.importError} color="red" variant="light">
          {error}
        </Alert>
      ) : null}
      {jobError ? (
        <Alert className={classes.importError} color="red" variant="light">
          {jobError}
        </Alert>
      ) : null}

      {games.length > 0 ? (
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={700} size="xs">
              OTB games ready
            </Text>
            <Badge variant="light">{games.length}</Badge>
          </Group>
          <ScrollArea.Autosize mah={420}>
            <Box className={classes.gameList}>
              {games.slice(0, visibleGames).map((game) => (
                <Box className={`${classes.gameCard} ${classes.otbGameCard}`} key={game.id}>
                  <Box className={classes.gameDetails}>
                    <Group gap={6} wrap="nowrap">
                      <Text fw={700} size="xs" style={{ overflowWrap: "anywhere" }}>
                        {game.white} – {game.black}
                      </Text>
                      <Badge size="xs" variant="light">
                        {game.result}
                      </Badge>
                    </Group>
                    <Text c="dimmed" size="xs" style={{ overflowWrap: "anywhere" }}>
                      {formatOtbDate(game.date)} · {game.event}
                    </Text>
                  </Box>
                  <Button
                    disabled={Boolean(analyzingId) && analyzingId !== game.id}
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
