import {
  Accordion,
  Badge,
  Box,
  Divider,
  Group,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconArrowRight, IconInfoCircle, IconRoute } from "@tabler/icons-react";
import { memo, useContext, useMemo } from "react";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { detectPawnStructure } from "@/utils/pawnStructureDetector";
import type {
  PawnStructureDetection,
  PawnStructureTransition,
  StructureSegment,
} from "@/utils/pawnStructureTypes";
import {
  analysePawnStructureTrajectoryFromTree,
  formatStructureRole,
} from "@/utils/pawnStructureTrajectory";
import classes from "./PawnStructurePanel.module.css";

function PawnStructurePanel() {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const structureVersion = useStore(store, (s) => s.structureVersion);
  const currentNode = useStore(store, (s) => s.currentNode());
  const goToMove = useStore(store, (s) => s.goToMove);

  const currentDetection = useMemo(
    () => detectPawnStructure(currentNode.fen),
    [currentNode.fen],
  );
  const trajectory = useMemo(
    () => {
      void structureVersion;
      return analysePawnStructureTrajectoryFromTree(root);
    },
    [root, structureVersion],
  );

  return (
    <Stack h="100%" gap={0}>
      <CurrentStructure detection={currentDetection} />
      <ScrollArea flex={1} offsetScrollbars>
        <Stack gap={0}>
          <Box className={classes.section}>
            <Group justify="space-between" align="center" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <IconRoute size="1rem" />
                <Text fw={700}>Structure trajectory</Text>
              </Group>
              <Badge variant="light" color="gray">
                {trajectory.segments.length} phases
              </Badge>
            </Group>
            <Text mt="xs" size="sm" c={trajectory.primaryStructure ? undefined : "dimmed"}>
              {trajectory.story}
            </Text>
          </Box>

          <Box className={classes.section}>
            <Stack gap="xs">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                Primary
              </Text>
              {trajectory.primaryStructure ? (
                <StructureSummary detection={trajectory.primaryStructure} />
              ) : (
                <Text size="sm" c="dimmed">
                  No stable primary structure in the analysed range.
                </Text>
              )}
              {trajectory.secondaryStructures.length > 0 && (
                <>
                  <Divider />
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                    Secondary
                  </Text>
                  <Group gap="xs">
                    {trajectory.secondaryStructures.map((structure) => (
                      <Tooltip key={structure.structureId} label={formatStructureRole(structure)}>
                        <Badge variant="light" color="gray">
                          {structure.canonicalName}
                        </Badge>
                      </Tooltip>
                    ))}
                  </Group>
                </>
              )}
            </Stack>
          </Box>

          <Box className={classes.section}>
            <Stack gap="xs">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                Timeline
              </Text>
              {trajectory.segments.map((segment, index) => (
                <SegmentRow
                  key={`${segment.structureId ?? "unknown"}-${segment.fromPly}-${index}`}
                  segment={segment}
                  onClick={() => goToMove(segment.fromPath ?? [])}
                />
              ))}
            </Stack>
          </Box>

          {trajectory.transitions.length > 0 && (
            <Box className={classes.section}>
              <Stack gap="xs">
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  Transitions
                </Text>
                {trajectory.transitions.map((transition) => (
                  <TransitionRow key={`${transition.ply}-${transition.toStructureId}`} transition={transition} />
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

function CurrentStructure({ detection }: { detection: PawnStructureDetection | null }) {
  return (
    <Box className={classes.section}>
      <Group justify="space-between" wrap="nowrap" align="center">
        <Group gap="xs" wrap="nowrap">
          <IconInfoCircle size="1rem" />
          <Text fw={700}>Current structure</Text>
        </Group>
        {detection && (
          <Badge variant="light" color={confidenceColor(detection.confidence)}>
            {formatConfidence(detection.confidence)}
          </Badge>
        )}
      </Group>

      {detection ? (
        <Stack mt="xs" gap={5}>
          <StructureSummary detection={detection} />
          <EvidenceAccordion detection={detection} />
        </Stack>
      ) : (
        <Text mt="xs" size="sm" c="dimmed">
          Unknown structure
        </Text>
      )}
    </Box>
  );
}

function StructureSummary({ detection }: { detection: PawnStructureDetection }) {
  return (
    <Stack gap={2}>
      <Group gap="xs" wrap="nowrap">
        <Text fw={700} truncate>
          {detection.canonicalName}
        </Text>
        {detection.fileMirrored && (
          <Badge size="xs" variant="outline" color="gray">
            mirrored
          </Badge>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        {formatStructureRole(detection)}
      </Text>
    </Stack>
  );
}

function EvidenceAccordion({ detection }: { detection: PawnStructureDetection }) {
  if (detection.evidence.length === 0) return null;
  return (
    <Accordion variant="separated" chevronPosition="right">
      <Accordion.Item value="evidence">
        <Accordion.Control px="xs" py={4}>
          <Text size="xs" fw={700} c="dimmed">
            Evidence
          </Text>
        </Accordion.Control>
        <Accordion.Panel px="xs" pb="xs">
          <Stack gap={4}>
            {detection.evidence.map((item) => (
              <Text key={item} size="xs" c="dimmed">
                {item}
              </Text>
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

function SegmentRow({ segment, onClick }: { segment: StructureSegment; onClick: () => void }) {
  const known = segment.structureId !== null;
  return (
    <UnstyledButton
      className={`${classes.timelineRow} ${known ? "" : classes.unknownRow}`}
      onClick={onClick}
      aria-label={`Go to move ${segment.fromMove}`}
    >
      <Stack gap={5}>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Text fw={700} size="sm" truncate c={known ? undefined : "dimmed"}>
            {segment.canonicalName ?? "Unknown structure"}
          </Text>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {segment.fromMove}-{segment.toMove}
          </Text>
        </Group>
        {known && (
          <Progress
            value={segment.averageConfidence * 100}
            size={3}
            radius="xs"
            color={confidenceColor(segment.averageConfidence)}
            aria-label="Average structure confidence"
          />
        )}
        {segment.story && (
          <Text size="xs" c="dimmed" lineClamp={2}>
            {segment.story}
          </Text>
        )}
      </Stack>
    </UnstyledButton>
  );
}

function TransitionRow({ transition }: { transition: PawnStructureTransition }) {
  return (
    <Stack gap={4} className={classes.transitionRow}>
      <Group gap="xs" wrap="nowrap">
        <Text size="sm" fw={700} style={{ whiteSpace: "nowrap" }}>
          {formatMoveLabel(transition)}
        </Text>
        <IconArrowRight size="0.8rem" />
        <Text size="sm" c="dimmed" truncate>
          {transition.toStructureId ?? "unknown"}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {transition.reason}
      </Text>
    </Stack>
  );
}

function formatMoveLabel(transition: PawnStructureTransition) {
  const marker = transition.ply % 2 === 0 ? "..." : ".";
  return transition.san
    ? `${transition.moveNumber}${marker} ${transition.san}`
    : `Move ${transition.moveNumber}`;
}

function formatConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function confidenceColor(confidence: number) {
  if (confidence >= 0.82) return "green";
  if (confidence >= 0.72) return "blue";
  return "yellow";
}

export default memo(PawnStructurePanel);
