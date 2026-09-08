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
  const tacticalVariations = scan.variations.filter((variation) => variation.motifs.length > 0);
  const principalLine = scan.lineSan.length > 0 ? scan.lineSan : scan.lineUci;
  const principal =
    scan.variations.find((variation) => variation.multipv === 1) ?? scan.variations[0];
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
        {scan.motifs.length > 0 ? (
          <Alert
            color="orange"
            icon={<IconBolt size="1rem" />}
            title={`${scan.motifs.map((motif) => motif.label).join(" · ")} found`}
          >
            {sideLabel}'s main tactical idea{lastMoveSan ? ` after ${lastMoveSan}` : ""}:{" "}
            {scan.motifs[0]?.evidence}
          </Alert>
        ) : tacticalVariations.length > 0 ? (
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
              <Text fw={700}>No tactical theme verified</Text>
              <Text size="sm" c="dimmed" maw={390}>
                The bounded scan could not verify a specific theme in these candidate lines. This
                does not rule out a deeper tactic.
              </Text>
            </Stack>
          </Center>
        )}

        {onPreviewChange && selected !== principal?.multipv && principal && (
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Board arrows show the selected alternative, not a played move.
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={() => preview(principal.multipv)}>
              Restore main line
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
                        {motif.label}
                      </Badge>
                    ))}
                  </Group>
                  <Badge variant="light">
                    {variation.multipv === 1 ? "Main line" : "Alternative"}
                  </Badge>
                  {onPreviewChange && (
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
                {variation.motifs.slice(0, 1).map((motif) => (
                  <Stack key={motif.id} gap={2}>
                    <Text size="sm">{tacticalMotifDescription(motif)}</Text>
                    {motif.moveUci && (
                      <Text size="xs" c="dimmed">
                        Triggering move: <Code>{motif.moveUci}</Code> · {motif.confidence}{" "}
                        confidence
                      </Text>
                    )}
                  </Stack>
                ))}
                <TacticalLineExplanation moves={line} motifs={variation.timeline} />
              </Stack>
            </Paper>
          );
        })}

        {tacticalVariations.length === 0 && principalLine.length > 0 && (
          <Paper withBorder p="sm" radius="md">
            <Stack gap={6}>
              <Text fw={700} size="sm">
                Engine line
              </Text>
              <Box>
                <Code style={{ whiteSpace: "normal", lineHeight: 1.7 }}>
                  {principalLine.join("  ")}
                </Code>
              </Box>
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
