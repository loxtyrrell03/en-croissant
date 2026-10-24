import { Badge, Button, Checkbox, Group, Stack, Text } from "@mantine/core";
import { useState, type Dispatch, type SetStateAction } from "react";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import type { WebCompanionState, WebDatabase } from "./model";
import {
  phoneDatabaseArchive,
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
      <Checkbox
        label="Show archived"
        aria-label="Show archived sources"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        size="xs"
        styles={{ body: { alignItems: "center", minHeight: 40 } }}
      />
      <TournamentHelp label="Archived sources">
        Archive hides an item on this device. Files, games and existing Prep stay saved; Show
        archived lets you restore it.
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
    (database) => showArchived || !phoneDatabaseArchive(state, database),
  );
  return (
    <Stack gap="xs">
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600}>
          Saved games
        </Text>
        <PhoneArchiveFilter checked={showArchived} onChange={setShowArchived} />
      </Group>
      {!databases.length && (
        <Text size="sm" c="dimmed">
          All saved imports are archived.
        </Text>
      )}
      {databases.map((database) => {
        const archived = phoneDatabaseArchive(state, database);
        const parentArchived =
          archived?.path && archived.path !== (database.hostedFilePath ?? database.hostedPath);
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
