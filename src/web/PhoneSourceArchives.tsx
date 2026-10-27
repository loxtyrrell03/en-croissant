import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import { IconArchive, IconArrowBackUp } from "@tabler/icons-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import type { WebCompanionState, WebDatabase } from "./model";
import {
  phoneDatabaseArchive,
  phoneDatabaseArchivePath,
  setPhoneDatabaseArchived,
  setPhoneHostedArchived,
} from "./sourceArchives";

export function PhoneArchiveFilter({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Group gap={5} wrap="nowrap">
      <Button
        aria-label={checked ? "Back to active sources" : "Open archive"}
        aria-pressed={checked}
        variant={checked ? "filled" : "light"}
        onClick={() => onChange(!checked)}
        leftSection={checked ? <IconArrowBackUp size={16} /> : <IconArchive size={16} />}
        size="xs"
        mih={40}
      >
        {checked ? "Back to active" : "Archive"}
      </Button>
      <TournamentHelp label="Archived sources">
        Shared file and database archive labels sync with Novelty Dev. Device-only imports stay
        local. Archive shows only archived items, with folders leading to them; Back to active
        returns to your current files. Games and Prep stay saved.
      </TournamentHelp>
    </Group>
  );
}

export function PhoneSavedImports({
  state,
  setState,
  onOpen,
  onPrep,
}: {
  state: WebCompanionState;
  setState: Dispatch<SetStateAction<WebCompanionState>>;
  onOpen: (database: WebDatabase) => void;
  onPrep: (database: WebDatabase) => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  if (!state.databases.length) return null;
  const databases = state.databases.filter(
    (database) => Boolean(phoneDatabaseArchive(state, database)) === showArchived,
  );
  return (
    <Stack gap="xs">
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600}>
          {showArchived ? "Archived saved games" : "Saved games"}
        </Text>
        <PhoneArchiveFilter checked={showArchived} onChange={setShowArchived} />
      </Group>
      {!databases.length && (
        <Text size="sm" c="dimmed">
          {showArchived
            ? "No archived saved games."
            : "No active saved games. Open Archive to restore archived imports."}
        </Text>
      )}
      {databases.map((database) => {
        const archived = phoneDatabaseArchive(state, database);
        const archivePath = phoneDatabaseArchivePath(state, database);
        const pending = state.sourceArchives?.shared?.pending.some(
          (change) => change.path === (archived?.path ?? archivePath),
        );
        const parentArchived = archived?.path && archived.path !== archivePath;
        return (
          <Group
            key={database.id}
            justify="space-between"
            wrap="wrap"
            gap="xs"
            data-import-id={database.id}
          >
            <Stack gap={2} style={{ minWidth: 0, flex: "1 1 10rem" }}>
              <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                {database.name} · {database.gameCount} games
              </Text>
              {archived && (
                <Group gap={4}>
                  <Badge size="xs" color="gray">
                    Archived
                  </Badge>
                  {parentArchived && (
                    <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                      Folder: {archived.path}
                    </Text>
                  )}
                </Group>
              )}
            </Stack>
            <Group gap={4} wrap="wrap">
              <Button size="xs" variant="light" onClick={() => onOpen(database)}>
                Open
              </Button>
              {state.prepWorkspaces.some((prep) => prep.sourceIds.includes(database.id)) && (
                <Button size="xs" variant="subtle" onClick={() => onPrep(database)}>
                  Prep
                </Button>
              )}
              <Button
                size="xs"
                variant="subtle"
                style={{ minHeight: 40 }}
                loading={pending}
                aria-label={`${archived ? "Unarchive" : "Archive"} ${database.name}`}
                onClick={() =>
                  setState((current) =>
                    archived?.path
                      ? setPhoneHostedArchived(current, archived.path, false)
                      : setPhoneDatabaseArchived(current, database, !archived),
                  )
                }
              >
                {archived ? (parentArchived ? "Unarchive folder" : "Unarchive") : "Archive"}
              </Button>
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
}
