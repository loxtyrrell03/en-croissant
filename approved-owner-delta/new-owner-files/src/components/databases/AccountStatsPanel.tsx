import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconChartBar,
  IconDatabase,
  IconInfoCircle,
  IconLink,
  IconRefresh,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import {
  accountStatsLinkedDatabaseAtom,
  onlineDatabaseUpdatesAtom,
  type OnlineDatabaseUpdateAccount,
} from "@/state/atoms";
import { useActiveDatabaseViewStore } from "@/state/store/database";
import {
  accountStatsPeriodLabel,
  accountStatsSpeedLabel,
  computeAccountStats,
  type AccountStatsMetricId,
  type AccountStatsPeriod,
  type AccountStatsReport,
  type AccountStatsSpeed,
} from "@/utils/accountStats";
import {
  getOnlineDatabaseUpdateAccounts,
  getOnlineDatabaseUpdateRecord,
  getOnlineGameSourceLabel,
} from "@/utils/onlineGameImport";

const PERIOD_OPTIONS: { value: AccountStatsPeriod; label: string }[] = [
  { value: "week", label: "Last week" },
  { value: "month", label: "Last month" },
  { value: "3months", label: "Last 3 months" },
  { value: "6months", label: "Last 6 months" },
  { value: "year", label: "Last year" },
  { value: "2years", label: "Last 2 years" },
  { value: "all", label: "All time" },
];

const SPEED_OPTIONS: { value: AccountStatsSpeed; label: string }[] = [
  { value: "all", label: "All" },
  { value: "bullet", label: "Bullet" },
  { value: "blitz", label: "Blitz" },
  { value: "rapid", label: "Rapid" },
  { value: "classical", label: "Classical" },
];

function accountKey(account: OnlineDatabaseUpdateAccount) {
  return `${account.source}:${account.username}`;
}

function formatScore(value: number | null) {
  return value === null ? "n/a" : `${Math.round(value)}`;
}

