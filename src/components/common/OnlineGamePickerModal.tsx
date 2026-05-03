import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  Radio,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronDown, IconChevronRight, IconRefresh, IconSettings } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Chessground } from "@/chessground/Chessground";
import { parsePGN } from "@/utils/chess";
import type { Session } from "@/utils/session";
import { treeIteratorMainLine } from "@/utils/treeReducer";
import {
  getLinkedOnlineGameProviders,
  getOnlineGameProviderKey,
  getRecentOnlineGames,
  getSelectedOnlineGameProviders,
  type LatestOnlineGameAccountSelection,
  type RecentOnlineGame,
} from "@/utils/onlineLatestGame";

type OnlineGamePickerModalProps = {
  opened: boolean;
  sessions: Session[];
  selection: LatestOnlineGameAccountSelection;
  title: string;
  description: string;
  confirmLabel: string;
  multiple?: boolean;
  loading?: boolean;
  maxGamesPerProvider?: number;
  children?: ReactNode;
  canConfirm?: boolean;
  onClose: () => void;
  onConfirm: (games: RecentOnlineGame[]) => void;
  onOpenAccounts: () => void;
  onOpenAccountSettings: () => void;
};

type OnlineProvider = RecentOnlineGame["source"];

type OnlineGamePreviewMove = {
  ply: number;
  halfMoves: number;
  san: string;
  fen: string;
};

type OnlineGamePreview = {
  startFen: string;
  white: string;
  black: string;
  event: string;
  opening: string;
  moves: OnlineGamePreviewMove[];
};

type OnlineGamePreviewState =
  | { status: "idle" | "loading" }
  | { status: "ready"; preview: OnlineGamePreview }
  | { status: "error"; message: string };

type OnlineGameRowDetails = {
  title: string;
  event: string;
  result: string;
};

const ONLINE_PROVIDERS: { value: OnlineProvider; label: string }[] = [
  { value: "lichess", label: "Lichess" },
  { value: "chesscom", label: "Chess.com" },
];

