import { notifications } from "@mantine/notifications";
import { webStateSession } from "@/web/webStateSession";
import { createEmptyWebBoardState } from "@/web/storage";
import { loadWebOtbImportJob } from "@/web/otbImport";
import { desktopApi } from "./platform";
import { savePhoneTournamentImport } from "./phoneTournament";
import { TournamentWorkspace } from "./TournamentWorkspace";
import type { TournamentPrepHandoff } from "./tournamentPrepHandoff";

export function PhoneTournaments({
  onPrep,
  onDatabase,
  onClose,
}: {
  onPrep: () => void;
  onDatabase: (databaseId: string) => void;
  onClose: () => void;
}) {
  const fail = (error: unknown) =>
    notifications.show({
      title: "Could not open opponent",
      message: error instanceof Error ? error.message : String(error),
      color: "red",
    });
  async function ready(id: number) {
    const collection = await desktopApi.collectionGet(id);
    const databaseId = `tournament-opponent-${id}`;
    await webStateSession.load();
    if (!webStateSession.getSnapshot().state.databases.some((db) => db.id === databaseId)) {
      if (!collection.metadata.jobId) throw new Error("Import this opponent’s games first.");
      for (const jobId of collection.metadata.savedJobIds ?? [collection.metadata.jobId])
        await savePhoneTournamentImport(await loadWebOtbImportJob(jobId), collection);
    }
    return { databaseId, prepId: `prep-${databaseId}` };
  }
  async function prep(handoff: TournamentPrepHandoff) {
    const { databaseId, prepId } = await ready(handoff.collectionId);
    webStateSession.setState((state) => {
      if (!state.prepWorkspaces.some((prep) => prep.id === prepId))
        throw new Error(
          "This Prep was removed. Create a new Prep from the imported opponent database.",
        );
      return {
        ...state,
        activePrepId: prepId,
        prepWorkspaces: state.prepWorkspaces.map((prep) =>
          prep.id === prepId
            ? { ...prep, userColor: handoff.userSide, sourceIds: [databaseId] }
            : prep,
        ),
        board: {
          ...createEmptyWebBoardState(),
          orientation: handoff.userSide,
          sourceTitle: `Prep vs ${handoff.playerName}`,
        },
      };
    });
    await webStateSession.flush();
    onPrep();
  }
  return (
    <TournamentWorkspace
      onClose={onClose}
      onOpenPrep={(handoff) => void prep(handoff).catch(fail)}
      onOpenDatabase={(id) =>
        void ready(id)
          .then(({ databaseId }) => onDatabase(databaseId))
          .catch(fail)
      }
    />
  );
}
