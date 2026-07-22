import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconArrowBackUp,
  IconBackspace,
  IconChevronDown,
  IconChevronRight,
  IconDeviceFloppy,
  IconEye,
  IconEyeClosed,
  IconFlag,
  IconPlayerPlay,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Chessground } from "@/chessground/Chessground";
import type { OpponentSettings } from "@/components/boards/OpponentForm";
import {
  currentBlindfoldGameSettingsAtom,
  type BlindfoldLostTrackMark,
  type BlindfoldSavedGame,
} from "@/state/atoms";
import { parsePGN } from "@/utils/chess";
import { blindfoldPathKey } from "@/utils/blindfoldGameLibrary";
import {
  findBlindfoldMove,
  getBlindfoldLegalMoves,
  getBlindfoldMoveInputStatus,
} from "@/utils/blindfoldTraining";
import { formatPracticeBotName, maiaLevelFromElo } from "@/utils/practiceBot";
import { treeIteratorMainLine } from "@/utils/treeReducer";

type PlayerColor = "white" | "black";

type BlindfoldMaiaSetupPanelProps = {
  currentFen: string;
  playerColor: PlayerColor;
  maiaElo: number;
  maiaReady: boolean;
  maiaInstallLoading: boolean;
  maiaInstallError: string | null;
  savedGames: BlindfoldSavedGame[];
  onPlayerColorChange: (color: PlayerColor) => void;
  onMaiaEloChange: (elo: number) => void;
  onLoadFen: (fen: string) => boolean;
  onLoadSavedGame: (id: string) => void | Promise<void>;
  onDeleteSavedGame: (id: string) => void | Promise<void>;
};

type BlindfoldGamePanelProps = {
  fen: string;
  gameState: "playing" | "gameOver";
  players: {
    white: OpponentSettings;
    black: OpponentSettings;
  };
  currentLineAtEnd: boolean;
  boardHidden: boolean;
  boardRevealed: boolean;
  canRevealBoard: boolean;
  canTakeBack: boolean;
  lastMoveSan: string | null;
  marks: BlindfoldLostTrackMark[];
  currentPath: number[];
  onRevealBoard: () => void;
  onHideBoard: () => void;
  onToggleLostTrack: () => void;
  onPlayFromCurrentPosition: () => void | Promise<void>;
  onSaveGameToFile: () => void | Promise<void>;
  onExitGame: () => void | Promise<void>;
  onTakeBack: () => void | Promise<void>;
  onPlayMove: (uci: string) => void | Promise<void>;
  onGoToMark: (path: number[]) => void;
};

type BlindfoldMovePanelProps = {
  fen: string;
  gameState: "playing" | "gameOver";
  players: {
    white: OpponentSettings;
    black: OpponentSettings;
  };
  currentLineAtEnd: boolean;
  marks: BlindfoldLostTrackMark[];
  currentPath: number[];
  onPlayMove: (uci: string) => void | Promise<void>;
  onGoToMark: (path: number[]) => void;
  framed?: boolean;
};

type BlindfoldLibraryPreviewMove = {
  ply: number;
  halfMoves: number;
  san: string;
  fen: string;
};

type BlindfoldLibraryPreview = {
  startFen: string;
  white: string;
  black: string;
  event: string;
  opening: string;
  moves: BlindfoldLibraryPreviewMove[];
};

type BlindfoldLibraryPreviewState =
  | { status: "idle" | "loading" }
  | { status: "ready"; preview: BlindfoldLibraryPreview }
  | { status: "error"; message: string };

const PIECE_TOKENS = [
  { label: "K", aria: "King" },
  { label: "Q", aria: "Queen" },
  { label: "R", aria: "Rook" },
  { label: "B", aria: "Bishop" },
  { label: "N", aria: "Knight" },
] as const;

const FILE_TOKENS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANK_TOKENS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

