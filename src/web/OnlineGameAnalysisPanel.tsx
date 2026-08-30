import {
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconChess, IconChevronDown, IconCloudDownload, IconPlayerPlay } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  fetchWebOnlineGames,
  getWebOnlineSourceLabel,
  type WebOnlineImportedGame,
  type WebOnlineSource,
} from "./onlineImport";
import { getWebOnlineGameSummary } from "./onlineAnalysis";
import PhoneOtbImportPanel from "./PhoneOtbImportPanel";
import type { WebOtbImportedGame } from "./otbImport";
import classes from "./OnlineGameAnalysisPanel.module.css";

const WEB_ANALYSIS_SOURCE_KEY = "encroissant-web-analysis-source";
const WEB_ANALYSIS_CHESSCOM_USERNAME_KEY = "encroissant-web-analysis-chesscom-username";
const WEB_ANALYSIS_LICHESS_USERNAME_KEY = "encroissant-web-analysis-lichess-username";
const INITIAL_GAME_COUNT = 12;
const MAX_GAME_COUNT = 60;
type WebImportSource = WebOnlineSource | "otb";

export default function OnlineGameAnalysisPanel({
  onAnalyzeGame,
  onAnalyzeOtbGame,
}: {
  onAnalyzeGame: (game: WebOnlineImportedGame) => Promise<void>;
  onAnalyzeOtbGame: (game: WebOtbImportedGame) => Promise<void>;
}) {
  const [source, setSource] = useStoredImportSource();
  const [chessComUsername, setChessComUsername] = useStoredString(
    WEB_ANALYSIS_CHESSCOM_USERNAME_KEY,
  );
  const [lichessUsername, setLichessUsername] = useStoredString(WEB_ANALYSIS_LICHESS_USERNAME_KEY);
  const [games, setGames] = useState<WebOnlineImportedGame[]>([]);
  const [requestedCount, setRequestedCount] = useState(INITIAL_GAME_COUNT);
  const [loading, setLoading] = useState<"latest" | "list" | "more" | "game" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const username = source === "chesscom" ? chessComUsername : lichessUsername;
  const setUsername = source === "chesscom" ? setChessComUsername : setLichessUsername;

  useEffect(() => {
    setGames([]);
    setRequestedCount(INITIAL_GAME_COUNT);
    setProgress(null);
    setError(null);
  }, [source, username]);

  async function fetchGames(count: number, action: "latest" | "list" | "more") {
    if (source === "otb") return [];
    const trimmedUsername = username.trim();
    if (!trimmedUsername || loading) return [];

    setLoading(action);
    setError(null);
    setProgress(0);
    try {
      const importedGames = await fetchWebOnlineGames({
        source,
        username: trimmedUsername,
        mode: "count",
        count,
        range: "3m",
        onProgress: (loaded, expected) => {
          const total = expected && expected > 0 ? expected : count;
          setProgress(Math.min(100, Math.round((loaded / total) * 100)));
        },
      });
      if (importedGames.length === 0) {
        throw new Error(
          `${getWebOnlineSourceLabel(source)} did not return any public games for ${trimmedUsername}.`,
        );
      }
      setProgress(100);
      return importedGames;
    } catch (fetchError) {
      setProgress(null);
      setError(
        fetchError instanceof Error ? fetchError.message : "The recent games could not be loaded.",
      );
      return [];
    } finally {
      setLoading(null);
    }
  }

  async function analyzeLatestGame() {
    const importedGames = await fetchGames(1, "latest");
    const latestGame = importedGames[0];
    if (latestGame) await analyzeGame(latestGame);
  }

  async function chooseGame() {
    const importedGames = await fetchGames(INITIAL_GAME_COUNT, "list");
    if (importedGames.length > 0) {
      setRequestedCount(INITIAL_GAME_COUNT);
      setGames(importedGames);
    }
  }

  async function showMoreGames() {
    const nextCount = Math.min(MAX_GAME_COUNT, requestedCount + INITIAL_GAME_COUNT);
    const importedGames = await fetchGames(nextCount, "more");
    if (importedGames.length > 0) {
      setRequestedCount(nextCount);
      setGames(importedGames);
    }
  }

  async function analyzeGame(game: WebOnlineImportedGame) {
    if (loading) return;
    setLoading("game");
    setError(null);
    try {
      await onAnalyzeGame(game);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "This game could not be opened for analysis.",
      );
    } finally {
      setLoading(null);
    }
  }

  const isBusy = loading !== null;
  return (
    <Box className={classes.shell}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Box className={classes.introIcon}>
          <IconChess size={20} />
        </Box>
        <Box miw={0}>
          <Text fw={750} size="sm">
            Import a game
          </Text>
          <Text c="dimmed" size="xs">
            Load a public Chess.com, Lichess, or OTB game straight into the board and Stockfish.
          </Text>
        </Box>
      </Group>

      <SegmentedControl
        fullWidth
        size="xs"
        value={source}
        onChange={(value) => setSource(value as WebImportSource)}
        data={[
          { value: "chesscom", label: "Chess.com" },
          { value: "lichess", label: "Lichess" },
          { value: "otb", label: "OTB" },
        ]}
      />
      {source === "otb" ? (
        <PhoneOtbImportPanel onAnalyzeGame={onAnalyzeOtbGame} />
      ) : (
        <>
          <TextInput
            aria-label={`${getWebOnlineSourceLabel(source)} username`}
            autoCapitalize="none"
            autoCorrect="off"
            disabled={isBusy}
            label="Username"
            placeholder="Your username"
            size="sm"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void analyzeLatestGame();
            }}
          />

          <Box className={classes.actions}>
            <Button
              disabled={!username.trim()}
              leftSection={<IconPlayerPlay size={16} />}
              loading={loading === "latest" || loading === "game"}
              onClick={() => void analyzeLatestGame()}
            >
              Analyze last game
            </Button>
            <Button
              disabled={!username.trim()}
              leftSection={<IconCloudDownload size={16} />}
              loading={loading === "list"}
              onClick={() => void chooseGame()}
              variant="light"
            >
              Choose a game
            </Button>
          </Box>

          {progress !== null && isBusy ? <Progress animated size="xs" value={progress} /> : null}
          {error ? (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          ) : null}

          <Collapse in={games.length > 0}>
            <Stack gap="xs">
              <Group justify="space-between" gap="xs">
                <Text fw={700} size="xs">
                  Recent games
                </Text>
                <Badge variant="light">{games.length}</Badge>
              </Group>
              <ScrollArea.Autosize mah={420}>
                <Box className={classes.gameList}>
                  {games.map((game, index) => {
                    const summary = getWebOnlineGameSummary(game);
                    return (
                      <Box className={classes.gameCard} key={`${game.url}-${index}`}>
                        <Box className={classes.gameDetails}>
                          <Group gap={6} wrap="nowrap">
                            <Text fw={700} size="xs" truncate>
                              {summary.white} – {summary.black}
                            </Text>
                            <Badge size="xs" variant="light">
                              {summary.result}
                            </Badge>
                          </Group>
                          <Text c="dimmed" size="0.68rem" truncate>
                            {formatOnlineGameDate(game.playedAt)} · {summary.opening}
                          </Text>
                        </Box>
                        <Button
                          aria-label={`Analyze ${summary.white} against ${summary.black}`}
                          loading={loading === "game"}
                          onClick={() => void analyzeGame(game)}
                          size="compact-xs"
                          variant="light"
                        >
                          Analyze
                        </Button>
                      </Box>
                    );
                  })}
                </Box>
              </ScrollArea.Autosize>
              {games.length >= requestedCount && requestedCount < MAX_GAME_COUNT ? (
                <Button
                  fullWidth
                  leftSection={<IconChevronDown size={15} />}
                  loading={loading === "more"}
                  onClick={() => void showMoreGames()}
                  size="xs"
                  variant="subtle"
                >
                  Show more games
                </Button>
              ) : null}
            </Stack>
          </Collapse>
        </>
      )}
    </Box>
  );
}

function formatOnlineGameDate(value: number) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function useStoredImportSource() {
  const [source, setSource] = useState<WebImportSource>(() => {
    try {
      const stored = window.localStorage.getItem(WEB_ANALYSIS_SOURCE_KEY);
      return stored === "lichess" || stored === "otb" ? stored : "chesscom";
    } catch {
      return "chesscom";
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(WEB_ANALYSIS_SOURCE_KEY, source);
    } catch {
      // Remembering the source is a convenience; analysis still works without storage.
    }
  }, [source]);

  return [source, setSource] as const;
}

function useStoredString(key: string) {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    try {
      if (value.trim()) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      // Remembering the username is a convenience; analysis still works without storage.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
