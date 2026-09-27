import { activeDatabaseViewStore } from "@/state/store/database";
import { getDatabases } from "@/utils/db";
import { Button, Modal } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom, useStore } from "jotai";
import { useState } from "react";
import {
  activeTabAtom,
  currentOpponentPrepAtom,
  opponentPrepSettingsAtom,
  tabFamily,
  tabsAtom,
} from "@/state/atoms";
import { createTab } from "@/utils/tabs";
import { parsePGN } from "@/utils/chess";
import { commands } from "@/bindings";
import { unwrap } from "@/utils/unwrap";
import { TournamentWorkspace } from "./TournamentWorkspace";
import { desktopApi } from "./platform";
import type { TournamentPrepHandoff } from "./tournamentPrepHandoff";

export function DesktopTournaments() {
  const [opened, setOpened] = useState(false);
  const store = useStore();
  const navigate = useNavigate();
  const setTabs = useSetAtom(tabsAtom),
    setActiveTab = useSetAtom(activeTabAtom);
  const fail = (error: unknown) =>
    notifications.show({
      title: "Could not open opponent",
      message: error instanceof Error ? error.message : String(error),
      color: "red",
    });
  async function prep(handoff: TournamentPrepHandoff) {
    const collection = await desktopApi.collectionGet(handoff.collectionId),
      path = collection.metadata.dbPath;
    if (!path || !unwrap(await commands.fileExists(path)))
      throw new Error("The opponent games are not saved. Import games from the tournament first.");
    const tree = await parsePGN("");
    tree.headers.orientation = handoff.userSide;
    const tabId = await createTab({
      tab: { name: `Prep vs ${handoff.playerName}`, type: "analysis" },
      setTabs,
      setActiveTab,
      initialState: tree,
    });
    const settings = {
      ...store.get(opponentPrepSettingsAtom),
      mode: "player" as const,
      source: "local" as const,
      databasePath: path,
      databaseLabel: collection.name,
      player: null,
      playerName: handoff.playerName,
      color: handoff.userSide === "white" ? ("black" as const) : ("white" as const),
      result: "any" as const,
      start_date: undefined,
      end_date: undefined,
    };
    store.set(currentOpponentPrepAtom, {
      ...settings,
      rootPath: [],
      completedBranches: {},
      skippedBranches: {},
      panelStage: "setup",
    });
    store.set(opponentPrepSettingsAtom, settings);
    store.set(tabFamily(tabId), "prep");
    setOpened(false);
    await navigate({ to: "/" });
  }
  async function database(id: number) {
    const collection = await desktopApi.collectionGet(id);
    if (!collection.metadata.dbPath) throw new Error("Import games before opening this database.");
    const entry = (await getDatabases()).find(
      (db) => db.type === "success" && db.file === collection.metadata.dbPath,
    );
    if (!entry || entry.type !== "success")
      throw new Error("The saved database is not available. Check its location in Databases.");
    activeDatabaseViewStore.getState().setDatabase(entry);
    setOpened(false);
    await navigate({ to: "/databases/$databaseId", params: { databaseId: entry.title } });
  }
  return (
    <>
      <Button variant="light" onClick={() => setOpened(true)}>
        Tournaments & opponent prep
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Tournaments" size="95%">
        <TournamentWorkspace
          onClose={() => setOpened(false)}
          onOpenPrep={(handoff) => void prep(handoff).catch(fail)}
          onOpenDatabase={(id) => void database(id).catch(fail)}
        />
      </Modal>
    </>
  );
}