function activeColorFromFen(fen: string): PlayerColor {
  return fen.split(/\s+/)[1] === "b" ? "black" : "white";
}

function humanColor(players: BlindfoldGamePanelProps["players"]): PlayerColor | "turn" | null {
  if (players.white.type === "human" && players.black.type !== "human") return "white";
  if (players.black.type === "human" && players.white.type !== "human") return "black";
  if (players.white.type === "human" && players.black.type === "human") return "turn";
  return null;
}

function botLabel(players: BlindfoldGamePanelProps["players"]) {
  const engine = players.white.type === "engine" ? players.white : players.black;
  if (engine.type !== "engine") return "Maia";
  return engine.botProfile ? formatPracticeBotName(engine.botProfile, engine.timeControl) : "Maia";
}

function moveNumberFromFen(fen: string) {
  const parts = fen.trim().split(/\s+/);
  const fullMove = Number(parts[5]) || 1;
  return `${fullMove}${parts[1] === "b" ? "..." : "."}`;
}

function formatSavedGameTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function savedGameMoveLabel(moveCount: number) {
  const fullMoves = Math.ceil(moveCount / 2);
  return `${fullMoves} move${fullMoves === 1 ? "" : "s"}`;
}

function formatPreviewMoveLabel(move: BlindfoldLibraryPreviewMove) {
  const moveNumber = Math.ceil(move.halfMoves / 2);
  const separator = move.halfMoves % 2 === 0 ? "..." : ".";
  return `${moveNumber}${separator} ${move.san}`;
}

function getBlindfoldPreviewOrientation(game: BlindfoldSavedGame): PlayerColor {
  return game.humanColor ?? "white";
}

function BlindfoldSavedGamePreview({
  game,
  previewState,
  previewPly,
  onSetPreviewPly,
}: {
  game: BlindfoldSavedGame;
  previewState: BlindfoldLibraryPreviewState;
  previewPly: number;
  onSetPreviewPly: (ply: number) => void;
}) {
  if (previewState.status === "idle" || previewState.status === "loading") {
    return (
      <Box pt="xs" mt="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Group justify="center" py="md">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            Loading board preview...
          </Text>
        </Group>
      </Box>
    );
  }

  if (previewState.status === "error") {
    return (
      <Box pt="xs" mt="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Alert color="red" variant="light">
          Could not read this PGN: {previewState.message}
        </Alert>
      </Box>
    );
  }

  if (previewState.status !== "ready") return null;

  const { preview } = previewState;
  const clampedPly = Math.max(0, Math.min(previewPly, preview.moves.length));
  const activeFen = clampedPly === 0 ? preview.startFen : preview.moves[clampedPly - 1]?.fen;

  return (
    <Box pt="xs" mt="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
      <Group align="flex-start" gap="sm" wrap="wrap">
        <Box
          style={{
            flex: "0 1 210px",
            maxWidth: 210,
            minWidth: 160,
            width: "100%",
            borderRadius: 4,
            overflow: "hidden",
            boxShadow: "0 0 0 1px var(--mantine-color-default-border)",
          }}
        >
          <Chessground
            coordinates={false}
            viewOnly
            fen={activeFen ?? preview.startFen}
            orientation={getBlindfoldPreviewOrientation(game)}
          />
        </Box>

        <Stack gap="xs" style={{ flex: 1, minWidth: 220 }}>
          <Stack gap={2}>
            <Text size="sm" fw={700} truncate>
              {preview.opening}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {preview.white} vs {preview.black}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {preview.event}
            </Text>
          </Stack>

          {preview.moves.length === 0 ? (
            <Text size="xs" c="dimmed">
              No main-line moves were found in this PGN.
            </Text>
          ) : (
            <ScrollArea.Autosize mah={150}>
              <Group gap={4}>
                <Button
                  size="compact-xs"
                  variant={clampedPly === 0 ? "filled" : "light"}
                  onClick={() => onSetPreviewPly(0)}
                >
                  Start
                </Button>
                {preview.moves.map((move) => (
                  <Button
                    key={move.ply}
                    size="compact-xs"
                    variant={clampedPly === move.ply ? "filled" : "light"}
                    onClick={() => onSetPreviewPly(move.ply)}
                  >
                    {formatPreviewMoveLabel(move)}
                  </Button>
                ))}
              </Group>
            </ScrollArea.Autosize>
          )}
        </Stack>
      </Group>
    </Box>
  );
}

