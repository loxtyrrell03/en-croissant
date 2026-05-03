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
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconRefresh, IconSettings } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@/utils/session";
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

  const selectedGames = useMemo(
    () => games.filter((game) => selectedIds.has(game.id)),
    [games, selectedIds],
  );

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
      return;
    }

    if (selectedProviders.length > 0) {
      void loadGames();
    } else {
      setGames([]);
      setFailures([]);
    }
  }, [loadGames, opened, selectedProviders.length]);

  function toggleGame(game: RecentOnlineGame, checked: boolean) {
    setSelectedIds((current) => {
      if (!multiple) return checked ? new Set([game.id]) : new Set();

      const next = new Set(current);
      if (checked) next.add(game.id);
      else next.delete(game.id);
      return next;
    });
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

        <ScrollArea.Autosize mah={380}>
          <Stack gap="xs">
            {fetching ? (
              <Group justify="center" py="xl">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  Loading recent games...
                </Text>
              </Group>
            ) : games.length === 0 ? (
              <Paper p="md" withBorder>
                <Text size="sm" c="dimmed" ta="center">
                  {emptyMessage}
                </Text>
              </Paper>
            ) : (
              games.map((game) => {
                const details = getOnlineGameDisplay(game);
                const checked = selectedIds.has(game.id);

                return (
                  <Paper
                    key={game.id}
                    p="sm"
                    withBorder
                    component="button"
                    type="button"
                    onClick={() => toggleGame(game, !checked)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      cursor: "pointer",
                      borderColor: checked ? "var(--mantine-primary-color-filled)" : undefined,
                      background: checked ? "var(--mantine-primary-color-light)" : undefined,
                    }}
                  >
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <Box pt={2}>
                        {multiple ? (
                          <Checkbox
                            checked={checked}
                            onChange={(event) => toggleGame(game, event.currentTarget.checked)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Select ${details.title}`}
                          />
                        ) : (
                          <Radio
                            checked={checked}
                            onChange={(event) => toggleGame(game, event.currentTarget.checked)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Select ${details.title}`}
                          />
                        )}
                      </Box>
                      <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                          <Text size="sm" fw={700} truncate>
                            {details.title}
                          </Text>
                          <Badge
                            size="xs"
                            variant="light"
                            color={game.source === "lichess" ? "gray" : "green"}
                          >
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
                    </Group>
                  </Paper>
                );
              })
            )}
          </Stack>
        </ScrollArea.Autosize>

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

function getPgnHeader(pgn: string, header: string) {
  const match = pgn.match(new RegExp(`\\[${header}\\s+"([^"]*)"\\]`, "i"));
  return match?.[1]?.trim() ?? "";
}
