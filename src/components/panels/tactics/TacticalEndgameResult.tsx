import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { makeSan } from "chessops/san";
import type { LiveTacticalScan, LiveTacticalScanInput } from "@/utils/tacticalMotifs/liveTactics";
import { classifyLiveTacticsInWorker } from "@/utils/tacticalMotifs/liveTacticsWorker";
import { tablebaseTacticalRequests } from "@/utils/tacticalMotifs/tablebaseEvidence";
import { lookupTacticalEndgameEvidence } from "@/utils/tacticalMotifs/tablebaseLookup";
import { TacticalScanResult } from "./TacticalScanResult";

export function TacticalEndgameResult({
  scan,
  input,
  lastMoveSan,
  onPreviewChange,
}: {
  scan: LiveTacticalScan;
  input: LiveTacticalScanInput;
  lastMoveSan?: string | null;
  onPreviewChange: (scan: LiveTacticalScan | null) => void;
}) {
  const pending = useRef<AbortController | null>(null);
  const [verification, setVerification] = useState<{
    source: LiveTacticalScan;
    status: "checking" | "done" | "error";
    result?: LiveTacticalScan;
    error?: string;
  } | null>(null);
  const current = verification?.source === scan ? verification : null;
  const request = tablebaseTacticalRequests(scan.fen, scan.lineUci[0] ?? "");
  const eligible =
    input.fen === scan.fen &&
    request &&
    (request.kind === "drawingCapture" || request.after.board.occupied.size() > 3);
  const capture = request?.kind === "drawingCapture";
  const moveLabel = request ? makeSan(request.before, request.move) : scan.lineUci[0];
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [scan],
  );

  const verify = async () => {
    if (pending.current || !eligible) return;
    const controller = new AbortController();
    pending.current = controller;
    const active = () => pending.current === controller && !controller.signal.aborted;
    setVerification({ source: scan, status: "checking" });
    try {
      const tablebaseEvidence = await lookupTacticalEndgameEvidence(
        scan.fen,
        scan.lineUci[0],
        controller.signal,
      );
      if (!active()) return;
      const result = await classifyLiveTacticsInWorker(
        { ...input, tablebaseEvidence },
        controller.signal,
      );
      if (!active()) return;
      setVerification({ source: scan, status: "done", result });
      onPreviewChange(result);
    } catch (error) {
      if (active())
        setVerification({
          source: scan,
          status: "error",
          error:
            error instanceof Error ? error.message : "Online endgame verification is unavailable.",
        });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };
  return (
    <Stack gap="xs" flex={1} mih={0}>
      {eligible && (
        <Stack gap={4}>
          <Group gap="xs">
            {current?.status !== "done" && (
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={current?.status === "checking"}
                onClick={() => void verify()}
              >
                {current?.status === "checking"
                  ? "Checking endgame…"
                  : current?.status === "error"
                    ? "Retry endgame check"
                    : `Verify ${moveLabel} online`}
              </Button>
            )}
            {current?.status === "checking" && (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => {
                  pending.current?.abort();
                  pending.current = null;
                  setVerification(null);
                }}
              >
                Cancel verification
              </Button>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {current?.status === "done"
              ? current.result?.variations
                  .find((line) => line.lineUci[0] === scan.lineUci[0])
                  ?.motifs.some((m) => m.id === request?.kind && m.ply === 1)
                ? `${capture ? "Saving draw" : "Zugzwang"} verified after ${moveLabel}.`
                : `No ${capture ? "necessary saving capture" : "outcome-changing zugzwang"} verified after ${moveLabel}.`
              : `Optional ${capture ? "saving-draw" : "zugzwang"} check: sends this position to Lichess. The local result stays available.`}
          </Text>
          {current?.status === "error" && (
            <Alert color="orange" title="Online verification unavailable">
              {current.error} The local scan is unchanged.
            </Alert>
          )}
        </Stack>
      )}
      <TacticalScanResult
        scan={current?.result ?? scan}
        lastMoveSan={lastMoveSan ?? null}
        onPreviewChange={onPreviewChange}
      />
    </Stack>
  );
}
