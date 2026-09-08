import { Badge, Group, Stack, Text } from "@mantine/core";
import type { TacticalMotifEvidence } from "@/utils/tacticalMotifs/types";

/** Keep the main lesson visible; expose conditional continuation details only
 * with the move that produces them. A reply is not labelled an available move. */
export function TacticalLineExplanation({
  moves,
  motifs,
  title = "Tactics through the line",
}: {
  moves: string[];
  motifs: TacticalMotifEvidence[];
  title?: string;
}) {
  if (!moves.length || !motifs.length) return null;
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>{title}</summary>
      <Stack gap={6} mt="xs">
        <Text size="xs" c="dimmed">
          These themes belong to this continuation; later moves depend on the replies shown.
        </Text>
        {moves.map((move, index) => {
          const here = motifs.filter((motif) => motif.ply === index + 1);
          return (
            <Stack key={`${index}:${move}`} gap={2}>
              <Group gap={6}>
                <Text size="xs" c="dimmed">
                  Ply {index + 1}
                </Text>
                <Text size="sm" fw={600}>
                  {move}
                </Text>
                {here.map((motif) => (
                  <Badge
                    key={motif.id}
                    size="xs"
                    variant={motif.relevance === "primary" ? "filled" : "light"}
                  >
                    {motif.label}
                  </Badge>
                ))}
              </Group>
              {here.map((motif) => (
                <Text key={motif.id} size="xs" c="dimmed">
                  {motif.evidence}
                </Text>
              ))}
            </Stack>
          );
        })}
      </Stack>
    </details>
  );
}