function formatDelta(value: number | null, benchmark: number | null) {
  if (value === null || benchmark === null) return "n/a";
  const delta = Math.round(value - benchmark);
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function sampleColor(confidence: "low" | "medium" | "high") {
  if (confidence === "high") return "green";
  if (confidence === "medium") return "yellow";
  return "gray";
}

function metricBandValue(report: AccountStatsReport, id: AccountStatsMetricId, band: string) {
  return report.comparisons.find((comparison) => comparison.id === band)?.metrics[id] ?? null;
}

function bandLabel(report: AccountStatsReport, band: "below" | "current" | "above") {
  const comparison = report.comparisons.find((item) => item.id === band);
  if (!comparison) return "n/a";
  return `${comparison.min}-${comparison.max}`;
}

export default function AccountStatsPanel() {
  const database = useActiveDatabaseViewStore((s) => s.database);
  const onlineRecords = useAtomValue(onlineDatabaseUpdatesAtom);
  const [linkedDatabase, setLinkedDatabase] = useAtom(accountStatsLinkedDatabaseAtom);
  const onlineRecord = useMemo(
    () => (database ? getOnlineDatabaseUpdateRecord(database, onlineRecords) : null),
    [database, onlineRecords],
  );
  const accounts = useMemo(
    () => (onlineRecord ? getOnlineDatabaseUpdateAccounts(onlineRecord) : []),
    [onlineRecord],
  );
  const [accountValue, setAccountValue] = useState<string | null>(null);
  const [period, setPeriod] = useState<AccountStatsPeriod>("3months");
  const [speed, setSpeed] = useState<AccountStatsSpeed>("all");
  const [report, setReport] = useState<AccountStatsReport | null>(null);
  const [progress, setProgress] = useState<{ value: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanNonce, setScanNonce] = useState(0);
  const linkedAccountKey = useMemo(() => {
    if (!database || linkedDatabase?.dbPath !== database.file) return null;
    return `${linkedDatabase.source}:${linkedDatabase.username}`;
  }, [database, linkedDatabase]);

  const selectedAccount = useMemo(() => {
    return accounts.find((account) => accountKey(account) === accountValue) ?? null;
  }, [accountValue, accounts]);

  useEffect(() => {
    if (accounts.length === 0) {
      setAccountValue(null);
      return;
    }
    setAccountValue((current) => {
      if (current && accounts.some((account) => accountKey(account) === current)) return current;
      if (
        linkedAccountKey &&
        accounts.some((account) => accountKey(account) === linkedAccountKey)
      ) {
        return linkedAccountKey;
      }
      return accountKey(accounts[0]);
    });
  }, [accounts, linkedAccountKey]);

  useEffect(() => {
    if (!database || !selectedAccount) {
      setReport(null);
      return;
    }

    let cancelled = false;
    setError(null);
    setProgress({ value: 0, message: "Preparing account stats" });

    void computeAccountStats({
      databasePath: database.file,
      account: {
        source: selectedAccount.source,
        username: selectedAccount.username,
      },
      period,
      speed,
      onProgress: (value, message) => {
        if (!cancelled) setProgress({ value, message });
      },
    })
      .then((nextReport) => {
        if (cancelled) return;
        setReport(nextReport);
        setProgress(null);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setProgress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [database, period, scanNonce, selectedAccount, speed]);

  if (!database) return null;

  if (!onlineRecord) {
    return (
      <Stack h="100%" align="center" justify="center" gap="sm">
        <IconChartBar size="2rem" />
        <Text fw={600}>No online account linked</Text>
        <Text c="dimmed" maw={460} ta="center" size="sm">
          Link this database to a Lichess or Chess.com account from the database settings, then
          stats can compare that account with Lichess rating-band benchmarks.
        </Text>
      </Stack>
    );
  }

  const isLinkedStatsSource =
    !!selectedAccount &&
    linkedDatabase?.dbPath === database.file &&
    linkedDatabase.source === selectedAccount.source &&
    linkedDatabase.username.toLowerCase() === selectedAccount.username.toLowerCase();
  const currentBand = report?.comparisons.find((comparison) => comparison.id === "current");

  return (
    <Stack h="100%" gap="sm" style={{ overflow: "hidden" }}>
      <Group justify="space-between" align="flex-end" gap="xs">
        <Box>
          <Group gap={6}>
            <Text fw={700}>Account Stats</Text>
            <Badge variant="light" leftSection={<IconDatabase size="0.8rem" />}>
              {database.title}
            </Badge>
            {isLinkedStatsSource && <Badge color="green">Linked</Badge>}
          </Group>
          <Text size="xs" c="dimmed">
            Estimated Lichess benchmark bands use the selected account, time control, and rating
            mapping.
          </Text>
        </Box>
        <Button
          size="xs"
          variant={isLinkedStatsSource ? "light" : "default"}
          leftSection={<IconLink size="0.9rem" />}
          onClick={() =>
            selectedAccount &&
            setLinkedDatabase({
              dbPath: database.file,
              title: database.title,
              source: selectedAccount.source,
              username: selectedAccount.username,
              linkedAt: Date.now(),
            })
          }
        >
          {isLinkedStatsSource ? "Stats source" : "Use for stats"}
        </Button>
      </Group>

      <Group gap="xs" align="flex-end">
        <Select
          size="xs"
          label="Account"
          data={accounts.map((account) => ({
            value: accountKey(account),
            label: `${getOnlineGameSourceLabel(account.source)} ${account.username}`,
          }))}
          value={accountValue}
          onChange={setAccountValue}
          w={220}
        />
        <Select
          size="xs"
          label="Period"
          data={PERIOD_OPTIONS}
          value={period}
          onChange={(value) => value && setPeriod(value as AccountStatsPeriod)}
          w={160}
        />
        <Select
          size="xs"
          label="Time control"
          data={SPEED_OPTIONS}
          value={speed}
          onChange={(value) => value && setSpeed(value as AccountStatsSpeed)}
          w={140}
        />
        <Tooltip label="Recompute with the current filters">
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRefresh size="0.9rem" />}
            onClick={() => {
              setReport(null);
              setScanNonce((value) => value + 1);
            }}
          >
            Refresh
          </Button>
        </Tooltip>
      </Group>

      {progress && (
        <Box>
          <Group justify="space-between" mb={4}>
            <Group gap={6}>
              <Loader size="xs" />
              <Text size="xs">{progress.message}</Text>
            </Group>
            <Text size="xs" c="dimmed">
              {Math.round(progress.value)}%
            </Text>
          </Group>
          <Progress value={progress.value} size="xs" />
        </Box>
      )}

      {error && (
        <Alert color="red" icon={<IconInfoCircle size="1rem" />}>
          {error}
        </Alert>
      )}

      {report && (
        <>
          <Group gap="xs">
            <Badge variant="outline">{accountStatsPeriodLabel(report.period)}</Badge>
            <Badge variant="outline">{accountStatsSpeedLabel(report.speed)}</Badge>
            <Badge variant="outline">
              Benchmark: {accountStatsSpeedLabel(report.benchmarkSpeed)}
            </Badge>
            <Badge variant="outline">{report.games} games</Badge>
            <Badge variant="outline">
              {report.wins}-{report.draws}-{report.losses}
            </Badge>
            <Badge variant="outline">{Math.round(report.scorePct)}% score</Badge>
            {report.lichessRating !== null && (
              <Badge variant="outline">
                Lichess {report.lichessRating}
                {report.lichessRatingUncertainty ? ` +/- ${report.lichessRatingUncertainty}` : ""}
              </Badge>
            )}
          </Group>

          <Alert
            color={report.evalMoves > 0 ? "blue" : "yellow"}
            icon={<IconInfoCircle size="1rem" />}
          >
            {report.evalMoves > 0
              ? `${report.evalMoves} evaluated moves and ${report.clockMoves} clocked moves were found in this filter.`
              : "This filter has no eval comments, so phase, capitalization, and resourcefulness scores need analyzed games to become meaningful."}{" "}
            {report.ratingSource}. {report.benchmarkSource}
            {currentBand ? `; current benchmark band ${currentBand.min}-${currentBand.max}.` : "."}
          </Alert>

          <ScrollArea flex={1}>
            <Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Metric</Table.Th>
                  <Table.Th ta="right">User</Table.Th>
                  <Table.Th ta="right">Below {bandLabel(report, "below")}</Table.Th>
                  <Table.Th ta="right">Your band {bandLabel(report, "current")}</Table.Th>
                  <Table.Th ta="right">Above {bandLabel(report, "above")}</Table.Th>
                  <Table.Th ta="right">Delta</Table.Th>
                  <Table.Th>Evidence</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {report.metrics.map((metric) => {
                  const current = metricBandValue(report, metric.id, "current");
                  const delta = formatDelta(metric.value, current);
                  return (
                    <Table.Tr key={metric.id}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={600}>
                            {metric.label}
                          </Text>
                          <Tooltip
                            label={`Sample size for this metric (${metric.sample}); this is not a skill rating.`}
                          >
                            <Badge size="xs" color={sampleColor(metric.confidence)} variant="light">
                              n={metric.sample}
                            </Badge>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right" fw={700}>
                        {formatScore(metric.value)}
                      </Table.Td>
                      <Table.Td ta="right">
                        {formatScore(metricBandValue(report, metric.id, "below"))}
                      </Table.Td>
                      <Table.Td ta="right">{formatScore(current)}</Table.Td>
                      <Table.Td ta="right">
                        {formatScore(metricBandValue(report, metric.id, "above"))}
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text
                          size="sm"
                          c={
                            delta.startsWith("+")
                              ? "green"
                              : delta.startsWith("-")
                                ? "red"
                                : "dimmed"
                          }
                          fw={600}
                        >
                          {delta}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {metric.evidence}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </>
      )}
    </Stack>
  );
}