export default function OnlineGamePickerModal({
  opened,
  sessions,
  selection,
  title,
  description,
  confirmLabel,
  multiple = false,
  loading = false,
  maxGamesPerProvider = 12,
  children,
  canConfirm = true,
  onClose,
  onConfirm,
  onOpenAccounts,
  onOpenAccountSettings,
}: OnlineGamePickerModalProps) {
  const linkedProviders = useMemo(() => getLinkedOnlineGameProviders(sessions), [sessions]);
  const selectedProviders = useMemo(
    () => getSelectedOnlineGameProviders(sessions, selection),
    [selection, sessions],
  );
  const [games, setGames] = useState<RecentOnlineGame[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [activeProvider, setActiveProvider] = useState<OnlineProvider>("lichess");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [previewByGameId, setPreviewByGameId] = useState<Record<string, OnlineGamePreviewState>>(
    {},
  );
  const [previewPlyByGameId, setPreviewPlyByGameId] = useState<Record<string, number>>({});

  const selectedGames = useMemo(
    () => games.filter((game) => selectedIds.has(game.id)),
    [games, selectedIds],
  );
  const gamesByProvider = useMemo(
    () => ({
      lichess: games.filter((game) => game.source === "lichess"),
      chesscom: games.filter((game) => game.source === "chesscom"),
    }),
    [games],
  );
  const selectedProviderKey = useMemo(
    () => selectedProviders.map(getOnlineGameProviderKey).join("|"),
    [selectedProviders],
  );
  const providerAccountLabels = useMemo(() => {
    const labels: Record<OnlineProvider, string> = { lichess: "", chesscom: "" };

    for (const provider of selectedProviders) {
      labels[provider.source] = labels[provider.source]
        ? `${labels[provider.source]}, ${provider.username}`
        : provider.username;
    }

    return labels;
  }, [selectedProviders]);

  const loadGames = useCallback(async () => {
    if (!opened || selectedProviders.length === 0) return;

    setFetching(true);
    setFailures([]);
    try {
      const result = await getRecentOnlineGames(sessions, selection, maxGamesPerProvider);
      setGames(result.games);
      setFailures(result.failures);
      setSelectedIds((current) => {
        const validIds = new Set(result.games.map((game) => game.id));
        const kept = new Set([...current].filter((id) => validIds.has(id)));
        return kept.size === current.size ? current : kept;
      });
      setExpandedIds((current) => {
        const validIds = new Set(result.games.map((game) => game.id));
        const kept = new Set([...current].filter((id) => validIds.has(id)));
        return kept.size === current.size ? current : kept;
      });
      setPreviewByGameId((current) => {
        const validIds = new Set(result.games.map((game) => game.id));
        return Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id)));
      });
      setPreviewPlyByGameId((current) => {
        const validIds = new Set(result.games.map((game) => game.id));
        return Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id)));
      });
    } catch (error) {
      notifications.show({
        title: "Could not load online games",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setFetching(false);
    }
  }, [maxGamesPerProvider, opened, selectedProviders.length, selection, sessions]);

  useEffect(() => {
    if (!opened) {
      setSelectedIds(new Set());
      setExpandedIds(new Set());
      setPreviewByGameId({});
      setPreviewPlyByGameId({});
      return;
    }

    if (selectedProviders.length > 0) {
      void loadGames();
    } else {
      setGames([]);
      setFailures([]);
    }
  }, [loadGames, opened, selectedProviders.length]);

  useEffect(() => {
    if (!opened) return;

    setActiveProvider((current) => {
      if (selectedProviders.some((provider) => provider.source === current)) return current;
      return (
        selectedProviders.find((provider) => provider.source === "lichess")?.source ??
        selectedProviders[0]?.source ??
        "lichess"
      );
    });
  }, [opened, selectedProviderKey, selectedProviders]);

  const ensurePreview = useCallback(
    async (game: RecentOnlineGame) => {
      const existingPreview = previewByGameId[game.id];
      if (existingPreview?.status === "loading" || existingPreview?.status === "ready") return;

      setPreviewByGameId((current) => {
        const currentPreview = current[game.id];
        if (currentPreview?.status === "loading" || currentPreview?.status === "ready")
          return current;
        return {
          ...current,
          [game.id]: { status: "loading" },
        };
      });

      try {
        const tree = await parsePGN(game.pgn);
        const moves = [...treeIteratorMainLine(tree.root)]
          .filter((item) => item.node.san)
          .map((item, index) => ({
            ply: index + 1,
            halfMoves: item.node.halfMoves,
            san: item.node.san!,
            fen: item.node.fen,
          }));
        const preview: OnlineGamePreview = {
          startFen: tree.root.fen,
          white: tree.headers.white || getPgnHeader(game.pgn, "White") || "White",
          black: tree.headers.black || getPgnHeader(game.pgn, "Black") || "Black",
          event: tree.headers.event || getPgnHeader(game.pgn, "Event") || game.url,
          opening:
            tree.headers.other?.Opening ||
            tree.headers.eco ||
            getPgnHeader(game.pgn, "Opening") ||
            getPgnHeader(game.pgn, "ECO") ||
            "Opening not listed",
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

  function toggleGame(game: RecentOnlineGame, checked: boolean) {
    setSelectedIds((current) => {
      if (!multiple) return checked ? new Set([game.id]) : new Set();

      const next = new Set(current);
      if (checked) next.add(game.id);
      else next.delete(game.id);
      return next;
    });
  }

  function toggleExpanded(game: RecentOnlineGame) {
    const willExpand = !expandedIds.has(game.id);

    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(game.id)) {
        next.delete(game.id);
      } else {
        next.add(game.id);
      }
      return next;
    });

    if (willExpand) {
      setPreviewPlyByGameId((plyByGameId) => ({
        ...plyByGameId,
        [game.id]: plyByGameId[game.id] ?? 0,
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

  const emptyMessage =
    linkedProviders.length === 0
      ? "Link a Chess.com or Lichess account before choosing online games."
      : selectedProviders.length === 0
        ? "Choose at least one linked account for online-game shortcuts."
        : "No recent importable games were found for the selected accounts.";

  return (
    <Modal opened={opened} onClose={onClose} title={<b>{title}</b>} size="xl">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" gap="sm">
          <Text size="sm" c="dimmed" maw={620}>
            {description}
          </Text>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Refresh games">
              <ActionIcon
                aria-label="Refresh online games"
                variant="light"
                disabled={selectedProviders.length === 0}
                loading={fetching}
                onClick={() => void loadGames()}
              >
                <IconRefresh size="1rem" />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Account settings">
              <ActionIcon
                aria-label="Online game account settings"
                variant="light"
                onClick={onOpenAccountSettings}
              >
                <IconSettings size="1rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {linkedProviders.length === 0 || selectedProviders.length === 0 ? (
          <Alert color="yellow" variant="light">
            <Group justify="space-between" gap="sm">
              <Text size="sm">{emptyMessage}</Text>
              <Button size="xs" variant="light" onClick={onOpenAccounts}>
                Manage accounts
              </Button>
            </Group>
          </Alert>
        ) : (
          <Group gap="xs">
            {selectedProviders.map((provider) => (
              <Badge key={getOnlineGameProviderKey(provider)} variant="light">
                {provider.sourceLabel} {provider.username}
              </Badge>
            ))}
          </Group>
        )}

        {failures.length > 0 && (
          <Alert color="yellow" variant="light">
            {failures.slice(0, 3).join("; ")}
          </Alert>
        )}

        <Tabs
          value={activeProvider}
          onChange={(value) => {
            if (value) setActiveProvider(value as OnlineProvider);
          }}
        >
          <Tabs.List grow>
            {ONLINE_PROVIDERS.map((provider) => (
              <Tabs.Tab key={provider.value} value={provider.value}>
                <Group gap={5} wrap="nowrap" justify="center">
                  <Text size="sm" span>
                    {provider.label}
                  </Text>
                  {providerAccountLabels[provider.value] && (
                    <Text size="xs" c="dimmed" span truncate maw={120}>
                      ({providerAccountLabels[provider.value]})
                    </Text>
                  )}
                </Group>
              </Tabs.Tab>
            ))}
          </Tabs.List>

          {ONLINE_PROVIDERS.map((provider) => {
            const providerGames = gamesByProvider[provider.value];
            const providerEmptyMessage = getProviderEmptyMessage(
              provider.value,
              linkedProviders.some((linked) => linked.source === provider.value),
              selectedProviders.some((selected) => selected.source === provider.value),
            );

            return (
              <Tabs.Panel key={provider.value} value={provider.value} pt="xs">
                <ScrollArea.Autosize mah={480}>
                  <Stack gap="xs">
                    {fetching ? (
                      <Group justify="center" py="xl">
                        <Loader size="sm" />
                        <Text size="sm" c="dimmed">
                          Loading recent {provider.label} games...
                        </Text>
                      </Group>
                    ) : providerGames.length === 0 ? (
                      <Paper p="md" withBorder>
                        <Stack gap="xs" align="center">
                          <Text size="sm" c="dimmed" ta="center">
                            {providerEmptyMessage}
                          </Text>
                          <Button size="xs" variant="light" onClick={onOpenAccounts}>
                            Manage accounts
                          </Button>
                        </Stack>
                      </Paper>
                    ) : (
                      providerGames.map((game) => {
                        const details = getOnlineGameDisplay(game);
                        const checked = selectedIds.has(game.id);
                        const expanded = expandedIds.has(game.id);

                        return (
                          <OnlineGameRow
                            key={game.id}
                            game={game}
                            details={details}
                            checked={checked}
                            expanded={expanded}
                            multiple={multiple}
                            previewState={previewByGameId[game.id] ?? { status: "idle" }}
                            previewPly={previewPlyByGameId[game.id] ?? 0}
                            onToggleChecked={(nextChecked) => toggleGame(game, nextChecked)}
                            onToggleExpanded={() => toggleExpanded(game)}
                            onSetPreviewPly={(ply) => setPreviewPly(game.id, ply)}
                          />
                        );
                      })
                    )}
                  </Stack>
                </ScrollArea.Autosize>
              </Tabs.Panel>
            );
          })}
        </Tabs>

        {children}

        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {selectedGames.length === 0
              ? multiple
                ? "No games selected"
                : "Choose one game"
              : `${selectedGames.length} game${selectedGames.length === 1 ? "" : "s"} selected`}
          </Text>
          <Group gap="xs">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={loading}
              disabled={selectedGames.length === 0 || !canConfirm}
              onClick={() => onConfirm(selectedGames)}
            >
              {confirmLabel}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

function OnlineGameRow({
  game,
  details,
  checked,
  expanded,
  multiple,
  previewState,
  previewPly,
  onToggleChecked,
  onToggleExpanded,
  onSetPreviewPly,
}: {
  game: RecentOnlineGame;
  details: OnlineGameRowDetails;
  checked: boolean;
  expanded: boolean;
  multiple: boolean;
  previewState: OnlineGamePreviewState;
  previewPly: number;
  onToggleChecked: (checked: boolean) => void;
  onToggleExpanded: () => void;
  onSetPreviewPly: (ply: number) => void;
}) {
  return (
    <Paper
      p="sm"
      withBorder
      onClick={onToggleExpanded}
      style={{
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        borderColor: checked ? "var(--mantine-primary-color-filled)" : undefined,
        background: checked ? "var(--mantine-primary-color-light)" : undefined,
      }}
    >
      <Stack gap={expanded ? "xs" : 0}>
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <Box pt={2} onClick={(event) => event.stopPropagation()}>
            {multiple ? (
              <Checkbox
                checked={checked}
                onChange={(event) => onToggleChecked(event.currentTarget.checked)}
                aria-label={`Select ${details.title}`}
              />
            ) : (
              <Radio
                checked={checked}
                onChange={(event) => onToggleChecked(event.currentTarget.checked)}
                aria-label={`Select ${details.title}`}
              />
            )}
          </Box>
          <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" fw={700} truncate>
                {details.title}
              </Text>
              <Badge size="xs" variant="light" color={game.source === "lichess" ? "gray" : "green"}>
                {game.sourceLabel}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" truncate>
              {details.event}
            </Text>
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                {game.username}
              </Text>
              <Text size="xs" c="dimmed">
                {dayjs(game.playedAt).format("YYYY-MM-DD HH:mm")}
              </Text>
              {details.result && (
                <Text size="xs" c="dimmed">
                  {details.result}
                </Text>
              )}
            </Group>
          </Stack>
          <Button
            size="compact-xs"
            variant="subtle"
            aria-expanded={expanded}
            leftSection={
              expanded ? <IconChevronDown size="0.9rem" /> : <IconChevronRight size="0.9rem" />
            }
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded();
            }}
          >
            {expanded ? "Hide" : "Details"}
          </Button>
        </Group>

        {expanded && (
          <Box onClick={(event) => event.stopPropagation()}>
            <OnlineGameExpandedPreview
              game={game}
              previewState={previewState}
              previewPly={previewPly}
              onSetPreviewPly={onSetPreviewPly}
            />
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

function OnlineGameExpandedPreview({
  game,
  previewState,
  previewPly,
  onSetPreviewPly,
}: {
  game: RecentOnlineGame;
  previewState: OnlineGamePreviewState;
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
  const orientation = getPreviewOrientation(game, preview);

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
            orientation={orientation}
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

function getOnlineGameDisplay(game: RecentOnlineGame) {
  const white = getPgnHeader(game.pgn, "White");
  const black = getPgnHeader(game.pgn, "Black");
  const event = getPgnHeader(game.pgn, "Event") || game.url;
  const result = getPgnHeader(game.pgn, "Result");
  const title = white && black ? `${white} vs ${black}` : event || `${game.sourceLabel} game`;

  return {
    title,
    event,
    result,
  };
}

function getProviderEmptyMessage(provider: OnlineProvider, linked: boolean, selected: boolean) {
  const label = getProviderLabel(provider);
  if (!linked) return `Link a ${label} account to show ${label} games.`;
  if (!selected) return `Enable your ${label} account in account settings to show its games.`;
  return `No recent importable ${label} games were found.`;
}

function getProviderLabel(provider: OnlineProvider) {
  return ONLINE_PROVIDERS.find((item) => item.value === provider)?.label ?? "online";
}

function getPreviewOrientation(
  game: RecentOnlineGame,
  preview: Pick<OnlineGamePreview, "white" | "black">,
): "white" | "black" {
  return normalizeOnlineName(preview.black) === normalizeOnlineName(game.username)
    ? "black"
    : "white";
}

function formatPreviewMoveLabel(move: OnlineGamePreviewMove) {
  const moveNumber = Math.ceil(move.halfMoves / 2);
  const separator = move.halfMoves % 2 === 0 ? "..." : ".";
  return `${moveNumber}${separator} ${move.san}`;
}

function normalizeOnlineName(value: string) {
  return value.trim().toLowerCase();
}

function getPgnHeader(pgn: string, header: string) {
  const match = pgn.match(new RegExp(`\\[${header}\\s+"([^"]*)"\\]`, "i"));
  return match?.[1]?.trim() ?? "";
}
