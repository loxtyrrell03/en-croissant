import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
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
  IconDeviceFloppy,
  IconEye,
  IconEyeClosed,
  IconFlag,
  IconPlayerPlay,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import type { OpponentSettings } from "@/components/boards/OpponentForm";
import {
  currentBlindfoldGameSettingsAtom,
  type BlindfoldLostTrackMark,
  type BlindfoldSavedGame,
} from "@/state/atoms";
import { blindfoldPathKey } from "@/utils/blindfoldGameLibrary";
import {
  findBlindfoldMove,
  getBlindfoldLegalMoves,
  getBlindfoldMoveInputStatus,
} from "@/utils/blindfoldTraining";
import { formatPracticeBotName, maiaLevelFromElo } from "@/utils/practiceBot";

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
  lastMoveSan: string | null;
  marks: BlindfoldLostTrackMark[];
  currentPath: number[];
  onRevealBoard: () => void;
  onHideBoard: () => void;
  onToggleLostTrack: () => void;
  onPlayFromCurrentPosition: () => void | Promise<void>;
  onSaveGameToFile: () => void | Promise<void>;
  onExitGame: () => void | Promise<void>;
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
  const libraryGames = useMemo(
    () => [...savedGames].sort((a, b) => b.updatedAt - a.updatedAt),
    [savedGames],
  );

  useEffect(() => {
    setFenInput(currentFen);
  }, [currentFen]);

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
            <NumberInput
              label="AI move display time"
              min={0}
              max={15}
              step={1}
              value={Math.round(settings.aiMoveDisplayMs / 1000)}
              onChange={(value) =>
                setSettings((current) => ({
                  ...current,
                  aiMoveDisplayMs: Math.max(0, Math.min(15, Number(value) || 0)) * 1000,
                }))
              }
            />
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
                {libraryGames.map((game) => (
                  <Paper key={game.id} withBorder p="sm">
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
                        <Badge size="sm" variant="light">
                          {game.result}
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
                            variant="light"
                            onClick={() => void onLoadSavedGame(game.id)}
                          >
                            Open
                          </Button>
                          <Button
                            size="xs"
                            variant="subtle"
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => {
                              if (
                                window.confirm(`Delete "${game.title}" from the blindfold library?`)
                              ) {
                                void onDeleteSavedGame(game.id);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </Group>
                      </Group>
                    </Stack>
                  </Paper>
                ))}
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
  lastMoveSan,
  marks,
  currentPath,
  onRevealBoard,
  onHideBoard,
  onToggleLostTrack,
  onPlayFromCurrentPosition,
  onSaveGameToFile,
  onExitGame,
}: BlindfoldGamePanelProps) {
  const [settings] = useAtom(currentBlindfoldGameSettingsAtom);
  const [displayedLastMove, setDisplayedLastMove] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const turn = activeColorFromFen(fen);
  const playerColor = humanColor(players);
  const waitingReason =
    gameState === "gameOver"
      ? "Game over"
      : !currentLineAtEnd
        ? "Go to the end of the game to move"
        : playerColor !== "turn" && playerColor !== turn
          ? `${botLabel(players)} to move`
          : null;
  const currentPathKey = blindfoldPathKey(currentPath);
  const currentMark = marks.find((mark) => blindfoldPathKey(mark.path) === currentPathKey);

  useEffect(() => {
    if (!lastMoveSan || settings.aiMoveDisplayMs <= 0) {
      setDisplayedLastMove(null);
      return;
    }

    setDisplayedLastMove(lastMoveSan);
    const timeout = window.setTimeout(() => {
      setDisplayedLastMove(null);
    }, settings.aiMoveDisplayMs);
    return () => window.clearTimeout(timeout);
  }, [lastMoveSan, settings.aiMoveDisplayMs]);

  async function saveGameToFile() {
    setSaving(true);
    try {
      await onSaveGameToFile();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack h="100%" gap="sm">
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

      {displayedLastMove && (
        <Alert color="blue" variant="light" py="xs">
          Maia played {displayedLastMove}
        </Alert>
      )}

      {waitingReason && (
        <Alert color={gameState === "gameOver" ? "gray" : "yellow"} variant="light" py="xs">
          {waitingReason}
        </Alert>
      )}

      <Box style={{ flex: 1 }} />

      <Paper withBorder p="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" fw={700}>
            Lost-track positions
          </Text>
          <Badge size="sm" color={marks.length > 0 ? "yellow" : "gray"} variant="light">
            {marks.length}
          </Badge>
        </Group>
      </Paper>
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
    <Stack h="100%" gap="xs">
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

              <ScrollArea style={{ flex: 1 }} offsetScrollbars>
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    {legalMoves.length} legal move{legalMoves.length === 1 ? "" : "s"}
                  </Text>
                  <SimpleGrid cols={{ base: 3, sm: 5, lg: 6 }} spacing="xs">
                    {legalMoves.map((move) => (
                      <Button
                        key={move.uci}
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

              <ScrollArea style={{ flex: 1 }} offsetScrollbars>
                <Stack gap="xs">
                  <Paper withBorder p="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={800} size="lg">
                        {manualInput || " "}
                      </Text>
                      <Badge
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
                        variant="default"
                        aria-label={token.aria}
                        onClick={() => appendToken(token.label)}
                      >
                        {token.label}
                      </Button>
                    ))}
                    <Button variant="default" aria-label="Capture" onClick={() => appendToken("x")}>
                      x
                    </Button>
                  </SimpleGrid>
                  <SimpleGrid cols={8} spacing="xs">
                    {FILE_TOKENS.map((token) => (
                      <Button key={token} variant="default" onClick={() => appendToken(token)}>
                        {token}
                      </Button>
                    ))}
                  </SimpleGrid>
                  <SimpleGrid cols={8} spacing="xs">
                    {RANK_TOKENS.map((token) => (
                      <Button key={token} variant="default" onClick={() => appendToken(token)}>
                        {token}
                      </Button>
                    ))}
                  </SimpleGrid>
                  <SimpleGrid cols={5} spacing="xs">
                    <Button variant="default" aria-label="Check" onClick={() => appendToken("+")}>
                      +
                    </Button>
                    <Button
                      variant="default"
                      aria-label="Promotion"
                      onClick={() => appendToken("=")}
                    >
                      =
                    </Button>
                    <Button
                      variant="default"
                      aria-label="Checkmate"
                      onClick={() => appendToken("#")}
                    >
                      #
                    </Button>
                    <Button
                      variant="default"
                      aria-label="Kingside castling"
                      onClick={() => appendToken("O-O")}
                    >
                      O-O
                    </Button>
                    <Button
                      variant="default"
                      aria-label="Queenside castling"
                      onClick={() => appendToken("O-O-O")}
                    >
                      O-O-O
                    </Button>
                  </SimpleGrid>

                  <Divider />
                  <Group grow>
                    <Button
                      variant="default"
                      leftSection={<IconBackspace size={16} />}
                      onClick={() => setManualInput((current) => current.slice(0, -1))}
                    >
                      Backspace
                    </Button>
                    <Button variant="default" onClick={() => setManualInput("")}>
                      Clear
                    </Button>
                    <Button
                      disabled={!canMove || manualStatus.kind !== "legal"}
                      onClick={() => void submitManual()}
                    >
                      Submit
                    </Button>
                  </Group>
                </Stack>
              </ScrollArea>
            </>
          )}

      {phase === "marks" && (
        <ScrollArea style={{ flex: 1 }} offsetScrollbars>
          <Stack gap="xs">
            {orderedMarks.length === 0 ? (
              <Text size="sm" c="dimmed">
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
        <Button variant="light" leftSection={<IconArrowBackUp size={16} />} disabled>
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
