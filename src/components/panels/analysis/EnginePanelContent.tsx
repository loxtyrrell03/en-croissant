import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
  Accordion,
  ActionIcon,
  Button,
  Card,
  Group,
  Kbd,
  Paper,
  Popover,
  ScrollArea,
  Space,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import {
  IconChevronsRight,
  IconPlayerPause,
  IconSelector,
  IconSettings,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { startTransition, useContext, useDeferredValue, useMemo, useOptimistic } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  activeTabAtom,
  allEnabledAtom,
  currentExpandedEnginesAtom,
  enableAllAtom,
  engineMovesFamily,
  enginesAtom,
  showArrowsAtom,
  tabEngineSettingsFamily,
} from "@/state/atoms";
import { getVariationLine } from "@/utils/chess";
import { getPiecesCount, hasCaptures, isOp1, positionFromFen } from "@/utils/chessops";
import type { Engine } from "@/utils/engines";
import { getInitials } from "@/utils/format";
import BestMoves, { arrowColors } from "./BestMoves";
import EngineSelection from "./EngineSelection";
import ScoreBubble from "./ScoreBubble";
import TablebaseInfo from "./TablebaseInfo";

export default function EnginePanelContent({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;
  const rootFen = useStore(store, (s) => s.root.fen);
  const headers = useStore(store, (s) => s.headers);
  const currentNodeFen = useStore(
    store,
    useShallow((s) => s.currentNode().fen),
  );
  const moves = useStore(
    store,
    useShallow((s) => getVariationLine(s.root, s.position)),
  );
  const currentNodeHalfMoves = useStore(
    store,
    useShallow((s) => s.currentNode().halfMoves),
  );

  const [engines, setEngines] = useAtom(enginesAtom);
  const [optimisticEngines, setOptimisticEngines] = useOptimistic<Engine[], Engine[]>(
    engines ?? [],
    (_, newEngines) => newEngines,
  );

  const loadedEngines = useMemo(
    () => optimisticEngines.filter((e) => e.loaded),
    [optimisticEngines],
  );

  const [, enable] = useAtom(enableAllAtom);
  const allEnabled = useAtomValue(allEnabledAtom);
  const [expanded, setExpanded] = useAtom(currentExpandedEnginesAtom);
  const [showEngineArrows, setShowEngineArrows] = useAtom(showArrowsAtom);
  const [pos] = positionFromFen(currentNodeFen);
  const navigate = useNavigate();

  return (
    <Stack h="100%" gap={compact ? 6 : "sm"} style={{ minHeight: 0 }}>
      <ScrollArea
        flex={1}
        offsetScrollbars
        onScrollPositionChange={() => document.dispatchEvent(new Event("analysis-panel-scroll"))}
      >
        <Stack gap={compact ? 6 : "sm"} p={compact ? 6 : 0}>
          <Paper withBorder p={compact ? 6 : "xs"}>
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Text size="sm" fw={600}>
                Engine arrows
              </Text>
              <Switch
                size={compact ? "sm" : "md"}
                checked={showEngineArrows}
                onChange={(event) => setShowEngineArrows(event.currentTarget.checked)}
                aria-label={showEngineArrows ? "Hide engine arrows" : "Show engine arrows"}
              />
            </Group>
          </Paper>
          {pos &&
            (getPiecesCount(pos) <= 7 ||
              (getPiecesCount(pos) === 8 && (hasCaptures(pos) || isOp1(pos)))) && (
              <>
                <TablebaseInfo fen={currentNodeFen} turn={pos.turn} />
                <Space h={compact ? 2 : "sm"} />
              </>
            )}
          {loadedEngines.length > 1 && (
            <Paper withBorder p="xs" flex={1}>
              <Group w="100%" gap="xs" wrap="nowrap">
                <ActionIcon size="lg" variant="default" onClick={() => enable(!allEnabled)}>
                  {allEnabled ? (
                    <IconPlayerPause size="1.25rem" />
                  ) : (
                    <IconChevronsRight size="1.25rem" />
                  )}
                </ActionIcon>
                <Group grow flex={1} gap="xs">
                  {loadedEngines.map((engine, i) => (
                    <EngineSummary
                      key={engine.name}
                      engine={engine}
                      fen={rootFen}
                      moves={moves}
                      shorten={loadedEngines.length > 3}
                      i={i}
                    />
                  ))}
                </Group>
              </Group>
            </Paper>
          )}
          <Text size="xs" c="dimmed" px={compact ? 2 : 0} style={{ lineHeight: 1.8 }}>
            Press <Kbd>E</Kbd> to toggle engine. <Kbd>Space</Kbd> plays best move. Click moves to
            explore.
          </Text>
          <Accordion
            variant="separated"
            multiple
            chevronSize={0}
            value={expanded ?? loadedEngines.map((e) => e.name)}
            onChange={(v) => setExpanded(v)}
            styles={{
              label: {
                paddingTop: 0,
                paddingBottom: 0,
              },
              content: {
                padding: "0.3rem",
              },
            }}
          >
            <DragDropContext
              onDragEnd={({ destination, source }) => {
                if (destination?.index === undefined) return;
                startTransition(async () => {
                  const reordered = reorderEngines(
                    optimisticEngines,
                    source.index,
                    destination.index,
                  );
                  setOptimisticEngines(reordered);
                  await setEngines(reordered);
                });
              }}
            >
              <Droppable
                droppableId={compact ? "engine-dock-droppable" : "droppable"}
                direction="vertical"
              >
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps}>
                    <Stack w="100%" gap="xs">
                      {loadedEngines.map((engine, i) => (
                        <Draggable
                          key={engine.name + i.toString()}
                          draggableId={engine.name}
                          index={i}
                        >
                          {(provided) => (
                            <div ref={provided.innerRef} {...provided.draggableProps}>
                              <Accordion.Item value={engine.name}>
                                <BestMoves
                                  id={i}
                                  engine={engine}
                                  fen={rootFen}
                                  moves={moves}
                                  halfMoves={currentNodeHalfMoves}
                                  dragHandleProps={provided.dragHandleProps}
                                  orientation={headers.orientation || "white"}
                                />
                              </Accordion.Item>
                            </div>
                          )}
                        </Draggable>
                      ))}
                    </Stack>

                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </Accordion>
          <Group gap="xs">
            <Button
              flex={1}
              variant="default"
              onClick={() => {
                navigate({ to: "/engines" });
              }}
              leftSection={<IconSettings size="0.875rem" />}
            >
              {t("Board.Analysis.ManageEngines")}
            </Button>
            <Popover width={250} position="top-end" shadow="md">
              <Popover.Target>
                <ActionIcon variant="default" size="lg">
                  <IconSelector />
                </ActionIcon>
              </Popover.Target>

              <Popover.Dropdown>
                <EngineSelection />
              </Popover.Dropdown>
            </Popover>
          </Group>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

function reorderEngines(
  engines: Engine[],
  sourceIndex: number,
  destinationIndex: number,
): Engine[] {
  const result = Array.from(engines);
  const loaded = result.filter((e) => e.loaded);
  const [removed] = loaded.splice(sourceIndex, 1);
  loaded.splice(destinationIndex, 0, removed);

  result.forEach((e, i) => {
    if (e.loaded) {
      result[i] = loaded.shift()!;
    }
  });

  return result;
}

function EngineSummary({
  engine,
  fen,
  moves,
  shorten,
  i,
}: {
  engine: Engine;
  fen: string;
  moves: string[];
  shorten: boolean;
  i: number;
}) {
  const activeTab = useAtomValue(activeTabAtom);
  const [ev] = useAtom(engineMovesFamily({ engine: engine.id, tab: activeTab! }));
  const settings = useAtomValue(
    tabEngineSettingsFamily({
      tab: activeTab!,
      engineId: engine.id,
      defaultSettings: engine.type === "local" ? engine.settings || [] : undefined,
      defaultGo: engine.go ?? undefined,
    }),
  );

  const curEval = useDeferredValue(
    useMemo(() => ev.get(`${fen}:${moves.join(",")}`), [ev, fen, moves]),
  );
  const score = settings.enabled && curEval && curEval.length > 0 ? curEval[0].score : null;

  return (
    <Card withBorder c={arrowColors[i]?.strong} py={4} px="xs">
      <Group gap="xs" wrap="nowrap" justify="center">
        <Text
          fw="bold"
          fz="xs"
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {(shorten && engine.name.length > 3) || engine.name.length > 10
            ? `${getInitials(engine.name)}.`
            : engine.name}
        </Text>
        {score ? (
          <ScoreBubble size="sm" score={score} />
        ) : (
          <Text fz="sm" c="dimmed">
            ???
          </Text>
        )}
      </Group>
    </Card>
  );
}
