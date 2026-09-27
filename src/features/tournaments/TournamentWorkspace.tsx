import { Button, Group, Stack } from "@mantine/core";
import { useEffect, useState } from "react";
import { TournamentPrepModal } from "./TournamentPrepModal";
import type { TournamentPrepHandoff } from "./tournamentPrepHandoff";
import { TournamentEmbedded } from "./ui";
import { OtbDownloadControl } from "./downloads/OtbDownloadControl";
import { PlayerGameImportModal } from "./TournamentPlayerImport";
import { startTournamentServices } from "./services";
import styles from "./TournamentSurface.module.css";

export function TournamentWorkspace({
  onOpenPrep,
  onOpenDatabase,
  onClose,
}: {
  onOpenPrep: (handoff: TournamentPrepHandoff) => void;
  onOpenDatabase: (id: number) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<"tournaments" | "import" | "downloads">("tournaments");
  useEffect(startTournamentServices, []);
  return (
    <TournamentEmbedded.Provider value={true}>
      <Stack className={styles.surface} gap="md">
        <Group gap="xs" aria-label="Tournament tools">
          <Button
            variant={page === "tournaments" ? "filled" : "light"}
            onClick={() => setPage("tournaments")}
          >
            Tournaments
          </Button>
          <Button
            variant={page === "import" ? "filled" : "light"}
            onClick={() => setPage("import")}
          >
            Import player
          </Button>
          <Button
            variant={page === "downloads" ? "filled" : "light"}
            onClick={() => setPage("downloads")}
          >
            Downloads
          </Button>
        </Group>
        {page === "downloads" ? (
          <OtbDownloadControl settings />
        ) : page === "import" ? (
          <PlayerGameImportModal
            onClose={() => setPage("tournaments")}
            onDone={(_id, _message, result) => {
              if (result?.gameCount)
                onOpenPrep({
                  collectionId: result.collectionId,
                  playerName: result.playerName,
                  userSide: "white",
                  tournamentTitle: "OTB opponent",
                });
              else setPage("tournaments");
            }}
          />
        ) : (
          <TournamentPrepModal
            onClose={onClose}
            onChanged={() => {}}
            onOpenPrep={onOpenPrep}
            onOpenDatabase={onOpenDatabase}
          />
        )}
      </Stack>
    </TournamentEmbedded.Provider>
  );
}
