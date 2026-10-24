import { Anchor, Stack, Text } from "@mantine/core";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";

export function FideProfileLink({ playerId }: { playerId: number }) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const pending = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );
  const url = `https://ratings.fide.com/profile/${playerId}`;
  return (
    <Stack gap={4}>
      <Anchor
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={opening || undefined}
        aria-busy={opening || undefined}
        onClick={async (event) => {
          if (!isTauri()) return;
          event.preventDefault();
          if (pending.current) return;
          const token = Symbol();
          pending.current = token;
          setOpening(true);
          setError(null);
          try {
            await openUrl(url);
          } catch {
            if (pending.current === token)
              setError(
                "The browser could not open the profile. Select Open FIDE profile to retry.",
              );
          } finally {
            if (pending.current === token) {
              pending.current = null;
              setOpening(false);
            }
          }
        }}
      >
        Open FIDE profile
      </Anchor>
      {error && (
        <Text c="red" size="sm" role="alert">
          {error}
        </Text>
      )}
    </Stack>
  );
}
