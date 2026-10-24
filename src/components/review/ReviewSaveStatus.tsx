import { Alert, Button, Stack, Text } from "@mantine/core";
import { useState, useSyncExternalStore } from "react";
import {
  flushReviewDeckWrites,
  reviewDeckWriteError,
  subscribeReviewDeckWrites,
} from "@/utils/reviewDeckWrites";

export default function ReviewSaveStatus({ path }: { path: string }) {
  const error = useSyncExternalStore(subscribeReviewDeckWrites, () => reviewDeckWriteError(path));
  const [retrying, setRetrying] = useState(false);
  if (!error) return null;
  return (
    <Alert color="red" title="Review progress is not saved" mb="sm" role="alert">
      <Stack gap="xs">
        <Text size="sm">{error} Your latest progress is kept here for retry.</Text>
        <Button
          variant="light"
          color="red"
          loading={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await flushReviewDeckWrites(path);
            } catch {
              /* The retained error stays visible for another retry. */
            } finally {
              setRetrying(false);
            }
          }}
        >
          Retry save
        </Button>
      </Stack>
    </Alert>
  );
}
