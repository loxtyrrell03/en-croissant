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
import { IconChevronDown, IconDeviceDesktop, IconSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { FidePlayerSearchInput } from "@/components/common/FidePlayerSearchInput";
import type { FidePlayer } from "@/utils/fidePlayer";
import {
  DEFAULT_WEB_OTB_IMPORT_SOURCES,
  getWebOtbImportedGames,
  loadWebOtbImportJob,
  searchWebFidePlayers,
  startWebOtbImport,
  type WebOtbImportedGame,
  type WebOtbImportJob,
  type WebOtbImportSources,
} from "./otbImport";
import classes from "./OnlineGameAnalysisPanel.module.css";

const WEB_OTB_JOB_KEY = "encroissant-web-otb-job";
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
  const [fromYear, setFromYear] = useState(Math.max(2020, currentYear - 2));
  const [sources, setSources] = useState<WebOtbImportSources>(DEFAULT_WEB_OTB_IMPORT_SOURCES);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [job, setJob] = useState<WebOtbImportJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const games = useMemo(() => (job ? getWebOtbImportedGames(job) : []), [job]);
  const running = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    const jobId = window.localStorage.getItem(WEB_OTB_JOB_KEY);
    if (!jobId) return;
    const controller = new AbortController();
    void loadWebOtbImportJob(jobId, controller.signal)
      .then(setJob)
      .catch(() => window.localStorage.removeItem(WEB_OTB_JOB_KEY));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!job?.id || !running) return;
    let active = true;
    let controller: AbortController | null = null;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      void loadWebOtbImportJob(job.id, controller.signal)
        .then((next) => {
          if (!active) return;
          setJob(next);
          if (next.status === "failed") setError(next.error || "The PC OTB import failed.");
        })
        .catch((loadError) => {
          if (active && !(loadError instanceof DOMException && loadError.name === "AbortError")) {
            setError(
              loadError instanceof Error ? loadError.message : "PC progress could not be loaded.",
            );
          }
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 1_500);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [job?.id, running]);

  function selectFidePlayer(player: FidePlayer) {
    setSelectedPlayer(player);
    setPlayerName(player.name);
    setFideId(String(player.id));
    setFideIdAuto(true);
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
    const lookup = /^\d+$/.test(name) ? name : /^\d{4,}$/.test(id) ? id : "";
    if (!selectedPlayer && lookup) {
      const player = (await searchWebFidePlayers(lookup)).find(
        (candidate) => String(candidate.id) === lookup,
      );
      if (player) {
        selectFidePlayer(player);
        name = player.name;
        id = String(player.id);
      }
    }
    return { name, id };
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
        fromYear,
        sources,
      });
      setJob(next);
      window.localStorage.setItem(WEB_OTB_JOB_KEY, next.id);
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

  const progress = job?.progress;
  const progressValue = progress?.total
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 100;

  return (
    <Stack gap="sm">
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
        value={playerName}
      />
      <Group align="flex-end" grow wrap="nowrap">
        <TextInput
          autoCapitalize="none"
          disabled={running}
          label="FIDE ID"
          placeholder="Autofilled"
          value={fideId}
          onBlur={() => void autofillFromFideId()}
          onChange={(event) => changeFideId(event.currentTarget.value)}
        />
        <NumberInput
          disabled={running}
          label="Since"
          max={currentYear}
          min={1900}
          value={fromYear}
          onChange={(value) => setFromYear(Number(value) || currentYear - 2)}
        />
      </Group>

      <Button
        justify="space-between"
        onClick={() => setAdvancedOpen((open) => !open)}
        rightSection={<IconChevronDown size={15} />}
        size="compact-sm"
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
            detail="ChessBase news, organiser archives, BritBase and PGN Mentor"
            disabled={running}
            label="Public OTB archives"
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
            detail="Scans large monthly Lichess dumps on the PC; slower first run"
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

      <Button
        disabled={!playerName.trim() || running}
        leftSection={<IconSearch size={16} />}
        loading={starting}
        onClick={() => void startSearch()}
      >
        Search OTB games on PC
      </Button>

      {running && progress ? (
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text c="dimmed" size="xs" truncate>
              {progress.message}
            </Text>
            <Badge variant="light">{progress.gamesFound} found</Badge>
          </Group>
          <Progress animated={!progress.total} size="xs" value={progressValue} />
        </Stack>
      ) : null}
      {job?.status === "completed" ? (
        <Alert color="green" variant="light">
          {games.length} verified OTB game{games.length === 1 ? "" : "s"} ready from the PC.
        </Alert>
      ) : null}
      {error ? (
        <Alert color="red" variant="light">
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
              {games.map((game) => (
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
