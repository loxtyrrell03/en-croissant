import type { PgnGameListEntry } from "@/utils/pgnGameList";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconEdit, IconExternalLink, IconZoomCheck } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { pgnFiles, type PgnGameSnapshot } from "@/bindings/pgnFiles";
import { notifications } from "@mantine/notifications";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { openFile } from "@/utils/files";
import { capitalize } from "@/utils/format";
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
  games: Map<number, PgnGameListEntry>;
  setGames: React.Dispatch<React.SetStateAction<Map<number, PgnGameListEntry>>>;
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

export function PgnFileCard({
  selected,
  games,
  setGames,
  toggleEditModal,
}: {
  selected: FileMetadata;
  games: Map<number, PgnGameListEntry>;
  setGames: React.Dispatch<React.SetStateAction<Map<number, PgnGameListEntry>>>;
  toggleEditModal: () => void;
}) {
  const { t } = useTranslation();

  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const navigate = useNavigate();

  const sourceKey = JSON.stringify([selected.path, selected.lastModified, selected.numGames]);
  const [selection, setSelection] = useState<{ key: string; page: number; identity?: string }>({
    key: sourceKey,
    page: 0,
  });
  const page = selection.key === sourceKey ? selection.page : 0;
  const expectedIdentity = selection.key === sourceKey ? selection.identity : undefined;
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([sourceKey, page, expectedIdentity, retry]);
  const [loaded, setLoaded] = useState<{
    key: string;
    snapshot?: PgnGameSnapshot;
    error?: string;
    empty?: boolean;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const snapshot = loaded?.key === requestKey ? loaded.snapshot : undefined;
  const error = loaded?.key === requestKey ? loaded.error : undefined;
  const empty = loaded?.key === requestKey && loaded.empty;
  const [countOverride, setCountOverride] = useState<{ key: string; count: number } | null>(null);
  const gameCount =
    countOverride?.key === sourceKey
      ? countOverride.count
      : (snapshot?.gameCount ?? (empty ? 0 : selected.numGames));
  const setPage = (page: number, identity?: string) =>
    setSelection({ key: sourceKey, page, identity });

  useEffect(() => {
    let cancelled = false;
    setLoaded({ key: requestKey });
    void (async () => {
      try {
        const batch = await pgnFiles.readBatch(selected.path, page, page);
        const captured = batch.games[0];
        if (cancelled) return;
        setCountOverride({ key: sourceKey, count: batch.gameCount });
        if (!captured) {
          if (page === 0) {
            setLoaded({ key: requestKey, empty: true });
            return;
          }
          throw new Error("That game is no longer in the file. Reload the game list.");
        }
        if (expectedIdentity && expectedIdentity !== captured.identity)
          throw new Error("This game changed. Reload the game list before opening it.");
        setLoaded({ key: requestKey, snapshot: captured });
      } catch (error) {
        if (!cancelled) setLoaded({ key: requestKey, error: String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expectedIdentity, page, requestKey, selected.path, sourceKey]);

  async function openGame() {
    if (!snapshot || openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    try {
      await openFile(
        { ...selected, numGames: snapshot.gameCount, numGamesKnown: true },
        setTabs,
        setActiveTab,
        {
          gameNumber: snapshot.index,
          pgn: snapshot.pgn,
          expectedIdentity: snapshot.identity,
        },
      );
      navigate({ to: "/" });
    } catch (error) {
      notifications.show({ title: "Could not open game", message: String(error), color: "red" });
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
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
            <ActionIcon
              size="sm"
              aria-label="Open game"
              disabled={!snapshot}
              loading={opening}
              onClick={openGame}
            >
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

      {error && (
        <Group role="alert" gap="xs">
          <Text size="sm" c="red">
            {error}
          </Text>
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => {
              setSelection({ key: sourceKey, page: 0 });
              setRetry((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </Group>
      )}
      {!snapshot && !error && !empty && <Loader size="sm" aria-label="Loading game" />}
      {empty && (
        <Text c="dimmed" size="sm">
          No games in this file.
        </Text>
      )}
      {gameCount > 0 && !empty && (
        <Box h={0} flex={1}>
          <Divider />
          <GameSelector
            setGames={setGames}
            games={games}
            activePage={page}
            path={selected.path}
            setPage={setPage}
            total={gameCount}
            version={`${selected.lastModified}:${retry}`}
          />
          <Divider />
        </Box>
      )}
      {snapshot && (
        <Box h="55%" px="xs" pb="xs">
          <GamePreview key={snapshot.identity} pgn={snapshot.pgn} />
        </Box>
      )}
    </Stack>
  );
}

export default FileCard;