export function BlindfoldMaiaSetupPanel({
  currentFen,
  playerColor,
  maiaElo,
  maiaReady,
  maiaInstallLoading,
  maiaInstallError,
  savedGames,
  onPlayerColorChange,
  onMaiaEloChange,
  onLoadFen,
  onLoadSavedGame,
  onDeleteSavedGame,
}: BlindfoldMaiaSetupPanelProps) {
  const [settings, setSettings] = useAtom(currentBlindfoldGameSettingsAtom);
  const [phase, setPhase] = useState<"settings" | "library" | "position">("settings");
  const [fenInput, setFenInput] = useState(currentFen);
  const [fenError, setFenError] = useState<string | null>(null);
  const [expandedGameIds, setExpandedGameIds] = useState<Set<string>>(() => new Set());
  const [previewByGameId, setPreviewByGameId] = useState<
    Record<string, BlindfoldLibraryPreviewState>
  >({});
  const [previewPlyByGameId, setPreviewPlyByGameId] = useState<Record<string, number>>({});
  const libraryGames = useMemo(
    () => [...savedGames].sort((a, b) => b.updatedAt - a.updatedAt),
    [savedGames],
  );

  useEffect(() => {
    setFenInput(currentFen);
  }, [currentFen]);

  useEffect(() => {
    const validIds = new Set(libraryGames.map((game) => game.id));
    setExpandedGameIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setPreviewByGameId((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id))),
    );
    setPreviewPlyByGameId((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id))),
    );
  }, [libraryGames]);

  const ensurePreview = useCallback(
    async (game: BlindfoldSavedGame) => {
      const existingPreview = previewByGameId[game.id];
      if (existingPreview?.status === "loading" || existingPreview?.status === "ready") return;

      setPreviewByGameId((current) => {
        const currentPreview = current[game.id];
        if (currentPreview?.status === "loading" || currentPreview?.status === "ready") {
          return current;
        }
        return {
          ...current,
          [game.id]: { status: "loading" },
        };
      });

      try {
        const tree = await parsePGN(game.pgn, game.initialFen);
        const moves = [...treeIteratorMainLine(tree.root)]
          .filter((item) => item.node.san)
          .map((item, index) => ({
            ply: index + 1,
            halfMoves: item.node.halfMoves,
            san: item.node.san!,
            fen: item.node.fen,
          }));
        const preview: BlindfoldLibraryPreview = {
          startFen: tree.root.fen,
          white: tree.headers.white || game.white || "White",
          black: tree.headers.black || game.black || "Black",
          event: tree.headers.event || game.title,
          opening: tree.headers.other?.Opening || tree.headers.eco || "Blindfold game",
          moves,
        };

        setPreviewByGameId((current) => ({
          ...current,
          [game.id]: { status: "ready", preview },
        }));
      } catch (error) {
        setPreviewByGameId((current) => ({
          ...current,
          [game.id]: {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        }));
      }
    },
    [previewByGameId],
  );

  function toggleExpanded(game: BlindfoldSavedGame) {
    const willExpand = !expandedGameIds.has(game.id);

    setExpandedGameIds((current) => {
      const next = new Set(current);
      if (next.has(game.id)) {
        next.delete(game.id);
      } else {
        next.add(game.id);
      }
      return next;
    });

    if (willExpand) {
      setPreviewPlyByGameId((current) => ({
        ...current,
        [game.id]: current[game.id] ?? 0,
      }));
      void ensurePreview(game);
    }
  }

  function setPreviewPly(gameId: string, ply: number) {
    setPreviewPlyByGameId((current) => ({
      ...current,
      [gameId]: ply,
    }));
  }

  function loadFen() {
    const fen = fenInput.trim();
    if (!fen) return;
    if (onLoadFen(fen)) {
      setFenError(null);
    } else {
      setFenError("That FEN could not be loaded.");
    }
  }

  return (
    <Stack gap="sm">
      <Paper withBorder p="md">
        <Stack gap="md">
          <Group justify="space-between" gap="sm" align="flex-start">
            <Box>
              <Text fw={800}>Blindfold</Text>
              <Text size="xs" c="dimmed">
                Maia {maiaLevelFromElo(maiaElo)}
              </Text>
            </Box>
            <Badge color={maiaReady ? "green" : "blue"} variant="light">
              {maiaReady ? "Ready" : maiaInstallLoading ? "Preparing" : "Included"}
            </Badge>
          </Group>

          <SegmentedControl
            fullWidth
            value={playerColor}
            onChange={(value) => onPlayerColorChange(value as PlayerColor)}
            data={[
              { value: "white", label: "Play white" },
              { value: "black", label: "Play black" },
            ]}
          />

          <NumberInput
            label="Maia level"
            min={1100}
            max={1900}
            step={100}
            value={maiaElo}
            onChange={(value) => {
              if (typeof value === "number") onMaiaEloChange(maiaLevelFromElo(value));
            }}
          />

          {maiaInstallError && (
            <Alert color="red" variant="light">
              {maiaInstallError}. Starting the game will retry.
            </Alert>
          )}
        </Stack>
      </Paper>

      <SegmentedControl
        fullWidth
        value={phase}
        onChange={(value) => setPhase(value as "settings" | "library" | "position")}
        data={[
          { value: "settings", label: "Settings" },
          { value: "library", label: "Library" },
          { value: "position", label: "Position" },
        ]}
      />

      {phase === "settings" && (
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Text size="sm" fw={700}>
              Settings
            </Text>

            <SegmentedControl
              value={settings.moveInputMode}
              onChange={(value) =>
                setSettings((current) => ({
                  ...current,
                  moveInputMode: value as "legal" | "manual",
                }))
              }
              data={[
                { value: "legal", label: "Legal moves" },
                { value: "manual", label: "Manual SAN" },
              ]}
            />
            <Group grow align="flex-start">
              <Switch
                label="Hide board"
                checked={settings.hideBoard}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    hideBoard: event.currentTarget.checked,
                  }))
                }
              />
              <Switch
                label="Allow peeking"
                checked={settings.allowPeeking}
                disabled={!settings.hideBoard}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    allowPeeking: event.currentTarget.checked,
                  }))
                }
              />
            </Group>
            <Group grow>
              <Checkbox
                label="Highlight last move"
                checked={settings.highlightLastMove}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    highlightLastMove: event.currentTarget.checked,
                  }))
                }
              />
              <Checkbox
                label="Piece destinations"
                checked={settings.showPieceDestinations}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    showPieceDestinations: event.currentTarget.checked,
                  }))
                }
              />
            </Group>
          </Stack>
        </Paper>
      )}

      {phase === "library" && (
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Group justify="space-between" wrap="nowrap">
              <Box>
                <Text size="sm" fw={700}>
                  Game library
                </Text>
                <Text size="xs" c="dimmed">
                  Saved blindfold games and lost-track marks.
                </Text>
              </Box>
              <Badge variant="light">{libraryGames.length}</Badge>
            </Group>

            {libraryGames.length === 0 ? (
              <Text size="sm" c="dimmed">
                No saved games yet.
              </Text>
            ) : (
              <Stack gap="xs">
                {libraryGames.map((game) => {
                  const expanded = expandedGameIds.has(game.id);
                  const inProgress = game.result === "*";

                  return (
                    <Paper
                      key={game.id}
                      withBorder
                      p="sm"
                      onClick={() => toggleExpanded(game)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <Stack gap={6}>
                        <Group justify="space-between" wrap="nowrap" align="flex-start">
                          <Box style={{ minWidth: 0 }}>
                            <Text size="sm" fw={700} truncate>
                              {game.title}
                            </Text>
                            <Text size="xs" c="dimmed" truncate>
                              {game.white} vs {game.black}
                            </Text>
                          </Box>
                          <Badge size="sm" color={inProgress ? "blue" : undefined} variant="light">
                            {inProgress ? "In progress" : game.result}
                          </Badge>
                        </Group>
                        <Group gap={6}>
                          <Badge size="sm" variant="default">
                            {savedGameMoveLabel(game.moveCount)}
                          </Badge>
                          <Badge
                            size="sm"
                            color={game.marks.length > 0 ? "yellow" : "gray"}
                            variant="light"
                          >
                            {game.marks.length} mark{game.marks.length === 1 ? "" : "s"}
                          </Badge>
                          {game.lastMoveSan && (
                            <Badge size="sm" variant="default">
                              Last {game.lastMoveSan}
                            </Badge>
                          )}
                        </Group>
                        <Group justify="space-between" wrap="nowrap">
                          <Text size="xs" c="dimmed">
                            {formatSavedGameTime(game.updatedAt)}
                          </Text>
                          <Group gap={6} wrap="nowrap">
                            <Button
                              size="xs"
                              variant="subtle"
                              aria-expanded={expanded}
                              leftSection={
                                expanded ? (
                                  <IconChevronDown size={14} />
                                ) : (
                                  <IconChevronRight size={14} />
                                )
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpanded(game);
                              }}
                            >
                              {expanded ? "Hide" : "Details"}
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={inProgress ? <IconPlayerPlay size={14} /> : undefined}
                              onClick={(event) => {
                                event.stopPropagation();
                                void onLoadSavedGame(game.id);
                              }}
                            >
                              {inProgress ? "Resume" : "Open"}
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              color="red"
                              leftSection={<IconTrash size={14} />}
                              onClick={(event) => {
                                event.stopPropagation();
                                void onDeleteSavedGame(game.id);
                              }}
                            >
                              Delete
                            </Button>
                          </Group>
                        </Group>
                        {expanded && (
                          <Box onClick={(event) => event.stopPropagation()}>
                            <BlindfoldSavedGamePreview
                              game={game}
                              previewState={previewByGameId[game.id] ?? { status: "idle" }}
                              previewPly={previewPlyByGameId[game.id] ?? 0}
                              onSetPreviewPly={(ply) => setPreviewPly(game.id, ply)}
                            />
                          </Box>
                        )}
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </Stack>
        </Paper>
      )}

      {phase === "position" && (
        <Paper withBorder p="md">
          <Stack gap="xs">
            <Text size="sm" fw={700}>
              Load position
            </Text>
            <Group align="flex-end" grow>
              <TextInput
                label="FEN"
                placeholder="Paste FEN"
                value={fenInput}
                error={fenError}
                onChange={(event) => setFenInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") loadFen();
                }}
              />
              <Button variant="default" onClick={loadFen}>
                Load FEN
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

export function BlindfoldGamePanel({
  fen,
  gameState,
  players,
  currentLineAtEnd,
  boardHidden,
  boardRevealed,
  canRevealBoard,
  canTakeBack,
  lastMoveSan,
  marks,
  currentPath,
  onRevealBoard,
  onHideBoard,
  onToggleLostTrack,
  onPlayFromCurrentPosition,
  onSaveGameToFile,
  onExitGame,
  onTakeBack,
  onPlayMove,
  onGoToMark,
}: BlindfoldGamePanelProps) {
  const [saving, setSaving] = useState(false);
  const [takingBack, setTakingBack] = useState(false);
  const turn = activeColorFromFen(fen);
  const engineName = botLabel(players);
  const currentPathKey = blindfoldPathKey(currentPath);
  const currentMark = marks.find((mark) => blindfoldPathKey(mark.path) === currentPathKey);

  async function saveGameToFile() {
    setSaving(true);
    try {
      await onSaveGameToFile();
    } finally {
      setSaving(false);
    }
  }

  async function takeBack() {
    if (!canTakeBack || !currentLineAtEnd) return;
    setTakingBack(true);
    try {
      await onTakeBack();
    } finally {
      setTakingBack(false);
    }
  }

  return (
    <Stack h="100%" gap="sm" style={{ minHeight: 0, overflow: "hidden" }}>
      <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
        <Box style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={800}>Blindfold</Text>
            <Badge variant="light">{botLabel(players)}</Badge>
            {currentMark && (
              <Badge color="yellow" variant="light">
                Lost track
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {moveNumberFromFen(fen)} {turn === "white" ? "White" : "Black"} to move
          </Text>
        </Box>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <Button
          size="xs"
          variant={currentMark ? "filled" : "light"}
          color={currentMark ? "yellow" : "gray"}
          leftSection={<IconFlag size={14} />}
          onClick={onToggleLostTrack}
        >
          {currentMark ? "Marked" : "Lost track"}
        </Button>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconDeviceFloppy size={14} />}
          loading={saving}
          onClick={() => void saveGameToFile()}
        >
          Save PGN
        </Button>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconPlayerPlay size={14} />}
          onClick={onPlayFromCurrentPosition}
        >
          Play here
        </Button>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconArrowBackUp size={14} />}
          disabled={!canTakeBack || !currentLineAtEnd}
          loading={takingBack}
          onClick={() => void takeBack()}
        >
          Take back
        </Button>
        <Button
          size="xs"
          variant={boardHidden ? "light" : "default"}
          leftSection={boardHidden ? <IconEye size={14} /> : <IconEyeClosed size={14} />}
          disabled={(!canRevealBoard && boardHidden) || (!boardHidden && !boardRevealed)}
          onClick={boardHidden ? onRevealBoard : onHideBoard}
        >
          {boardHidden ? "Reveal" : boardRevealed ? "Hide" : "Visible"}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="red"
          leftSection={<IconX size={14} />}
          onClick={() => void onExitGame()}
        >
          Exit
        </Button>
      </SimpleGrid>

      {lastMoveSan && (
        <Paper
          withBorder
          p="sm"
          radius="sm"
          role="status"
          aria-live="polite"
          style={{
            borderColor: "var(--mantine-color-blue-4)",
            background: "var(--mantine-color-blue-light)",
          }}
        >
          <Stack gap={2} align="center">
            <Text size="xs" fw={800} c="blue" tt="uppercase">
              {engineName} played
            </Text>
            <Text
              fw={900}
              ta="center"
              style={{
                fontSize: "1.5rem",
                lineHeight: 1,
                letterSpacing: 0,
                wordBreak: "break-word",
              }}
            >
              {lastMoveSan}
            </Text>
          </Stack>
        </Paper>
      )}

      <Divider />

      <Box style={{ flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
        <BlindfoldMovePanel
          fen={fen}
          gameState={gameState}
          players={players}
          currentLineAtEnd={currentLineAtEnd}
          marks={marks}
          currentPath={currentPath}
          onPlayMove={onPlayMove}
          onGoToMark={onGoToMark}
          framed={false}
        />
      </Box>
    </Stack>
  );
}

export function BlindfoldMovePanel({
  fen,
  gameState,
  players,
  currentLineAtEnd,
  marks,
  currentPath,
  onPlayMove,
  onGoToMark,
  framed = true,
}: BlindfoldMovePanelProps) {
  const [settings, setSettings] = useAtom(currentBlindfoldGameSettingsAtom);
  const [phase, setPhase] = useState<"moves" | "marks">("moves");
  const [manualInput, setManualInput] = useState("");
  const turn = activeColorFromFen(fen);
  const legalMoves = useMemo(() => getBlindfoldLegalMoves(fen), [fen]);
  const manualStatus = useMemo(
    () => getBlindfoldMoveInputStatus(fen, manualInput),
    [fen, manualInput],
  );
  const playerColor = humanColor(players);
  const canMove =
    gameState === "playing" && currentLineAtEnd && (playerColor === "turn" || playerColor === turn);
  const waitingReason =
    gameState === "gameOver"
      ? "Game over"
      : !currentLineAtEnd
        ? "Go to the end of the game to move"
        : playerColor !== "turn" && playerColor !== turn
          ? `${botLabel(players)} to move`
          : null;
  const currentPathKey = blindfoldPathKey(currentPath);
  const orderedMarks = useMemo(
    () => [...marks].sort((a, b) => a.ply - b.ply || a.createdAt - b.createdAt),
    [marks],
  );

  useEffect(() => {
    setManualInput("");
  }, [fen]);

  function appendToken(token: string) {
    setManualInput((current) => `${current}${token}`);
  }

  async function playMove(uci: string) {
    if (!canMove) return;
    setManualInput("");
    await onPlayMove(uci);
  }

  const submitManual = async () => {
    const move = findBlindfoldMove(fen, manualInput);
    if (!move) return;
    await playMove(move.uci);
  };

  const content = (
    <Stack h="100%" gap="xs" style={{ minHeight: 0, overflow: "hidden" }}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Box style={{ minWidth: 0 }}>
          <Text size="sm" fw={800}>
            Moves
          </Text>
          <Text size="xs" c="dimmed">
            {moveNumberFromFen(fen)} {turn === "white" ? "White" : "Black"} to move
          </Text>
        </Box>
        <SegmentedControl
          size="xs"
          value={phase}
          onChange={(value) => setPhase(value as "moves" | "marks")}
          data={[
            { value: "moves", label: "Moves" },
            { value: "marks", label: "Marks" },
          ]}
        />
      </Group>

      {waitingReason && (
        <Alert color={gameState === "gameOver" ? "gray" : "yellow"} variant="light" py="xs">
          {waitingReason}
        </Alert>
      )}

      {settings.moveInputMode === "legal"
        ? phase === "moves" && (
            <>
              <SegmentedControl
                size="xs"
                value={settings.moveInputMode}
                onChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    moveInputMode: value as "legal" | "manual",
                  }))
                }
                data={[
                  { value: "legal", label: "Legal moves" },
                  { value: "manual", label: "Manual SAN" },
                ]}
              />

              <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars>
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    {legalMoves.length} legal move{legalMoves.length === 1 ? "" : "s"}
                  </Text>
                  <SimpleGrid cols={{ base: 3, sm: 5, lg: 6 }} spacing="xs">
                    {legalMoves.map((move) => (
                      <Button
                        key={move.uci}
                        size="xs"
                        variant="default"
                        disabled={!canMove}
                        onClick={() => void playMove(move.uci)}
                      >
                        {move.san}
                      </Button>
                    ))}
                  </SimpleGrid>
                </Stack>
              </ScrollArea>
            </>
          )
        : phase === "moves" && (
            <>
              <SegmentedControl
                size="xs"
                value={settings.moveInputMode}
                onChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    moveInputMode: value as "legal" | "manual",
                  }))
                }
                data={[
                  { value: "legal", label: "Legal moves" },
                  { value: "manual", label: "Manual SAN" },
                ]}
              />

              <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars>
                <Stack gap="xs">
                  <Paper withBorder p="xs">
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text fw={800} size="sm">
                        {manualInput || " "}
                      </Text>
                      <Badge
                        size="xs"
                        color={
                          manualStatus.kind === "legal"
                            ? "green"
                            : manualStatus.kind === "illegal"
                              ? "red"
                              : "gray"
                        }
                        variant="light"
                      >
                        {manualStatus.kind === "legal"
                          ? "Legal"
                          : manualStatus.kind === "illegal"
                            ? "No match"
                            : "Input"}
                      </Badge>
                    </Group>
                  </Paper>

                  <SimpleGrid cols={6} spacing="xs">
                    {PIECE_TOKENS.map((token) => (
                      <Button
                        key={token.label}
                        size="xs"
                        variant="default"
                        aria-label={token.aria}
                        onClick={() => appendToken(token.label)}
                      >
                        {token.label}
                      </Button>
                    ))}
                    <Button
                      size="xs"
                      variant="default"
                      aria-label="Capture"
                      onClick={() => appendToken("x")}
                    >
                      x
                    </Button>
                  </SimpleGrid>
                  <SimpleGrid cols={8} spacing="xs">
                    {FILE_TOKENS.map((token) => (
                      <Button
                        key={token}
                        size="xs"
                        variant="default"
                        onClick={() => appendToken(token)}
                      >
                        {token}
                      </Button>
                    ))}
                  </SimpleGrid>
                  <SimpleGrid cols={8} spacing="xs">
                    {RANK_TOKENS.map((token) => (
                      <Button
                        key={token}
                        size="xs"
                        variant="default"
                        onClick={() => appendToken(token)}
                      >
                        {token}
                      </Button>
                    ))}
                  </SimpleGrid>
                  <SimpleGrid cols={5} spacing="xs">
                    <Button
                      size="xs"
                      variant="default"
                      aria-label="Check"
                      onClick={() => appendToken("+")}
                    >
                      +
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      aria-label="Promotion"
                      onClick={() => appendToken("=")}
                    >
                      =
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      aria-label="Checkmate"
                      onClick={() => appendToken("#")}
                    >
                      #
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      aria-label="Kingside castling"
                      onClick={() => appendToken("O-O")}
                    >
                      O-O
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      aria-label="Queenside castling"
                      onClick={() => appendToken("O-O-O")}
                    >
                      O-O-O
                    </Button>
                  </SimpleGrid>

                </Stack>
              </ScrollArea>
              <Divider />
              <Group grow style={{ flexShrink: 0 }}>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconBackspace size={14} />}
                  onClick={() => setManualInput((current) => current.slice(0, -1))}
                >
                  Backspace
                </Button>
                <Button size="xs" variant="default" onClick={() => setManualInput("")}>
                  Clear
                </Button>
                <Button
                  size="xs"
                  disabled={!canMove || manualStatus.kind !== "legal"}
                  onClick={() => void submitManual()}
                >
                  Submit
                </Button>
              </Group>
            </>
          )}

      {phase === "marks" && (
        <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars>
          <Stack gap="xs">
            {orderedMarks.length === 0 ? (
              <Text size="xs" c="dimmed">
                No lost-track positions marked.
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={6}>
                {orderedMarks.map((mark) => (
                  <Button
                    key={mark.id}
                    size="xs"
                    variant={blindfoldPathKey(mark.path) === currentPathKey ? "light" : "default"}
                    justify="space-between"
                    rightSection={<IconArrowBackUp size={14} />}
                    onClick={() => onGoToMark(mark.path)}
                  >
                    {mark.label}
                  </Button>
                ))}
              </SimpleGrid>
            )}
          </Stack>
        </ScrollArea>
      )}

      {!currentLineAtEnd && phase === "moves" && (
        <Button
          size="xs"
          variant="light"
          leftSection={<IconArrowBackUp size={14} />}
          disabled
        >
          Return to game end to move
        </Button>
      )}
    </Stack>
  );

  if (!framed) return content;

  return (
    <Paper withBorder p="sm" h="100%" style={{ overflow: "hidden" }}>
      {content}
    </Paper>
  );
}
