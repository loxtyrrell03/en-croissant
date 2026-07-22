import {
  ActionIcon,
  Box,
  Collapse,
  Divider,
  Group,
  Stack,
  Text,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { IconChevronDown, IconX } from "@tabler/icons-react";
import { memo, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { ANNOTATION_INFO, type Annotation, isBasicAnnotation } from "@/utils/annotation";
import { getNodeAtPath } from "@/utils/treeReducer";
import AnnotationEditor from "./AnnotationEditor";

const BASIC = ["!!", "!", "!?", "?!", "?", "??"] as const;
const ADVANTAGE = ["+-", "±", "⩲", "=", "∞", "⩱", "∓", "-+"] as const;
const EXTRA = ["N", "↑↑", "↑", "→", "⇆", "=∞", "⊕", "∆", "□", "⨀", "⊗"] as const;

function MoveAnnotationPanel({ path, onClose }: { path: number[]; onClose: () => void }) {
  const store = useContext(TreeStateContext)!;
  const currentAnnotations = useStore(
    store,
    (state) => getNodeAtPath(state.root, path)?.annotations ?? [],
  );
  const [showMoreSymbols, setShowMoreSymbols] = useState(false);

  return (
    <Box
      data-testid="move-annotation-panel"
      mt={4}
      mb={4}
      p={5}
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-sm)",
        background: "var(--mantine-color-body)",
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <Stack gap={3}>
        <Group gap={3} wrap="nowrap">
          <Group gap={3} wrap="wrap" style={{ flex: 1, minWidth: 0 }}>
            {BASIC.map((annotation) => (
              <SymbolButton
                key={annotation}
                curAnnotations={currentAnnotations}
                annotation={annotation}
                path={path}
              />
            ))}
            <Divider orientation="vertical" />
            <Tooltip
              label={showMoreSymbols ? "Hide annotation symbols" : "More annotation symbols"}
            >
              <ActionIcon
                size={22}
                variant="default"
                onClick={() => setShowMoreSymbols((value) => !value)}
                style={{
                  transition: "transform 0.2s",
                  transform: showMoreSymbols ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                <IconChevronDown size="0.75rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Tooltip label="Close annotations">
            <ActionIcon size={22} variant="default" onClick={onClose}>
              <IconX size="0.75rem" />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Collapse in={showMoreSymbols}>
          <Stack gap={3}>
            <Group gap={3} wrap="wrap">
              {ADVANTAGE.map((annotation) => (
                <SymbolButton
                  key={annotation}
                  curAnnotations={currentAnnotations}
                  annotation={annotation}
                  path={path}
                />
              ))}
            </Group>
            <Group gap={3} wrap="wrap">
              {EXTRA.map((annotation) => (
                <SymbolButton
                  key={annotation}
                  curAnnotations={currentAnnotations}
                  annotation={annotation}
                  path={path}
                />
              ))}
            </Group>
          </Stack>
        </Collapse>
        <AnnotationEditor path={path} compact />
      </Stack>
    </Box>
  );
}

const SymbolButton = memo(function SymbolButton({
  curAnnotations,
  annotation,
  path,
}: {
  curAnnotations: Annotation[];
  annotation: Annotation;
  path: number[];
}) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const setAnnotationAtPath = useStore(store, (state) => state.setAnnotationAtPath);
  const { translationKey, name, color } = ANNOTATION_INFO[annotation];
  const isActive = curAnnotations.includes(annotation);
  const theme = useMantineTheme();

  return (
    <Tooltip label={translationKey ? t(`Annotate.${translationKey}`) : name} position="bottom">
      <ActionIcon
        size={22}
        onClick={() => setAnnotationAtPath(path, annotation)}
        variant={isActive ? "filled" : "default"}
        color={isBasicAnnotation(annotation) ? color : theme.primaryColor}
      >
        <Text fz={10} lh={1}>
          {annotation}
        </Text>
      </ActionIcon>
    </Tooltip>
  );
});

export default memo(MoveAnnotationPanel);
