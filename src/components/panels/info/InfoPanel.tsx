import type { PgnGameListEntry } from "@/utils/pgnGameList";
import {
  Accordion,
  ActionIcon,
  Box,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useAtomValue, useStore as useAtomStore } from "jotai";
import { use, useEffect, useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { pgnFiles } from "@/bindings/pgnFiles";
import { notePgnFileWrite } from "@/utils/pgnSourceTabs";
import { withPgnFileTask } from "@/utils/pgnFileQueue";
import GameInfo from "@/components/common/GameInfo";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { applyFileOrientation } from "@/utils/fileBoardPreferences";
import ConfirmChangesModal from "@/components/tabs/ConfirmChangesModal";
import { currentTabAtom } from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { parsePGN } from "@/utils/chess";
import { formatNumber } from "@/utils/format";
import { getTabFile, getTabGameNumber } from "@/utils/tabs";
import { useTabSaveTargets } from "@/utils/tabSaveTarget";
import FenSearch from "./FenSearch";
import FileInfo from "./FileInfo";
import GameSelector from "./GameSelector";
import classes from "./InfoPanel.module.css";
import PgnInput from "./PgnInput";
import { getStats } from "@/utils/repertoire";
import useSWR from "swr";
import { getDatabaseFolderPath, getDatabases } from "@/utils/db";
import { useNavigate } from "@tanstack/react-router";
import { useActiveDatabaseViewStore } from "@/state/store/database";

function InfoPanel({ addGame, addingGame }: { addGame?: () => void; addingGame?: boolean }) {
  const store = use(TreeStateContext)!;
  const stats = useStore(store, getStats);
  const headers = useStore(store, (s) => s.headers);
  const [games, setGames] = useState<Map<number, PgnGameListEntry>>(new Map());
  const currentTab = useAtomValue(currentTabAtom);
  const tabFile = getTabFile(currentTab);
  const gameNumber = getTabGameNumber(currentTab);
  const isReportoire = tabFile?.metadata.type === "repertoire";

  const { t } = useTranslation();

  return (
    <Stack h="100%" gap={0}>
      {currentTab?.gameOrigin.kind === "database" && (
        <DatabaseInfo path={currentTab.gameOrigin.database} id={currentTab.gameOrigin.gameId} />
      )}
      <GameSelectorAccordion
        games={games}
        setGames={setGames}
        addGame={addGame}
        addingGame={addingGame}
      />
      <ScrollArea pb="sm">
        <FileInfo setGames={setGames} />
        <Stack px="sm">
          <GameInfo
            headers={headers}
            simplified={isReportoire}
            changeTitle={(title: string) => {
              setGames((prev) => {
                const newGames = new Map(prev);
                const existing = newGames.get(gameNumber);
                if (existing) newGames.set(gameNumber, { ...existing, name: title });
                return newGames;
              });
            }}
          />
          <FenSearch />
          <PgnInput />

          <Group>
            <Text fz="xs" c="dimmed">
              {t("PgnInput.Variations")}: {stats.leafs}
            </Text>
            <Text fz="xs" c="dimmed">
              {t("PgnInput.MaxDepth")}: {stats.depth}
            </Text>
            <Text fz="xs" c="dimmed">
              {t("PgnInput.TotalMoves")}: {stats.total}
            </Text>
          </Group>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

function DatabaseInfo({ path, id: _id }: { path: string; id: number }) {
  const { t } = useTranslation();
  const { data: databases, isLoading } = useSWR("databases", () => getDatabases());

  const dbInfo = databases?.find((db) => db.file === path);
  const navigate = useNavigate();
  const setActiveDatabase = useActiveDatabaseViewStore((store) => store.setDatabase);

  if (isLoading || !dbInfo || dbInfo.type !== "success") {
    return null;
  }
  return (
    <Stack gap={0}>
      <Box
        className={classes.databaseCard}
        onClick={async () => {
          await navigate({
            to: "/databases/$databaseId",
            params: {
              databaseId: dbInfo.title,
            },
          });
          setActiveDatabase(dbInfo);
        }}
      >
        <Text tt="uppercase" c="dimmed" fw={700} size="xs">
          {t("Board.Tabs.Database")}
        </Text>
        <Text fw="bold">{dbInfo.title}</Text>
        <Text size="xs" c="dimmed">
          {[getDatabaseFolderPath(dbInfo), dbInfo.description].filter(Boolean).join(" - ")}
        </Text>
      </Box>
      <Divider />
    </Stack>
  );
}

export function GameSelectorAccordion({
  games,
  setGames,
  addGame,
  addingGame,
}: {
  games: Map<number, PgnGameListEntry>;
  setGames: React.Dispatch<React.SetStateAction<Map<number, PgnGameListEntry>>>;
  addGame?: () => void;
  addingGame?: boolean;
}) {
  const store = use(TreeStateContext)!;
  const setState = useStore(store, (s) => s.setState);
  const currentTab = useAtomValue(currentTabAtom);
  const saveTargetFor = useTabSaveTargets();
  const atomStore = useAtomStore();
  const pageRequest = useRef(0);
  useEffect(
    () => () => {
      pageRequest.current += 1;
    },
    [],
  );

  const [confirmChanges, toggleConfirmChanges] = useToggle();
  const [tempPage, setTempPage] = useState<{ page: number; identity?: string }>({ page: 0 });

  const tabFile = getTabFile(currentTab);
  const gameNumber = getTabGameNumber(currentTab);
  const currentName = games.get(gameNumber)?.name || "Untitled";

  const keyMap = useAtomValue(keyMapAtom);
  const { t } = useTranslation();

  useHotkeys(
    keyMap.NEXT_GAME.keys,
    () => {
      if (!tabFile?.numGames) return;
      void setPage(Math.min(gameNumber + 1, tabFile.numGames - 1));
    },
    {
      enabled: !!tabFile,
    },
  );

  useHotkeys(keyMap.PREVIOUS_GAME.keys, () => setPage(Math.max(0, gameNumber - 1)), {
    enabled: !!tabFile,
  });

  if (!tabFile) return null;
  const filePath = tabFile.path;

  async function setPage(page: number, forced?: boolean, expectedIdentity?: string) {
    const ticket = ++pageRequest.current;
    if (!currentTab) return;
    if (!forced && store.getState().dirty) {
      setTempPage({ page, identity: expectedIdentity });
      toggleConfirmChanges();
      return;
    }

    const target = saveTargetFor(currentTab.value);
    const owner = target.get();
    const sourceFile = getTabFile(owner);
    if (!owner || !sourceFile) return;
    const sourceIndex = getTabGameNumber(owner);
    const sourceIdentity =
      owner.gameOrigin.kind === "file" || owner.gameOrigin.kind === "temp_file"
        ? owner.gameOrigin.sourceIdentity
        : undefined;
    if (!forced && (sourceFile.path !== filePath || sourceIndex !== gameNumber)) return;
    const requestedRoot = store.getState().root,
      requestedHeaders = store.getState().headers;
    const owns = () => {
      const latest = target.get();
      return (
        latest &&
        getTabFile(latest)?.path === sourceFile.path &&
        getTabGameNumber(latest) === sourceIndex &&
        (latest.gameOrigin.kind === "file" || latest.gameOrigin.kind === "temp_file") &&
        latest.gameOrigin.sourceIdentity === sourceIdentity
      );
    };
    try {
      const captured = await pgnFiles.read(sourceFile.path, page);
      if (expectedIdentity && captured.identity !== expectedIdentity)
        throw new Error("This game changed. Reload the game list before opening it.");
      const tree = await parsePGN(captured.pgn);
      if (pageRequest.current !== ticket || !owns()) return;
      if (store.getState().root !== requestedRoot || store.getState().headers !== requestedHeaders)
        throw new Error(
          "New changes arrived while loading. Your current game has been kept open; select the other game again.",
        );
      target.update((prev) => {
        if (prev.gameOrigin.kind !== "file" && prev.gameOrigin.kind !== "temp_file") {
          return prev;
        }
        return {
          ...prev,
          gameOrigin: {
            ...prev.gameOrigin,
            gameNumber: page,
            sourceIdentity: captured.identity,
            file: { ...prev.gameOrigin.file, numGames: captured.gameCount, numGamesKnown: true },
          },
        };
      });
      setState(applyFileOrientation(tree, sourceFile.path));
    } catch (error) {
      if (pageRequest.current === ticket && owns()) {
        if (forced) throw error;
        notifications.show({ title: "Game not changed", message: String(error), color: "red" });
      }
    }
  }

  async function deleteGame(index: number, identity: string) {
    try {
      await withPgnFileTask(filePath, async () => {
        const result = await pgnFiles.remove(filePath, index, identity);
        notePgnFileWrite(atomStore, filePath, result, { requestedIndex: index, identity });
        setGames(new Map());
      });
      return true;
    } catch (error) {
      notifications.show({ title: "Could not remove game", message: String(error), color: "red" });
      return false;
    }
  }

  return (
    <>
      {currentTab && (
        <ConfirmChangesModal
          opened={confirmChanges}
          onClose={() => toggleConfirmChanges(false)}
          closeTab={() => setPage(tempPage.page, true, tempPage.identity)}
          tab={currentTab}
          target={saveTargetFor(currentTab.value)}
          store={store}
          saveLabel="Save and Open Game"
          discardLabel="Open Without Saving"
          description="Save your current changes before opening the selected game?"
        />
      )}
      <Accordion
        styles={{
          control: {
            borderBottom: "1px solid var(--mantine-color-default-border)",
          },
          content: { padding: 0 },
        }}
      >
        <Accordion.Item value="game">
          <Accordion.Control>
            <Group justify="space-between" wrap="nowrap" w="100%">
              <Text truncate flex={1}>
                {formatNumber(gameNumber + 1)}. {currentName}
              </Text>
              {addGame && (
                <Tooltip label={t("Board.Action.AddGame")}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    loading={addingGame}
                    aria-label="Add game"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      addGame();
                    }}
                  >
                    <IconPlus size="0.9rem" />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Box h="10rem">
              <GameSelector
                games={games}
                setGames={setGames}
                setPage={(page, identity) => void setPage(page, false, identity)}
                deleteGame={deleteGame}
                path={filePath}
                activePage={gameNumber || 0}
                total={tabFile.numGames}
                version={tabFile.lastModified}
                onCountChange={(count) =>
                  saveTargetFor(currentTab?.value).update((tab) => {
                    const origin = tab.gameOrigin;
                    if (
                      (origin.kind !== "file" && origin.kind !== "temp_file") ||
                      origin.file.path !== filePath
                    )
                      return tab;
                    return {
                      ...tab,
                      gameOrigin: {
                        ...origin,
                        file: {
                          ...origin.file,
                          numGames: count,
                          numGamesKnown: true,
                          lastModified: Math.max(Date.now(), origin.file.lastModified + 1),
                        },
                      },
                    };
                  })
                }
              />
            </Box>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </>
  );
}
export default InfoPanel;
