import { Button, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowRight } from "@tabler/icons-react";
import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { commands } from "@/bindings";

export default function DatabasePgnExportButton({
  file,
  title,
  label,
}: {
  file: string;
  title: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function exportPgn() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let completed: string | null = null;
    try {
      const destination = await save({ filters: [{ name: "PGN", extensions: ["pgn"] }] });
      if (!destination) return;
      const response = await commands.exportToPgn(file, destination);
      if (response.status === "error") throw new Error(response.error);
      completed = destination;
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure);
      if (alive.current) setError(detail);
      else
        notifications.show({
          title: `Could not export ${title}`,
          message: detail,
          color: "red",
          autoClose: false,
        });
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
    if (completed)
      notifications.show({ title: `Exported ${title}`, message: completed, color: "green" });
  }

  return (
    <Stack gap={4} style={{ minWidth: 0 }}>
      <Button
        rightSection={<IconArrowRight size="1rem" />}
        variant="default"
        loading={busy}
        onClick={() => void exportPgn()}
      >
        {label}
      </Button>
      {error && (
        <Text size="xs" c="red" role="alert" maw={360} style={{ overflowWrap: "anywhere" }}>
          {error}
        </Text>
      )}
    </Stack>
  );
}
