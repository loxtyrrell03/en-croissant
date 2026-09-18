import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Code,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconBolt } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { TacticalLineExplanation } from "./TacticalLineExplanation";
import {
  previewLiveTacticalVariation,
  liveTacticalMotifLabel,
  tacticalMotifDescription,
  type LiveTacticalScan,
} from "@/utils/tacticalMotifs/liveTactics";

export function TacticalScanResult({
  scan,
  lastMoveSan,
  onPreviewChange,
}: {
  scan: LiveTacticalScan;
  lastMoveSan: string | null;
  onPreviewChange?: (preview: LiveTacticalScan) => void;
}) {
  const sideLabel = scan.side === "white" ? "White" : "Black";
  const laterTheme = (scan.motifs[0]?.ply ?? 1) > 1;
  const tacticalVariations = scan.variations
    .filter((variation) => variation.motifs.length > 0 || variation.timeline.length > 0)
    .sort(
      (a, b) =>
        Number(b.multipv === scan.preferredMultipv) - Number(a.multipv === scan.preferredMultipv),
    );
  const principalLine = scan.lineSan.length > 0 ? scan.lineSan : scan.lineUci;
  const quietMain = (scan.preferredReason === "additional-tactical-option" || scan.preferredReason === "tactical-alternative")
    ? scan.variations.find(v => v.multipv === 1 && !v.motifs.length && !v.timeline.length)
    : undefined;
  const principal =
    scan.variations.find((variation) => variation.multipv === scan.preferredMultipv) ??
    scan.variations.find((variation) => variation.multipv === 1) ??
    scan.variations[0];
  const [selection, setSelection] = useState<{ scan: LiveTacticalScan; multipv: number } | null>(
    null,
  );
  const selected = selection?.scan === scan ? selection.multipv : principal?.multipv;
  useEffect(() => setSelection(null), [scan]);
  const preview = (multipv: number) => {
    setSelection({ scan, multipv });
    onPreviewChange?.(previewLiveTacticalVariation(scan, multipv));
  };

  return (
    <ScrollArea flex={1} offsetScrollbars>
      <Stack gap="sm" aria-live="polite">
        {scan.supplementalSearchIncomplete && (
          <Text size="sm" c="dimmed">
            Main analysis is ready. The additional candidate check was incomplete, so some tactical options may be missing.
          </Text>
        )}
        {scan.motifs.length > 0 ? (
          <Alert
            color="orange"
            icon={<IconBolt size="1rem" />}
            title={
              laterTheme
                ? `${scan.motifs[0].label} in the continuation`
                : scan.motifs[0].id === "matingThreat"
                  ? `${sideLabel} threatens mate`
                : `${scan.motifs.map((motif) => motif.label).join(" · ")} found`
            }
          >
            {laterTheme
              ? "In the displayed continuation"
              : scan.preferredMultipv
                ? `${sideLabel}'s immediate tactical option`
                : `${sideLabel}'s main tactical idea`}
            {lastMoveSan ? ` after ${lastMoveSan}` : ""}: {scan.motifs[0]?.evidence}
            {laterTheme && (
              <Text size="sm" mt="xs">
                This theme occurs after the replies shown. The scan has not verified it as the
                tactical explanation of the first move.
              </Text>
            )}
            {scan.preferredMultipv && (
              <Text size="sm" mt="xs">
                {scan.preferredReason === "larger-material-lesson"
                  ? "Showing a strong alternative with a clearer material-winning lesson. The engine's first choice is still listed below."
                  : scan.preferredReason === "additional-tactical-option"
                    ? "This separately checked alternative has an immediate tactical idea. It is not the engine's first choice."
                  : scan.preferredReason === "tactical-alternative"
                    ? "This close-scoring alternative has a verified immediate tactic. The engine's first choice is still listed below."
                  : "The engine's first line repeats this position before reaching the same tactic. Showing its separately analysed immediate alternative."}
              </Text>
            )}
          </Alert>
        ) : tacticalVariations.some((variation) => variation.motifs.length > 0) ? (
          <Alert color="blue" icon={<IconBolt size="1rem" />} title="Tactical alternatives">
            No theme was verified in the engine's main line. The alternatives below have identified
            tactical ideas; their continuations are separate choices.
          </Alert>
        ) : (
          <Center py="xl">
            <Stack align="center" gap="xs" ta="center">
              <ThemeIcon size="xl" radius="xl" variant="light" color="gray">
                <IconBolt size="1.25rem" />
              </ThemeIcon>
              <Text fw={700}>{tacticalVariations.length ? "No immediate theme verified" : "No tactical theme verified"}</Text>
              <Text size="sm" c="dimmed" maw={390}>
                {tacticalVariations.length
                  ? "The scan did not verify a tactical explanation for the first move. Later themes depend on the continuation shown."
                  : "The bounded scan could not verify a specific theme in these candidate lines. This does not rule out a deeper tactic."}
              </Text>
            </Stack>
          </Center>
        )}

        {onPreviewChange && selected !== principal?.multipv && principal && (
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Board arrows show the selected engine line, not a played move.
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={() => preview(principal.multipv)}>
              {scan.preferredMultipv ? "Restore immediate option" : "Restore main line"}
            </Button>
          </Group>
        )}

        {tacticalVariations.map((variation) => {
          const line = variation.lineSan.length > 0 ? variation.lineSan : variation.lineUci;
          const rootMove = line[0] ?? `PV ${variation.multipv}`;

          return (
            <Paper
              key={`${variation.multipv}:${variation.lineUci[0] ?? "line"}`}
              withBorder
              p="sm"
              radius="md"
              data-tactical-candidate={variation.multipv}
            >
              <Stack gap={6}>
                <Group justify="space-between" gap="xs">
                  <Group gap={6}>
                    <Badge color="blue" variant="light">
                      {rootMove}
                    </Badge>
                    {variation.motifs.slice(0, 1).map((motif) => (
                      <Badge key={motif.id} color="orange" variant="filled">
                        {liveTacticalMotifLabel(motif)}
                      </Badge>
                    ))}
                    {variation.motifs.length === 0 && (
                      <Badge color="gray" variant="light">
                        Continuation only
                      </Badge>
                    )}
                  </Group>
                  <Badge variant="light">
                    {variation.origin === "targeted" ? "Additional option" : variation.multipv === 1 ? "Main line" : "Alternative"}
                  </Badge>
                  {onPreviewChange && variation.motifs.length > 0 && (
                    <Button
                      size="compact-xs"
                      variant={selected === variation.multipv ? "filled" : "light"}
                      aria-label={`Show ${rootMove} on board`}
                      aria-pressed={selected === variation.multipv}
                      onClick={() => preview(variation.multipv)}
                    >
                      {selected === variation.multipv ? "On board" : "Show on board"}
                    </Button>
                  )}
                </Group>
                {variation.motifs.length === 0 && (
                  <Text size="sm" c="dimmed">
                    No first-move tactic was verified. The later themes below depend on the replies
                    shown.
                  </Text>
                )}
                {variation.motifs.slice(0, 1).map((motif) => (
                  <Stack key={motif.id} gap={2}>
                    <Text size="sm">{tacticalMotifDescription(motif)}</Text>
                    {motif.moveUci && (
                      <Text size="xs" c="dimmed">
                        {(motif.ply ?? 1) > 1 ? "Continuation move" : "Triggering move"}:{" "}
                        <Code>{motif.moveUci}</Code> · {motif.confidence} confidence
                      </Text>
                    )}
                    {(motif.ply ?? 1) > 1 && (
                      <Text size="xs" c="dimmed">
                        Depends on the replies shown.
                      </Text>
                    )}
                  </Stack>
                ))}
                <TacticalLineExplanation moves={line} motifs={variation.timeline} />
              </Stack>
            </Paper>
          );
        })}

        {(tacticalVariations.length === 0 || quietMain) && principalLine.length > 0 && (
          <Paper withBorder p="sm" radius="md">
            <Stack gap={6}>
              <Text fw={700} size="sm">
                {quietMain ? "Engine's first choice" : "Engine line"}
              </Text>
              <Box>
                <Code style={{ whiteSpace: "normal", lineHeight: 1.7 }}>
                  {(quietMain ? (quietMain.lineSan.length ? quietMain.lineSan : quietMain.lineUci) : principalLine).join("  ")}
                </Code>
              </Box>
              {quietMain && onPreviewChange && (
                <Button size="compact-xs" variant="subtle" onClick={() => preview(quietMain.multipv)}>
                  Show main line
                </Button>
              )}
            </Stack>
          </Paper>
        )}

        <Paper withBorder p="sm" radius="md">
          <Text size="xs" c="dimmed">
            {scan.engineName} · depth {scan.depth} · {scan.variations.length} candidate
            {scan.variations.length === 1 ? "" : "s"} · classifier {scan.motifClassifierVersion}
          </Text>
        </Paper>
      </Stack>
    </ScrollArea>
  );
}
