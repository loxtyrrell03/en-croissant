import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { useState } from "react";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import { preparePhoneManualImport } from "./manualImport";
import classes from "./WebApp.module.css";

export default function PhoneManualImport({
  value,
  onChange,
  onImport,
  onFiles,
  importing,
}: {
  value: string;
  onChange: (value: string) => void;
  onImport: (input: ReturnType<typeof preparePhoneManualImport>) => Promise<unknown>;
  onFiles: (files: FileList | null) => Promise<void>;
  importing: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isFen = /^[prnbqkPRNBQK1-8]+\//.test(value.trim());
  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await onImport(preparePhoneManualImport(value));
      onChange("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack gap="sm" className={classes.manualImport} aria-label="Import PGN or FEN">
      <Group gap="xs">
        <Text fw={650}>Import games or a position</Text>
        <PerformanceHelp label="About PGN and FEN">
          PGN contains a game, including its moves and variations. FEN opens a single starting
          position.
        </PerformanceHelp>
      </Group>
      <Textarea
        label="Paste PGN or FEN"
        placeholder="1. e4 e5 2. Nf3… or a FEN position"
        minRows={3}
        maxRows={8}
        autosize
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          setError(null);
        }}
        error={error}
        disabled={busy}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className={classes.manualImportActions}>
        <Button disabled={!value.trim() || importing} loading={busy} onClick={() => void submit()}>
          {isFen ? "Open position" : "Import pasted games"}
        </Button>
        <Button
          component="label"
          variant="default"
          leftSection={<IconUpload size={16} />}
          loading={importing}
          disabled={busy}
        >
          Open PGN files
          <input
            hidden
            multiple
            type="file"
            accept=".pgn,application/x-chess-pgn,text/plain"
            disabled={busy || importing}
            onChange={(event) => {
              void onFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </Button>
      </div>
    </Stack>
  );
}
