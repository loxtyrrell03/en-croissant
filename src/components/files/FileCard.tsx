import { ActionIcon, Badge, Box, Divider, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconEdit, IconExternalLink, IconZoomCheck } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { openFile } from "@/utils/files";
import { capitalize } from "@/utils/format";
import { unwrap } from "@/utils/unwrap";
import GamePreview from "../databases/GamePreview";
import GameSelector from "../panels/info/GameSelector";
import { isPdfFile } from "./file";
import type { FileMetadata } from "./file";

function getFileTypeLabel(type: FileMetadata["metadata"]["type"], t: (key: string) => string) {
  return type === "pdf" ? "PDF" : t(`Files.FileType.${capitalize(type)}`);
}

function FileCard({
  selected,
  games,
  setGames,
  toggleEditModal,
}: {
  selected: FileMetadata;
  games: Map<number, string>;
  setGames: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  toggleEditModal: () => void;
}) {
  if (isPdfFile(selected)) {
    return <PdfFileCard selected={selected} />;
  }

  return (
    <PgnFileCard
      selected={selected}
      games={games}
      setGames={setGames}
      toggleEditModal={toggleEditModal}
    />
  );
}

function PdfFileCard({ selected }: { selected: FileMetadata }) {
  const { t } = useTranslation();
  const pdfSrc = useMemo(() => convertFileSrc(selected.path), [selected.path]);

  return (
    <Stack h="100%" gap="sm">
      <Stack align="center" gap={4}>
        <Text ta="center" fz="xl" fw="bold" lineClamp={2} px="sm">
          {selected.name}
        </Text>
        <Badge>{getFileTypeLabel(selected.metadata.type, t)}</Badge>
      </Stack>
      <Divider />

      <Group align="center" px="xs" justify="space-between">
        <Group gap="xs">
          <Tooltip label="Open in system viewer">
            <ActionIcon
              size="sm"
              variant="default"
              aria-label="Open PDF in system viewer"
              onClick={() => void openPath(selected.path)}
            >
              <IconExternalLink />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Text ta="center" c="dimmed" size="sm" truncate="end" style={{ flex: 1 }}>
          {selected.path}
        </Text>
        <div />
      </Group>

      <Box
        mx="xs"
        mb="xs"
        flex={1}
        style={{
          minHeight: 0,
          overflow: "hidden",
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: "var(--mantine-radius-sm)",
          background: "var(--mantine-color-body)",
        }}
      >
        <iframe
          title={`${selected.name} PDF preview`}
          src={pdfSrc}
          style={{
            width: "100%",
            height: "100%",
            border: 0,
            background: "white",
          }}
        />
      </Box>
    </Stack>
  );
}

function PgnFileCard({
  selected,
  games,
  setGames,
  toggleEditModal,
}: {
  selected: FileMetadata;
  games: Map<number, string>;
  setGames: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  toggleEditModal: () => void;
}) {
  const { t } = useTranslation();

  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const navigate = useNavigate();

  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [gameCount, setGameCount] = useState(selected.numGames);

  useEffect(() => {
    setPage(0);
    setGameCount(selected.numGames);
  }, [selected]);

  useEffect(() => {
    let cancelled = false;

    async function loadGameCount() {
      if (selected.numGamesKnown !== false) {
        setGameCount(selected.numGames);
        return;
      }

      const count = unwrap(await commands.countPgnGames(selected.path));
      if (!cancelled) {
        setGameCount(count);
      }
    }

    void loadGameCount();

    return () => {
      cancelled = true;
    };
  }, [selected.numGames, selected.numGamesKnown, selected.path]);

  useEffect(() => {
    async function loadGames() {
      const data = unwrap(await commands.readGames(selected.path, page, page));

      setSelectedGame(data[0]);
    }
    loadGames();
  }, [selected, page]);

  async function openGame() {
    await openFile(
      { ...selected, numGames: gameCount, numGamesKnown: true },
      setTabs,
      setActiveTab,
      {
        gameNumber: page,
        pgn: selectedGame || "",
      },
    );
    navigate({ to: "/" });
  }

  return (
    <Stack h="100%">
      <Stack align="center">
        <Text ta="center" fz="xl" fw="bold">
          {selected?.name}
        </Text>
        <Badge>{getFileTypeLabel(selected.metadata.type, t)}</Badge>
      </Stack>
      <Divider />

      <Group align="center" grow px="xs">
        <Group>
          <Tooltip label={t("Common.Open")}>
            <ActionIcon size="sm" onClick={openGame}>
              <IconZoomCheck />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Files.EditMetadata")}>
            <ActionIcon size="sm" onClick={() => toggleEditModal()}>
              <IconEdit />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Text ta="center" c="dimmed">
          {gameCount} {t("Common.Games")}
        </Text>
        <div />
      </Group>

      {selectedGame && (
        <>
          <Box h={0} flex={1}>
            <Divider />
            <GameSelector
              setGames={setGames}
              games={games}
              activePage={page}
              path={selected.path}
              setPage={setPage}
              total={gameCount}
            />
            <Divider />
          </Box>
          <Box h="55%" px="xs" pb="xs">
            <GamePreview pgn={selectedGame} />
          </Box>
        </>
      )}
    </Stack>
  );
}

export default FileCard;
