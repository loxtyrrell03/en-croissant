import { Alert, Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { IconRefresh, IconSparkles } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { commands, type PlanCoachRequest } from "@/bindings";
import {
  aiCoachEnabledAtom,
  aiCoachGeminiCommandAtom,
  aiCoachPlannerModelAtom,
  aiCoachTimeoutSecsAtom,
} from "@/state/atoms";
import { unwrap } from "@/utils/unwrap";

export type PlanCoachInlineRequest = Omit<PlanCoachRequest, "settings">;

type PlanCoachInlineProps = {
  request: PlanCoachInlineRequest;
  cacheKey: string;
  disabled?: boolean;
};

export default function PlanCoachInline({ request, cacheKey, disabled }: PlanCoachInlineProps) {
  const enabled = useAtomValue(aiCoachEnabledAtom);
  const geminiCommand = useAtomValue(aiCoachGeminiCommandAtom);
  const plannerModel = useAtomValue(aiCoachPlannerModelAtom);
  const timeoutSecs = useAtomValue(aiCoachTimeoutSecsAtom);
  const model = useMemo(() => normalizePlanCoachModel(plannerModel), [plannerModel]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAnswer(null);
    setModelUsed(null);
    setError(null);
  }, [cacheKey]);

  async function askPlanCoach() {
    if (!enabled) {
      setError("AI Coach is disabled in Settings.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = unwrap(
        await commands.askPlanCoach({
          ...request,
          settings: {
            enabled,
            geminiCommand,
            geminiModel: model,
            timeoutSecs,
          },
        }),
      );
      setAnswer(response.answer);
      setModelUsed(response.model);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap={6} mt={4} onClick={(event) => event.stopPropagation()}>
      <Group gap="xs" wrap="wrap">
        <Button
          size="compact-xs"
          variant={answer ? "light" : "subtle"}
          leftSection={answer ? <IconRefresh size="0.875rem" /> : <IconSparkles size="0.875rem" />}
          loading={loading}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            void askPlanCoach();
          }}
        >
          {answer ? "Refresh coach" : "Coach"}
        </Button>
        <Badge size="xs" variant="light">
          {modelUsed ?? model}
        </Badge>
      </Group>
      {error && (
        <Alert color="red" variant="light" py={6}>
          {error}
        </Alert>
      )}
      {answer && (
        <Paper withBorder p="xs" radius="sm">
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {answer}
          </Text>
        </Paper>
      )}
    </Stack>
  );
}

function normalizePlanCoachModel(model: string) {
  const trimmed = model.trim();
  if (!trimmed || trimmed.toLowerCase().includes("pro")) return "gemini-3.5-flash";
  return trimmed;
}
