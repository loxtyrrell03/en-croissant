import { Group, Select, Stack, Text } from "@mantine/core";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import { enginePlanSourceEvaluation, formatScoreValue, type EnginePlan } from "@/utils/enginePlanExplorer";
import { PLAN_HORIZONS, type PlanHorizon } from "@/utils/planHorizon";

export function EnginePlanHorizonControl({ value, onChange }: {
  value: PlanHorizon; onChange: (value: PlanHorizon) => void;
}) {
  return <Group gap={4} wrap="nowrap">
    <Select aria-label="Plan horizon" size="sm" w={142} value={value}
      data={PLAN_HORIZONS.map(option => ({ ...option }))}
      onChange={next => { if (next) onChange(next as PlanHorizon); }} />
    <TournamentHelp label="Plan horizon">
      Immediate covers the next two half-moves, medium term covers three to six, and long term covers seven to twelve. Filtering uses when each idea is achieved in its own line.
    </TournamentHelp>
  </Group>;
}

export function EnginePlanEvaluation({ plan }: { plan: EnginePlan }) {
  const source = enginePlanSourceEvaluation(plan);
  if (!source) return <Text size="sm" c="dimmed">Unavailable</Text>;
  return <Stack gap={2}>
    <Group gap={4} wrap="nowrap">
      <Text size="sm" style={{ whiteSpace: "nowrap" }}>{formatScoreValue(source.score)}</Text>
      <TournamentHelp label="Plan evaluation">
        {source.conditional
          ? `This is the root score of supporting PV${source.rank}, at depth ${source.depth}, from White's perspective. It depends on that line and does not independently evaluate this later idea.`
          : `This move's own PV${source.rank} score, at depth ${source.depth}, from White's perspective. Positive values favour White; negative values favour Black.`}
      </TournamentHelp>
    </Group>
    <Text size="xs" c="dimmed">{source.conditional ? "Conditional · " : ""}PV{source.rank}</Text>
  </Stack>;
}
