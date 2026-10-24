import { Alert, Button, Stack, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useLoaderData } from "@tanstack/react-router";
import { useStore } from "jotai";
import { useRef, useState } from "react";
import { clearTabs } from "@/utils/clearTabs";

export function ClearTabsButton({ disabled = false }: { disabled?: boolean }) {
  const atoms = useStore();
  const { documentDir } = useLoaderData({ from: "/" });
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function clear() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await clearTabs(atoms, documentDir);
      if (!result.ok) setError(result.message);
      else if (result.warnings.length)
        notifications.show({
          title: "Tabs cleared",
          message: result.warnings.join("\n"),
          color: "yellow",
        });
      else if (result.saved)
        notifications.show({
          title: "Tabs cleared",
          message: "Games and changes saved.",
          color: "green",
        });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack gap={4} style={{ flexShrink: 0 }}>
      <Tooltip
        label="Save games and close all tabs. New games are saved in Files."
        openDelay={400}
        events={{ hover: true, focus: true, touch: true }}
        multiline
        w={250}
        style={{ maxWidth: "calc(100vw - 16px)" }}
      >
        <Button
          variant="default"
          radius={0}
          h="2.2rem"
          size="compact-sm"
          disabled={disabled || busy}
          loading={busy}
          aria-busy={busy}
          onClick={() => void clear()}
        >
          {busy ? "Saving…" : error ? "Retry Clear tabs" : "Clear tabs"}
        </Button>
      </Tooltip>
      {error && (
        <Alert
          color="red"
          title="Tabs kept open"
          withCloseButton
          onClose={() => setError(null)}
          style={{ maxWidth: "min(24rem, 80vw)", whiteSpace: "normal" }}
        >
          {error}
        </Alert>
      )}
    </Stack>
  );
}
