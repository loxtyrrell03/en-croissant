import { Alert, Button, Group, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import {
  assessDecisionEndgame,
  decisionEndgameFen,
  type DecisionEndgameAssessment,
  type DecisionEndgameTarget,
} from "@/utils/tacticalMotifs/decisionEndgame";
import { lookupDecisionEndgameEvidence } from "@/utils/tacticalMotifs/tablebaseLookup";

export function DecisionEndgameCheck({
  target,
  onResult,
}: {
  target: DecisionEndgameTarget;
  onResult: (result: DecisionEndgameAssessment) => void;
}) {
  const pending = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "done" | "error">("idle");
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  if (!decisionEndgameFen(target) || status === "done") return null;

  async function run() {
    if (pending.current) return;
    const owned = new AbortController();
    pending.current = owned;
    const active = () => pending.current === owned && !owned.signal.aborted;
    setStatus("checking");
    try {
      const evidence = await lookupDecisionEndgameEvidence(target, owned.signal);
      if (!active()) return;
      const result = assessDecisionEndgame(target, evidence);
      if (result) onResult(result);
      setStatus(result ? "done" : "error");
    } catch {
      if (active()) setStatus("error");
    } finally {
      if (pending.current === owned) pending.current = null;
    }
  }

  return (
    <>
      <Group gap={4}>
        {status === "checking" ? (
          <>
            <Text size="xs" role="status">
              Checking endgame…
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                pending.current?.abort();
                pending.current = null;
                setStatus("idle");
              }}
            >
              Cancel endgame check
            </Button>
          </>
        ) : (
          <Button size="compact-xs" variant="subtle" onClick={() => void run()}>
            {status === "error" ? "Retry endgame check" : "Check endgame online"}
          </Button>
        )}
        <PerformanceHelp label="About the endgame check">
          Sends this board and, when needed, up to two follow-up boards to Lichess. The tablebase
          uses the piece placement and move clock to verify wins, draws and losses.
        </PerformanceHelp>
      </Group>
      {status === "error" && (
        <Alert color="orange" role="alert">
          Couldn’t verify this endgame. You can try again.
        </Alert>
      )}
    </>
  );
}
