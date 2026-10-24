import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

function ConfirmModal({
  title,
  description,
  opened,
  onClose,
  onConfirm,
  confirmLabel,
  busy = false,
  error,
}: {
  title: string;
  description: string;
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      withCloseButton={false}
      opened={opened}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
    >
      <Stack>
        <div>
          <Text fz="lg" fw="bold" mb={10}>
            {title}
          </Text>
          <Text>{description}</Text>
          <Text>{t("Common.CannotUndo")}</Text>
        </div>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}

        <Group justify="right">
          <Button variant="default" disabled={busy} onClick={() => onClose()}>
            {t("Common.Cancel")}
          </Button>
          <Button color="red" loading={busy} onClick={() => onConfirm()}>
            {confirmLabel || t("Common.Delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default ConfirmModal;
