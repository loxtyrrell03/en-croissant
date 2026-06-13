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
  Select,
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
};

type BlindfoldTrainingPanelProps = {
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
  savedGames: BlindfoldSavedGame[];
  activeSavedGameId: string | null;
  onRevealBoard: () => void;
  onHideBoard: () => void;
  onPlayMove: (uci: string) => void | Promise<void>;
  onToggleLostTrack: () => void;
  onGoToMark: (path: number[]) => void;
  onPlayFromCurrentPosition: () => void | Promise<void>;
  onSaveGameToFile: () => void | Promise<void>;
  onLoadSavedGame: (id: string) => void | Promise<void>;
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

function humanColor(players: BlindfoldTrainingPanelProps["players"]): PlayerColor | "turn" | null {
  if (players.white.type === "human" && players.black.type !== "human") return "white";
  if (players.black.type === "human" && players.white.type !== "human") return "black";
  if (players.white.type === "human" && players.black.type === "human") return "turn";
  return null;
}

function botLabel(players: BlindfoldTrainingPanelProps["players"]) {
  const engine = players.white.type === "engine" ? players.white : players.black;
  if (engine.type !== "engine") return "Maia";
  return engine.botProfile ? formatPracticeBotName(engine.botProfile, engine.timeControl) : "Maia";
}

function moveNumberFromFen(fen: string) {
  const parts = fen.trim().split(/\s+/);
  const fullMove = Number(parts[5]) || 1;
  return `${fullMove}${parts[1] === "b" ? "..." : "."}`;
}

function savedGameOptions(savedGames: BlindfoldSavedGame[]) {
  return savedGames.map((game) => ({
    value: game.id,
    label: game.title,
    description: `${game.moveCount} ply - ${game.result} - ${new Date(
      game.updatedAt,
    ).toLocaleString()}`,
  }));
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
}: BlindfoldMaiaSetupPanelProps) {
  const [settings, setSettings] = useAtom(currentBlindfoldGameSettingsAtom);
  const [fenInput, setFenInput] = useState(currentFen);
  const [fenError, setFenError] = useState<string | null>(null);

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
              <Text fw={800}>Blindfold Maia</Text>
              <Text size="xs" c="dimmed">
                Maia {maiaLevelFromElo(maiaElo)}
              </Text>
            </Box>
            <Badge color={maiaReady ? "green" : "blue"} variant="light">
              {maiaReady ? "Maia ready" : maiaInstallLoading ? "Preparing Maia" : "Maia included"}
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

      <Paper withBorder p="md">
        <Stack gap="sm">
          <Text size="sm" fw={700}>
            Training surface
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

      <Paper withBorder p="md">
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            Games and positions
          </Text>
          <Select
            searchable
            clearable
            label="Blindfold games"
            placeholder={savedGames.length > 0 ? "Select a saved game" : "No saved games yet"}
            data={savedGameOptions(savedGames)}
            disabled={savedGames.length === 0}
            onChange={(value) => {
              if (value) void onLoadSavedGame(value);
            }}
          />
          <Group align="flex-end" grow>
            <TextInput
              label="Load position"
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
    </Stack>
  );
}

export function BlindfoldTrainingPanel({
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
  savedGames,
  activeSavedGameId,
  onRevealBoard,
  onHideBoard,
  onPlayMove,
  onToggleLostTrack,
  onGoToMark,
  onPlayFromCurrentPosition,
  onSaveGameToFile,
  onLoadSavedGame,
}: BlindfoldTrainingPanelProps) {
  const [settings, setSettings] = useAtom(currentBlindfoldGameSettingsAtom);
  const [manualInput, setManualInput] = useState("");
  const [displayedLastMove, setDisplayedLastMove] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
  const currentMark = marks.find((mark) => blindfoldPathKey(mark.path) === currentPathKey);
  const orderedMarks = useMemo(
    () => [...marks].sort((a, b) => a.ply - b.ply || a.createdAt - b.createdAt),
    [marks],
  );

  useEffect(() => {
    setManualInput("");
  }, [fen]);

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

  function appendToken(token: string) {
    setManualInput((current) => `${current}${token}`);
  }

  async function playMove(uci: string) {
    if (!canMove) return;
    setManualInput("");
    await onPlayMove(uci);
  }

  async function saveGameToFile() {
    setSaving(true);
    try {
      await onSaveGameToFile();
    } finally {
      setSaving(false);
    }
  }

  const submitManual = async () => {
    const move = findBlindfoldMove(fen, manualInput);
    if (!move) return;
    await playMove(move.uci);
  };

  return (
    <Stack h="100%" gap="sm">
      <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
        <Box style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={800}>Blindfold Maia</Text>
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

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
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

      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        {settings.moveInputMode === "legal" ? (
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              {legalMoves.length} legal move{legalMoves.length === 1 ? "" : "s"}
            </Text>
            <SimpleGrid cols={{ base: 3, sm: 4 }}>
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
        ) : (
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

            <SimpleGrid cols={6}>
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
            <SimpleGrid cols={8}>
              {FILE_TOKENS.map((token) => (
                <Button key={token} variant="default" onClick={() => appendToken(token)}>
                  {token}
                </Button>
              ))}
            </SimpleGrid>
            <SimpleGrid cols={8}>
              {RANK_TOKENS.map((token) => (
                <Button key={token} variant="default" onClick={() => appendToken(token)}>
                  {token}
                </Button>
              ))}
            </SimpleGrid>
            <SimpleGrid cols={5}>
              <Button variant="default" aria-label="Check" onClick={() => appendToken("+")}>
                +
              </Button>
              <Button variant="default" aria-label="Promotion" onClick={() => appendToken("=")}>
                =
              </Button>
              <Button variant="default" aria-label="Checkmate" onClick={() => appendToken("#")}>
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
        )}
      </ScrollArea>

      <Paper withBorder p="xs">
        <Stack gap={6}>
          <Select
            searchable
            clearable
            size="xs"
            label="Blindfold games"
            placeholder={savedGames.length > 0 ? "Revisit a saved game" : "No saved games yet"}
            data={savedGameOptions(savedGames)}
            value={activeSavedGameId}
            disabled={savedGames.length === 0}
            onChange={(value) => {
              if (value) void onLoadSavedGame(value);
            }}
          />

          {orderedMarks.length > 0 && (
            <>
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" fw={700}>
                  Lost-track positions
                </Text>
                <Badge size="sm" variant="light">
                  {orderedMarks.length}
                </Badge>
              </Group>
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
            </>
          )}
        </Stack>
      </Paper>

      {!currentLineAtEnd && (
        <Button variant="light" leftSection={<IconArrowBackUp size={16} />} disabled>
          Return to game end to move
        </Button>
      )}
    </Stack>
  );
}
