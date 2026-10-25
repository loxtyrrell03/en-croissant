import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAppearanceReset, type AppearanceResetStatus } from "@/utils/appearanceReset";

/** Native menu replacement: changes presentation without unloading the workspace. */
export default function AppearanceResetModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const controller = useMemo(() => createAppearanceReset(store), [store]);
  const read = useCallback(() => {
    try {
      return { status: controller.status(), error: "" };
    } catch (cause) {
      return {
        status: null,
        error:
          cause instanceof Error
            ? cause.message
            : "Could not read appearance settings. Retry lookup.",
      };
    }
  }, [controller]);
  const [view, setView] = useState<{ status: AppearanceResetStatus | null; error: string }>(read);
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const focusResult = useRef(false);
  const errorText = useRef<HTMLParagraphElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focusResult.current) return;
    focusResult.current = false;
    const target = view.error ? errorText.current : primaryButton.current;
    if (target && !(target instanceof HTMLButtonElement && target.disabled)) target.focus();
    else closeButton.current?.focus();
  }, [view, notice]);
  function run(action: "reset" | "restore" | "keep") {
    if (busy.current) return;
    busy.current = true;
    focusResult.current = true;
    setNotice("");
    try {
      controller[action]();
      const next = read();
      setView(next);
      if (!next.error)
        setNotice(
          action === "reset" && next.status?.backup
            ? "Appearance reset. You can restore your previous settings."
            : action === "reset"
              ? "These appearance settings already use their defaults."
              : action === "restore"
                ? "Previous appearance restored."
                : "Current appearance kept.",
        );
    } catch (cause) {
      setView({
        status: read().status,
        error:
          cause instanceof Error ? cause.message : "Could not update appearance settings. Retry.",
      });
    } finally {
      busy.current = false;
    }
  }
  return (
    <Modal opened onClose={onClose} title="Reset appearance and layout" centered>
      <Stack gap="sm">
        <Text size="sm">
          Reset board style, pieces, background, text size and board/pane sizes. Games, annotations,
          databases, accounts and other settings stay saved.
        </Text>
        {view.status?.backup && (
          <Text size="sm">
            A previous appearance is backed up. Restore previous replaces your current appearance;
            Keep current removes the undo copy.
          </Text>
        )}
        {view.status && !view.status.backup && !view.status.customized && (
          <Text size="sm" c="dimmed">
            These appearance settings already use their defaults.
          </Text>
        )}
        {view.error && (
          <Text size="sm" c="red" role="alert" tabIndex={-1} ref={errorText}>
            {view.error}
          </Text>
        )}
        {notice && (
          <Text size="sm" role="status">
            {notice}
          </Text>
        )}
        <Group gap="xs" justify="flex-end" wrap="wrap">
          <Button variant="default" onClick={onClose} ref={closeButton} data-autofocus>
            Close
          </Button>
          {!view.status || view.error ? (
            <Button
              variant="default"
              onClick={() => {
                focusResult.current = true;
                setNotice("");
                setView(read());
              }}
            >
              Retry lookup
            </Button>
          ) : null}
          {view.status?.backup ? (
            <>
              <Button variant="default" onClick={() => run("keep")}>
                Keep current
              </Button>
              <Button onClick={() => run("restore")} ref={primaryButton}>
                Restore previous
              </Button>
            </>
          ) : (
            <Button
              disabled={!view.status?.customized}
              onClick={() => run("reset")}
              ref={primaryButton}
            >
              Reset appearance
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
