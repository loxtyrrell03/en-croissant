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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
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
  watchWebOtbImportJob,
  refreshWebOtbImportJob,
  WebOtbJobNotFoundError,
  type WebOtbImportedGame,
  type WebOtbImportJob,
  type WebOtbImportSources,
} from "./otbImport";
import {
  beginWebOtbStart,
  getWebOtbStartSnapshot,
  getWebOtbSelectionVersion,
  retryWebOtbStart,
  subscribeWebOtbStart,
  reviewWebOtbSelection,
  setAsideWebOtbSelection,
  undoWebOtbSetAside,
  type WebOtbSelectionReview,
  type SavedOtbSearchDetails,
} from "./otbStartSession";
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
  const startSession = useSyncExternalStore(subscribeWebOtbStart, getWebOtbStartSnapshot);
  const jobId = startSession.ready ? startSession.jobId : null;
  const [observedJob, setJob] = useState<WebOtbImportJob | null>(null);
  const job =
    observedJob?.id === jobId
      ? observedJob
      : startSession.confirmed?.id === jobId
        ? startSession.confirmed
        : null;
  const pendingStart = Boolean(startSession.record && !startSession.record.accepted);
  const [starting, setStarting] = useState(false);
  const [resolvingIdentity, setResolvingIdentity] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [missingJobId, setMissingJobId] = useState<string | null>(null);
  const [readRetrying, setReadRetrying] = useState(false);
  const [selectionReview, setSelectionReview] = useState<WebOtbSelectionReview | null>(null);
  const form = useRef<HTMLDivElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  const reviewBack = useRef<HTMLButtonElement>(null);
  const reviewOpen = Boolean(selectionReview);
  const previousReviewOpen = useRef(false);
  useEffect(() => {
    if (reviewOpen) reviewBack.current?.focus();
    else if (previousReviewOpen.current) {
      if (reviewTrigger.current) reviewTrigger.current.focus();
      else form.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
    }
    previousReviewOpen.current = reviewOpen;
  }, [reviewOpen]);
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
  const missing = Boolean(jobId && missingJobId === jobId);
  const running = !missing && (job?.status === "queued" || job?.status === "running");
  const restoring = Boolean(jobId && !job && !missing);
  const formDisabled =
    running ||
    starting ||
    restoring ||
    stopping ||
    startSession.busy ||
    pendingStart ||
    missing ||
    reviewOpen ||
    !startSession.ready;

  useEffect(() => {
    const record = startSession.record;
    if (!record || restoredIdentityId.current === record.id) return;
    restoredIdentityId.current = record.id;
    const id = record.request.fideId || "";
    setPlayerName(record.request.playerName);
    setFideId(id);
    setFideIdAuto(Boolean(id));
    setSelectedPlayer(id ? { id: Number(id), name: record.request.playerName } : null);
    setFromYear(record.request.fromYear);
    setSources(record.request.sources);
    fromYearManuallyEditedRef.current = true;
  }, [startSession.record, setPlayerName]);

  useEffect(() => {
    setJobError(null);
    setMissingJobId(null);
    setReadRetrying(false);
    setSelectionReview(null);
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
        setMissingJobId(null);
        setReadRetrying(false);
        setSelectionReview((review) => (review?.missingJobId === next.id ? null : review));
        setJobError(next.status === "failed" ? next.error || "The PC OTB import failed." : null);
      },
      (caught) => {
        if (active && currentJobId.current === jobId) {
          const message =
            caught instanceof Error ? caught.message : "The PC search could not be loaded.";
          const notFound = caught instanceof WebOtbJobNotFoundError && caught.jobId === jobId;
          setMissingJobId(notFound ? jobId : null);
          setReadRetrying(false);
          setJobError(notFound ? message : `${message} Retrying automatically…`);
        }
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [jobId, setPlayerName]);

  function reviewSelection() {
    identityRequest.cancel();
    try {
      setSelectionReview(reviewWebOtbSelection(missing ? jobId : null));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The saved search could not be reviewed.",
      );
    }
  }

  async function confirmSetAside() {
    if (!selectionReview || startSession.busy) return;
    await setAsideWebOtbSelection(selectionReview);
    if (mounted.current && !getWebOtbStartSnapshot().error) setSelectionReview(null);
  }

  function retryJob() {
    if (!jobId || readRetrying) return;
    setReadRetrying(true);
    setJobError(null);
    refreshWebOtbImportJob(jobId);
  }

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
    if (preflightRef.current || formDisabled || stopRequest.current) return;
    preflightRef.current = true;
    const controller = identityRequest.begin();
    setStarting(true);
    setResolvingIdentity(true);
    setError(null);
    setJobError(null);
    try {
      const selectionVersion = getWebOtbSelectionVersion();
      const identity = await resolveIdentity(controller.signal);
      if (controller.signal.aborted) return;
      setResolvingIdentity(false);
      await beginWebOtbStart(
        {
          playerName: identity.name,
          fideId: identity.id,
          fromYear: identity.fromYear,
          sources,
        },
        jobId,
        selectionVersion,
      );
    } catch (startError) {
      if (controller.signal.aborted || !mounted.current) return;
      setError(
        startError instanceof Error ? startError.message : "The PC OTB search could not start.",
      );
    } finally {
      preflightRef.current = false;
      if (mounted.current) {
        setStarting(false);
        setResolvingIdentity(false);
      }
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
    <Stack ref={form} className={classes.otbForm} gap="sm">
      <Alert color="blue" icon={<IconDeviceDesktop size={17} />} variant="light">
        Your PC searches and saves these games. Keep it on until the search finishes.
      </Alert>
      {resolvingIdentity && (
        <Button variant="subtle" onClick={() => identityRequest.cancel()}>
          Stop FIDE search
        </Button>
      )}
      <FidePlayerSearchInput
        disabled={formDisabled}
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
          disabled={formDisabled}
          inputMode="numeric"
          label="FIDE ID"
          placeholder="Autofilled"
          size="md"
          value={fideId}
          onBlur={() => void autofillFromFideId()}
          onChange={(event) => changeFideId(event.currentTarget.value)}
        />
        <NumberInput
          disabled={formDisabled}
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
            disabled={formDisabled}
            label="Targeted broadcasts"
            source="lichessBroadcasts"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Chess-Results player and event PGNs"
            disabled={formDisabled}
            label="Chess-Results"
            source="chessResults"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Public tournament PGNs linked from ChessBase news coverage"
            disabled={formDisabled}
            label="ChessBase news PGNs"
            source="chessbaseNews"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Organiser archives, BritBase and PGN Mentor"
            disabled={formDisabled}
            label="Official public PGN indexes"
            source="officialPgnIndexes"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="The Week in Chess public PGNs"
            disabled={formDisabled}
            label="TWIC"
            source="twic"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Searches indexed official monthly Lichess broadcasts"
            disabled={formDisabled}
            label="Full Lichess archive"
            source="broadcastArchives"
            sources={sources}
            setSources={setSources}
          />
          <SourceCheckbox
            detail="Checks user-created Lichess broadcasts not covered elsewhere"
            disabled={formDisabled}
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
      ) : pendingStart ? null : (
        <Button
          className={classes.otbAction}
          disabled={!playerName.trim() || formDisabled}
          leftSection={<IconSearch size={16} />}
          loading={starting || startSession.busy || (restoring && !jobError)}
          onClick={() => void startSearch()}
          size="md"
        >
          Search OTB games on PC
        </Button>
      )}

      {!selectionReview && (pendingStart || startSession.error || !startSession.ready) && (
        <Stack gap="xs">
          {startSession.error ? (
            <Alert className={classes.importError} color="red" variant="light">
              {startSession.error}
            </Alert>
          ) : pendingStart && !startSession.busy ? (
            <Text role="status" size="sm">
              Reconnect to the saved PC search.
            </Text>
          ) : null}
          {(pendingStart ||
            !startSession.ready ||
            !startSession.errorAction ||
            startSession.errorAction === "connect") && (
            <Button
              className={classes.otbAction}
              variant="light"
              loading={startSession.busy}
              onClick={() => void retryWebOtbStart()}
            >
              {startSession.busy ? "Connecting to PC…" : "Retry connection"}
            </Button>
          )}

          {pendingStart && (
            <Text c="dimmed" size="xs">
              Retry reconnects to the same search.
            </Text>
          )}
        </Stack>
      )}

      {jobError || readRetrying ? (
        <Stack gap="xs">
          {jobError && (
            <Alert className={classes.importError} color="red" variant="light">
              {jobError}
            </Alert>
          )}
          {jobId && job?.status !== "failed" && (
            <Button
              className={classes.otbAction}
              variant="light"
              loading={readRetrying}
              disabled={startSession.busy}
              onClick={retryJob}
            >
              Retry loading
            </Button>
          )}
        </Stack>
      ) : null}
      {(missing || startSession.canSetAside) && !selectionReview && (
        <Button
          ref={reviewTrigger}
          className={classes.otbAction}
          variant="subtle"
          disabled={startSession.busy || readRetrying}
          onClick={reviewSelection}
        >
          Set aside search
        </Button>
      )}
      {selectionReview && (
        <Alert
          color="yellow"
          variant="light"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !startSession.busy) {
              event.preventDefault();
              setSelectionReview(null);
            }
          }}
        >
          <Stack gap="xs">
            {startSession.error && (
              <Text role="alert" c="red" size="sm">
                {startSession.error}
              </Text>
            )}
            <Text size="sm">
              This keeps a copy of the search details and leaves any PC search running. Games
              already imported stay available.
            </Text>
            <Button
              className={classes.otbAction}
              loading={startSession.busy}
              onClick={() => void confirmSetAside()}
            >
              Keep details and continue
            </Button>
            <Button
              ref={reviewBack}
              variant="subtle"
              disabled={startSession.busy}
              onClick={() => setSelectionReview(null)}
            >
              Back
            </Button>
          </Stack>
        </Alert>
      )}
      {startSession.previousSearches.length > 0 && (
        <Stack gap="xs">
          {!startSession.record && !jobId && startSession.ready && (
            <Button
              variant="subtle"
              className={classes.otbAction}
              loading={startSession.busy}
              onClick={() => void undoWebOtbSetAside(startSession.previousSearches.at(-1)!.id)}
            >
              Undo set aside
            </Button>
          )}
          <details>
            <summary style={{ cursor: "pointer" }}>
              Kept search details ({startSession.previousSearches.length})
            </summary>
            <Stack gap="xs" mt="xs">
              {startSession.previousSearches.map((details) => (
                <Group key={details.id} justify="space-between" wrap="wrap">
                  <Text size="xs">Saved {new Date(details.savedAt).toLocaleString()}</Text>
                  <Button variant="subtle" onClick={() => downloadSearchDetails(details)}>
                    Download details
                  </Button>
                </Group>
              ))}
            </Stack>
          </details>
        </Stack>
      )}
      {restoring && !jobError && (
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
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    // This is only a name preference. The complete search request is persisted
    // separately and must succeed before a PC search is sent.
    try {
      if (value.trim()) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      /* optional preference */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function downloadSearchDetails(details: SavedOtbSearchDetails) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(details, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pc-search-details-${details.id}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
