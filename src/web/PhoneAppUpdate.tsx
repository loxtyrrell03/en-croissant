import { Button, Group, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { installWebAppLifecycle, type WebAppUpdateStatus } from "./webAppLifecycle";
import { webStateSession } from "./webStateSession";

export default function PhoneAppUpdate({ pasteDraft = "" }: { pasteDraft?: string }) {
  const lifecycle = useRef<ReturnType<typeof installWebAppLifecycle> | null>(null);
  const [status, setStatus] = useState<WebAppUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const controller = installWebAppLifecycle(import.meta.env.BASE_URL, webStateSession.canReload, {
      autoReload: false,
      onUpdate: setStatus,
    });
    lifecycle.current = controller;
    return () => {
      lifecycle.current = null;
      controller();
    };
  }, []);
  if (!status?.available) return null;
  return (
    <Stack gap={4} px="sm" py={6} role="status" aria-label="App update">
      <Group gap="xs" justify="space-between">
        <Text size="sm">An app update is ready.</Text>
        <Button
          size="xs"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              if (
                pasteDraft &&
                localStorage.getItem("en-croissant-phone-paste-draft-v1") !== pasteDraft
              ) {
                throw Error(
                  "Your pasted text is not saved yet. Import or copy it before updating.",
                );
              }
              await webStateSession.flush();
              if (!lifecycle.current?.apply(true))
                throw Error("Finish saving the workspace, then retry the update.");
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not save before updating. Your workspace remains open.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Update app
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Saves your workspace and reloads the app.
      </Text>
      {error && (
        <Text size="xs" c="red" role="alert">
          {error}
        </Text>
      )}
    </Stack>
  );
}
