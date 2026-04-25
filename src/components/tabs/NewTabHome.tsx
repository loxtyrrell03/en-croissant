import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useAtom, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useState } from "react";
import {
  activeTabAtom,
  addRecentFileAtom,
  deckAtomFamily,
  type RecentFile,
  recentFilesAtom,
  tabFamily,
  tabsAtom,
} from "@/state/atoms";
import type { Tab } from "@/utils/tabs";
import { createTab } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";
import CreateRepertoireModal from "./CreateRepertoireModal";
import ImportModal from "./ImportModal";
import classes from "./NewTabHome.module.css";
import {
  IconChess,
  IconClock,
  IconFileImport,
  IconPuzzle,
  IconTarget,
  IconTargetArrow,
  IconTrash,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { getStats } from "@/components/files/opening";
import Chessboard from "../icons/Chessboard";
import { FileIcon } from "@/components/files/FileIcon";
import {
  deleteOpeningReviewDeck,
  listOpeningReviewDecks,
  type OpeningReviewDeckSummary,
} from "@/utils/openingReview";

dayjs.extend(relativeTime);

function RecentFileDuePositions({ file }: { file: string }) {
  const [deck] = useAtom(
    deckAtomFamily({
      file,
      game: 0,
    }),
  );

  const stats = getStats(deck.positions);

  if (stats.due + stats.unseen === 0) return null;

  return (
    <Badge size="sm" variant="light" color="orange" leftSection={<IconTarget size="0.75rem" />}>
      {stats.due + stats.unseen} due
    </Badge>
  );
}

function RecentFileRow({ file, onOpen }: { file: RecentFile; onOpen: (file: RecentFile) => void }) {
  const displayName = file.name.replace(/\.pgn$/i, "");

  return (
    <UnstyledButton
      onClick={() => onOpen(file)}
      px="sm"
      py={6}
      style={{
        borderRadius: "var(--mantine-radius-sm)",
      }}
      className={classes.recentFileRow}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Box style={{ flexShrink: 0, color: "var(--mantine-color-dimmed)" }}>
            <FileIcon type={file.type} size={20} />
          </Box>
          <Text size="sm" truncate fw={500}>
            {displayName}
          </Text>
          {file.type === "repertoire" && <RecentFileDuePositions file={file.path} />}
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Tooltip label={dayjs(file.lastOpened).format("YYYY-MM-DD HH:mm")}>
            <Group gap={4} wrap="nowrap">
              <IconClock size={14} style={{ color: "var(--mantine-color-dimmed)" }} />
              <Text size="xs" c="dimmed">
                {dayjs(file.lastOpened).fromNow()}
              </Text>
            </Group>
          </Tooltip>
        </Group>
      </Group>
    </UnstyledButton>
  );
}

function OpeningReviewModal({
  opened,
  decks,
  loading,
  deletingPath,
  onClose,
  onOpen,
  onDelete,
}: {
  opened: boolean;
  decks: OpeningReviewDeckSummary[];
  loading: boolean;
  deletingPath: string | null;
  onClose: () => void;
  onOpen: (deck: OpeningReviewDeckSummary) => void;
  onDelete: (deck: OpeningReviewDeckSummary) => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={<b>Opening Review</b>} size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Train the positions saved from Opening Health. Progress is stored in the review file.
        </Text>
        {loading ? (
          <Text c="dimmed">Loading review decks...</Text>
        ) : decks.length === 0 ? (
          <Paper p="md" withBorder>
            <Stack gap="xs" align="center">
              <IconTargetArrow size={36} style={{ opacity: 0.35 }} />
              <Text fw={600}>No review decks yet</Text>
              <Text size="sm" c="dimmed" ta="center">
                Run Opening Health, then use Save review deck when the scan finishes.
              </Text>
            </Stack>
          </Paper>
        ) : (
          <Stack gap={4}>
            {decks.map((deck) => (
              <Group
                key={deck.path}
                px="sm"
                py="xs"
                className={classes.recentFileRow}
                wrap="nowrap"
                style={{ borderRadius: "var(--mantine-radius-sm)" }}
              >
                <UnstyledButton
                  onClick={() => onOpen(deck)}
                  style={{ flex: 1, minWidth: 0, textAlign: "left" }}
                >
                  <Stack gap={1} style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>
                      {deck.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {deck.source
                        ? `${deck.total} positions - ${deck.source}`
                        : `${deck.total} positions`}
                    </Text>
                  </Stack>
                </UnstyledButton>
                <Group gap="xs" wrap="nowrap">
                  {(deck.due > 0 || deck.unseen > 0) && (
                    <Badge color="orange" variant="light">
                      {deck.due + deck.unseen} due
                    </Badge>
                  )}
                  <Text size="xs" c="dimmed">
                    {dayjs(deck.updatedAt).fromNow()}
                  </Text>
                  <Tooltip label="Delete review deck">
                    <ActionIcon
                      aria-label={`Delete ${deck.name}`}
                      variant="subtle"
                      color="red"
                      loading={deletingPath === deck.path}
                      onClick={() => onDelete(deck)}
                    >
                      <IconTrash size="1rem" />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

export default function NewTabHome({ id }: { id: string }) {
  const { t } = useTranslation();

  const [openModal, setOpenModal] = useState(false);
  const [openRepertoireModal, setOpenRepertoireModal] = useState(false);
  const [openReviewModal, setOpenReviewModal] = useState(false);
  const [reviewDecks, setReviewDecks] = useState<OpeningReviewDeckSummary[]>([]);
  const [reviewDecksLoading, setReviewDecksLoading] = useState(false);
  const [deletingReviewDeckPath, setDeletingReviewDeckPath] = useState<string | null>(null);
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

  const [recentFiles, setRecentFiles] = useAtom(recentFilesAtom);
  const store = useStore();
  const navigate = useNavigate();
  const { documentDir } = useLoaderData({ from: "/" });

  useEffect(() => {
    const checkFiles = async () => {
      const newRecentFiles = await Promise.all(
        recentFiles.map(async (file) => {
          const exists = await commands.fileExists(file.path);
          if (exists.status === "error" || !exists.data) {
            return null;
          }
          return file;
        }),
      );
      const filtered = newRecentFiles.filter((f) => f !== null) as RecentFile[];
      if (filtered.length !== recentFiles.length) {
        setRecentFiles(filtered);
      }
    };
    checkFiles();
  }, [recentFiles, recentFiles.length, setRecentFiles]);

  useEffect(() => {
    if (!openReviewModal) return;

    let disposed = false;
    setReviewDecksLoading(true);
    listOpeningReviewDecks(documentDir)
      .then((decks) => {
        if (!disposed) setReviewDecks(decks);
      })
      .finally(() => {
        if (!disposed) setReviewDecksLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [documentDir, openReviewModal]);

  const openRecentFile = useCallback(
    async (file: RecentFile) => {
      const pgn = unwrap(await commands.readGames(file.path, 0, 0));
      const tabId = await createTab({
        tab: {
          name: file.name,
          type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn: pgn[0] || "",
        gameOrigin: {
          kind: "file",
          gameNumber: 0,
          file: {
            type: "file",
            name: file.name,
            path: file.path,
            numGames: 1,
            metadata: { type: file.type, tags: [] },
            lastModified: Math.floor(Date.now() / 1000),
          },
        },
      });
      if (file.type === "repertoire") {
        store.set(tabFamily(tabId), "practice");
      }
      store.set(addRecentFileAtom, {
        name: file.name,
        path: file.path,
        type: file.type,
      });
      navigate({ to: "/" });
    },
    [setTabs, setActiveTab, store, navigate],
  );

  const openReviewDeck = useCallback(
    async (deck: OpeningReviewDeckSummary) => {
      await createTab({
        tab: {
          name: deck.name,
          type: "opening-review",
        },
        setTabs,
        setActiveTab,
        gameOrigin: {
          kind: "opening_review",
          path: deck.path,
          name: deck.name,
        },
      });
      setOpenReviewModal(false);
      navigate({ to: "/" });
    },
    [navigate, setActiveTab, setTabs],
  );

  const deleteReviewDeck = useCallback(async (deck: OpeningReviewDeckSummary) => {
    const confirmed = window.confirm(
      `Delete "${deck.name}"?\n\nThis removes the review deck file and cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingReviewDeckPath(deck.path);
    try {
      await deleteOpeningReviewDeck(deck.path);
      setReviewDecks((current) => current.filter((item) => item.path !== deck.path));
      notifications.show({
        title: "Review deck deleted",
        message: `${deck.name} was removed.`,
        color: "blue",
      });
    } catch (error) {
      notifications.show({
        title: "Could not delete review deck",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setDeletingReviewDeckPath(null);
    }
  }, []);

  const cards = [
    {
      icon: <IconChess size={60} />,
      title: t("Home.Card.PlayChess.Title"),
      description: t("Home.Card.PlayChess.Desc"),
      label: t("Home.Card.PlayChess.Button"),
      onClick: () => {
        setTabs((prev: Tab[]) => {
          const tab = prev.find((t) => t.value === id);
          if (!tab) return prev;
          tab.name = t("Home.NewGame");
          tab.type = "play";
          return [...prev];
        });
      },
    },
    {
      icon: <Chessboard size={60} />,
      title: t("Home.Card.AnalysisBoard.Title"),
      description: t("Home.Card.AnalysisBoard.Desc"),
      label: t("Home.Card.AnalysisBoard.Button"),
      onClick: () => {
        setTabs((prev: Tab[]) => {
          const tab = prev.find((t) => t.value === id);
          if (!tab) return prev;
          tab.name = t("Home.Card.AnalysisBoard.Title");
          tab.type = "analysis";
          return [...prev];
        });
      },
    },
    {
      icon: <IconTargetArrow size={60} />,
      title: t("Home.Card.NewRepertoire.Title"),
      description: t("Home.Card.NewRepertoire.Desc"),
      label: t("Home.Card.NewRepertoire.Button"),
      onClick: () => {
        setOpenRepertoireModal(true);
      },
    },
    {
      icon: <IconTarget size={60} />,
      title: "Opening Review",
      description: "Train saved Opening Health positions with spaced repetition.",
      label: "Open review deck",
      onClick: () => {
        setOpenReviewModal(true);
      },
    },
    {
      icon: <IconFileImport size={60} />,
      title: t("Home.Card.ImportGame.Title"),
      description: t("Home.Card.ImportGame.Desc"),
      label: t("Home.Card.ImportGame.Button"),
      onClick: () => {
        setOpenModal(true);
      },
    },
    {
      icon: <IconPuzzle size={60} />,
      title: t("Home.Card.Puzzle.Title"),
      description: t("Home.Card.Puzzle.Desc"),
      label: t("Home.Card.Puzzle.Button"),
      onClick: () => {
        setTabs((prev) => {
          const tab = prev.find((t) => t.value === id);
          if (!tab) return prev;
          tab.name = t("Home.PuzzleTraining");
          tab.type = "puzzles";
          return [...prev];
        });
      },
    },
  ];

  return (
    <>
      <ImportModal
        openModal={openModal}
        setOpenModal={setOpenModal}
        setTabs={setTabs}
        setActiveTab={setActiveTab}
      />
      <CreateRepertoireModal opened={openRepertoireModal} setOpened={setOpenRepertoireModal} />
      <OpeningReviewModal
        opened={openReviewModal}
        decks={reviewDecks}
        loading={reviewDecksLoading}
        deletingPath={deletingReviewDeckPath}
        onClose={() => setOpenReviewModal(false)}
        onOpen={openReviewDeck}
        onDelete={deleteReviewDeck}
      />
      <Stack gap="lg" pt="sm">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 6 }}>
          {cards.map((card) => (
            <Card shadow="sm" p="lg" radius="md" withBorder key={card.title}>
              <Stack align="center" h="100%" justify="space-between">
                {card.icon}

                <Box style={{ textAlign: "center" }}>
                  <Text fw={500}>{card.title}</Text>
                  <Text size="sm" c="dimmed">
                    {card.description}
                  </Text>
                </Box>

                <Button variant="light" fullWidth mt="md" radius="md" onClick={card.onClick}>
                  {card.label}
                </Button>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>

        <Card shadow="sm" p="md" radius="md" withBorder>
          <Text fw={600} size="lg" mb="xs">
            {t("Home.RecentFiles.Title")}
          </Text>
          {recentFiles.length === 0 ? (
            <Stack align="center" justify="center" h={200} gap="xs">
              <IconClock size={48} style={{ opacity: 0.3 }} />
              <Text c="dimmed">{t("Home.RecentFiles.NoRecentFiles")}</Text>
            </Stack>
          ) : (
            <ScrollArea.Autosize mah={300}>
              <Stack gap={2}>
                {recentFiles.map((file) => (
                  <RecentFileRow key={file.path} file={file} onOpen={openRecentFile} />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
        </Card>
      </Stack>
    </>
  );
}
