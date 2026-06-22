import {
  Accordion,
  ActionIcon,
  Box,
  Code,
  Collapse,
  Group,
  Progress,
  Skeleton,
  Stack,
  Table,
  Text,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import {
  IconArrowUpRight,
  IconGripVertical,
  IconPinned,
  IconPinnedOff,
  IconPlayerPause,
  IconPlayerPlay,
  IconSettings,
  IconTargetArrow,
} from "@tabler/icons-react";
import { parseUci } from "chessops";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import equal from "fast-deep-equal";
import { useAtom, useAtomValue } from "jotai";
import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import type { BestMoves } from "@/bindings";
import {
  activeTabAtom,
  currentDetachedEngineAtom,
  currentThreatAtom,
  engineMovesFamily,
  engineProgressFamily,
  enginesAtom,
  showArrowsAtom,
  tabEngineSettingsFamily,
} from "@/state/atoms";
import { getBestMoveSourceLabel } from "@/utils/analysisSource";
import { chessopsError, positionFromFen, swapMove } from "@/utils/chessops";
import type { Engine } from "@/utils/engines";
import { formatNodes } from "@/utils/format";
import { formatScore } from "@/utils/score";
import AnalysisRow from "./AnalysisRow";
import classes from "./BestMoves.module.css";
import EngineSettingsForm, { type Settings } from "./EngineSettingsForm";

export const arrowColors = [
  { strong: "blue", pale: "paleBlue" },
  { strong: "green", pale: "paleGreen" },
  { strong: "red", pale: "paleRed" },
  { strong: "yellow", pale: "yellow" }, // there's no paleYellow in chessground
];

interface BestMovesProps {
  id: number;
  engine: Engine;
  fen: string;
  moves: string[];
  halfMoves: number;
  dragHandleProps: any;
  orientation: "white" | "black";
  compact?: boolean;
}

function BestMovesComponent({
  id,
  engine,
  fen,
  moves,
  halfMoves,
  dragHandleProps,
  orientation,
  compact = false,
}: BestMovesProps) {
  const { t } = useTranslation();

  const activeTab = useAtomValue(activeTabAtom);
  const ev = useAtomValue(engineMovesFamily({ engine: engine.id, tab: activeTab! }));
  const progress = useAtomValue(engineProgressFamily({ engine: engine.id, tab: activeTab! }));
  const [, setEngines] = useAtom(enginesAtom);
  const [settings, setSettings2] = useAtom(
    tabEngineSettingsFamily({
      engineId: engine.id,
      defaultSettings: engine.settings ?? undefined,
      defaultGo: engine.go ?? undefined,
      tab: activeTab!,
    }),
  );

  useEffect(() => {
    if (settings.synced) {
      setSettings2((prev) => ({
        ...prev,
        go: engine.go || prev.go,
        settings: engine.settings || prev.settings,
      }));
    }
  }, [engine.settings, engine.go, settings.synced, setSettings2]);

  const setSettings = useCallback(
    (fn: (prev: Settings) => Settings) => {
      const newSettings = fn(settings);
      setSettings2(newSettings);
      if (newSettings.synced) {
        setEngines(async (prev) =>
          (await prev).map((o) =>
            o.id === engine.id ? { ...o, settings: newSettings.settings, go: newSettings.go } : o,
          ),
        );
      }
    },
    [engine, settings, setSettings2, setEngines],
  );

  const [settingsOn, toggleSettingsOn] = useToggle();
  const [threat, setThreat] = useAtom(currentThreatAtom);
  const [detachedEngineId, setDetachedEngineId] = useAtom(currentDetachedEngineAtom);
  const [showEngineArrows, setShowEngineArrows] = useAtom(showArrowsAtom);
  const isDetached = detachedEngineId === engine.id;
  const theme = useMantineTheme();

  const [pos, error] = positionFromFen(fen);
  if (pos) {
    for (const uci of moves) {
      const move = parseUci(uci);
      if (!move) {
        console.log("Invalid move", uci);
        break;
      }
      pos.play(move);
    }
  }

  const isGameOver = pos?.isEnd() ?? false;
  const finalFen = useMemo(() => (pos ? makeFen(pos.toSetup()) : null), [pos]);

  const { searchingFen, searchingMoves } = useMemo(
    () =>
      match(threat)
        .with(true, () => ({
          searchingFen: swapMove(finalFen || INITIAL_FEN),
          searchingMoves: [],
        }))
        .with(false, () => ({
          searchingFen: fen,
          searchingMoves: moves,
        }))
        .exhaustive(),
    [fen, moves, threat, finalFen],
  );
  const searchKey = useMemo(
    () => `${searchingFen}:${searchingMoves.join(",")}`,
    [searchingFen, searchingMoves],
  );

  const engineVariations = useDeferredValue(useMemo(() => ev.get(searchKey), [ev, searchKey]));
  const displayedEngineVariations = settings.enabled ? engineVariations : undefined;

  return (
    <>
      <Box
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: compact ? "2.1rem" : undefined,
        }}
      >
        <Stack gap={0} py={compact ? 3 : "1rem"}>
          <ActionIcon
            size={compact ? "sm" : "md"}
            variant={settings.enabled ? "filled" : "transparent"}
            color={id < 4 ? arrowColors[id].strong : theme.primaryColor}
            onClick={() => {
              setSettings((prev) => ({ ...prev, enabled: !prev.enabled }));
            }}
            ml={compact ? 6 : 12}
          >
            {settings.enabled ? (
              <IconPlayerPause size={compact ? "0.8rem" : "1rem"} />
            ) : (
              <IconPlayerPlay size={compact ? "0.8rem" : "1rem"} />
            )}
          </ActionIcon>
        </Stack>
        <Accordion.Control style={compact ? { padding: "0.15rem 0.35rem" } : undefined}>
          <EngineTop
            name={engine.name}
            engineVariations={displayedEngineVariations}
            isGameOver={isGameOver}
            enabled={settings.enabled}
            progress={progress}
            compact={compact}
          />
        </Accordion.Control>
        <ActionIcon.Group>
          <Tooltip label="Check the opponent's threat">
            <ActionIcon
              size={compact ? "sm" : "lg"}
              onClick={() => setThreat(!threat)}
              disabled={!settings.enabled}
              variant="transparent"
              mt="auto"
              mb="auto"
            >
              <IconTargetArrow
                color={threat ? "red" : undefined}
                size={compact ? "0.8rem" : "1rem"}
              />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={isDetached ? "Unpin from notation" : "Pin above notation"}>
            <ActionIcon
              size={compact ? "sm" : "lg"}
              onClick={() =>
                startTransition(() => {
                  setDetachedEngineId(isDetached ? null : engine.id);
                })
              }
              variant={isDetached ? "light" : "transparent"}
              mt="auto"
              mb="auto"
            >
              {isDetached ? (
                <IconPinnedOff size={compact ? "0.8rem" : "1rem"} />
              ) : (
                <IconPinned size={compact ? "0.8rem" : "1rem"} />
              )}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={showEngineArrows ? "Hide engine arrows" : "Show engine arrows"}>
            <ActionIcon
              size={compact ? "sm" : "lg"}
              onClick={() => setShowEngineArrows((value) => !value)}
              variant={showEngineArrows ? "light" : "transparent"}
              color={id < 4 ? arrowColors[id].strong : theme.primaryColor}
              mt="auto"
              mb="auto"
              aria-label={showEngineArrows ? "Hide engine arrows" : "Show engine arrows"}
            >
              <IconArrowUpRight size={compact ? "0.8rem" : "1rem"} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon
            size={compact ? "sm" : "lg"}
            onClick={() => toggleSettingsOn()}
            mt="auto"
            mb="auto"
          >
            <IconSettings size={compact ? "0.8rem" : "1rem"} />
          </ActionIcon>
          <ActionIcon
            size={compact ? "sm" : "lg"}
            mr={compact ? 4 : 8}
            mt="auto"
            mb="auto"
            style={{
              cursor: "grab",
            }}
            {...dragHandleProps}
          >
            <IconGripVertical size={compact ? "0.8rem" : "1rem"} />
          </ActionIcon>
        </ActionIcon.Group>
      </Box>
      <Collapse in={settingsOn} px={compact ? 10 : 30} pb={compact ? 6 : 15}>
        <EngineSettingsForm
          engine={engine}
          settings={settings}
          setSettings={setSettings}
          color={id < 4 ? arrowColors[id].strong : theme.primaryColor}
          remote={engine.type !== "local"}
        />
      </Collapse>

      <Progress
        value={isGameOver ? 0 : progress}
        animated={progress < 100 && settings.enabled && !isGameOver}
        size="xs"
        striped={progress < 100 && !settings.enabled}
        color={id < 4 ? arrowColors[id].strong : theme.primaryColor}
      />
      <Accordion.Panel pos="relative">
        <Table
          verticalSpacing={compact ? 0 : undefined}
          horizontalSpacing={compact ? 0 : undefined}
        >
          <Table.Tbody>
            {error && (
              <Table.Tr>
                <Table.Td>
                  <Text ta="center" my="lg">
                    Invalid position: {chessopsError(error)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {isGameOver && (
              <Table.Tr>
                <Table.Td>
                  <Text ta="center" my="lg">
                    Game is over
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {displayedEngineVariations && displayedEngineVariations.length === 0 && !isGameOver && (
              <Table.Tr>
                <Table.Td>
                  <Text ta="center" my="lg">
                    No analysis available
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {!isGameOver &&
              !error &&
              !displayedEngineVariations &&
              (settings.enabled ? (
                [...Array(settings.settings.find((s) => s.name === "MultiPV")?.value ?? 1)].map(
                  (_, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>
                        <Skeleton height={compact ? 24 : 35} radius="xl" p={compact ? 2 : 5} />
                      </Table.Td>
                    </Table.Tr>
                  ),
                )
              ) : (
                <Table.Tr>
                  <Table.Td>
                    <Text ta="center" my="lg">
                      {t("Board.Analysis.InactiveEngine")}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            {!isGameOver &&
              !error &&
              finalFen &&
              displayedEngineVariations &&
              displayedEngineVariations.map((engineVariation, index) => {
                return (
                  <AnalysisRow
                    key={index}
                    engine={engine.name}
                    moves={engineVariation.sanMoves}
                    score={engineVariation.score}
                    source={engineVariation.source ?? undefined}
                    halfMoves={halfMoves}
                    threat={threat}
                    fen={threat ? swapMove(finalFen) : finalFen}
                    orientation={orientation}
                    compact={compact}
                  />
                );
              })}
          </Table.Tbody>
        </Table>
      </Accordion.Panel>
    </>
  );
}

function EngineTop({
  name,
  engineVariations,
  isGameOver,
  enabled,
  progress,
  compact = false,
}: {
  name: string;
  engineVariations: BestMoves[] | undefined;
  isGameOver: boolean;
  enabled: boolean;
  progress: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const isComputed = engineVariations && engineVariations.length > 0;
  const depth = isComputed ? engineVariations[0].depth : 0;
  const nps = isComputed ? formatNodes(engineVariations[0].nps) : 0;
  const source = isComputed ? (engineVariations[0].source ?? undefined) : undefined;

  return (
    <Group justify="space-between" gap={compact ? 6 : "md"} wrap="nowrap">
      <Group align="center" gap={compact ? 6 : "xs"} wrap="nowrap" miw={0}>
        <Text fw="bold" fz={compact ? "sm" : "lg"} truncate>
          {name}
        </Text>
        {source && (
          <Tooltip label={`Using ${getBestMoveSourceLabel(source)} analysis`}>
            <Code fz="xs">{getBestMoveSourceLabel(source)}</Code>
          </Tooltip>
        )}
        {progress < 100 &&
          enabled &&
          !isGameOver &&
          engineVariations &&
          engineVariations.length > 0 && (
            <Tooltip label={t("Board.Analysis.EngineSpeedHint")}>
              <Code fz="xs">{nps}n/s</Code>
            </Tooltip>
          )}
      </Group>
      <Group gap={compact ? "xs" : "lg"} wrap="nowrap">
        {!isGameOver && engineVariations && engineVariations.length > 0 && (
          <>
            <Stack align="center" gap={0}>
              <Text
                size={compact ? "0.55rem" : "0.7rem"}
                tt="uppercase"
                fw={700}
                className={classes.subtitle}
              >
                Eval
              </Text>
              <Text fw="bold" fz={compact ? "sm" : "md"} lh={1.05}>
                {formatScore(engineVariations[0].score.value, 1) ?? 0}
              </Text>
            </Stack>
            <Stack align="center" gap={0}>
              <Text
                size={compact ? "0.55rem" : "0.7rem"}
                tt="uppercase"
                fw={700}
                className={classes.subtitle}
              >
                Depth
              </Text>
              <Text fw="bold" fz={compact ? "sm" : "md"} lh={1.05}>
                {depth}
              </Text>
            </Stack>
          </>
        )}
      </Group>
    </Group>
  );
}

export default memo(BestMovesComponent, (prev, next) => {
  return (
    prev.id === next.id &&
    prev.engine === next.engine &&
    prev.fen === next.fen &&
    equal(prev.moves, next.moves) &&
    prev.halfMoves === next.halfMoves &&
    prev.orientation === next.orientation
  );
});
