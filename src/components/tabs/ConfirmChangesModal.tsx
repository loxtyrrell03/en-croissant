import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useLoaderData } from "@tanstack/react-router";
import { useState } from "react";
import { saveToFile, type Tab } from "@/utils/tabs";
import type { TabSaveTarget } from "@/utils/tabSaveTarget";
import type { TreeStore } from "@/state/store/tree";

function ConfirmChangesModal({
  opened,
  onClose,
  closeTab,
  tab,
  target,
  store,
  saveLabel = "Save and Close",
  discardLabel = "Close Without Saving",
  description,
}: {
  opened: boolean;
  onClose: () => void;
  closeTab: () => boolean | void | Promise<boolean | void>;
  tab: Tab;
  target: TabSaveTarget;
  store: TreeStore;
  saveLabel?: string;
  discardLabel?: string;
  description?: string;
}) {
  const { documentDir } = useLoaderData({ from: "/" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveToFile({
        dir: documentDir,
        target,
        tab,
        store,
        isUserSave: true,
      });
      if (!saved) return;
      if (store.getState().dirty) {
        setError(
          "An earlier version was saved. Your newer changes are still open; save again to close.",
        );
        return;
      }
      if ((await closeTab()) === false) {
        setError("The game could not close. It is still open; retry.");
        return;
      }
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      withCloseButton={false}
      opened={opened}
      onClose={() => {
        if (!saving) onClose();
      }}
      closeOnEscape={!saving}
      closeOnClickOutside={!saving}
    >
      <Stack>
        <div>
          <Text fz="lg" fw="bold" mb={10}>
            Unsaved Changes
          </Text>
          <Text>
            {description ?? `You have unsaved changes in ${tab.name}. Save them before closing?`}
          </Text>
        </div>

        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}

        <Group justify="right">
          <Button
            variant="default"
            disabled={saving}
            onClick={async () => {
              try {
                if ((await closeTab()) !== false) onClose();
                else setError("The game could not close. It is still open; retry.");
              } catch (error) {
                setError(String(error));
              }
            }}
          >
            {discardLabel}
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            {saveLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default ConfirmChangesModal;
