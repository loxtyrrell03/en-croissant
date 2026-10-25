import {
  Accordion,
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import { getStudyDateKey } from "@/utils/dailyStudyPlan";
import { studyClock, studyElapsed, studyTotals, type StudyJournal } from "@/utils/studySession";

export function studyHistoryRange(period: string, today: string) {
  const date = new Date(`${today}T12:00:00Z`);
  if (period === "week") date.setUTCDate(date.getUTCDate() - 6);
  else if (period === "30") date.setUTCDate(date.getUTCDate() - 29);
  else date.setUTCDate(1);
  return { from: date.toISOString().slice(0, 10), to: today };
}
export default function StudyHistory({
  journal,
  opened,
  onClose,
}: {
  journal: StudyJournal;
  opened: boolean;
  onClose: () => void;
}) {
  const today = getStudyDateKey();
  const [period, setPeriod] = useState("month");
  const [custom, setCustom] = useState(studyHistoryRange("month", today));
  const range = period === "custom" ? custom : studyHistoryRange(period, today);
  const invalid = !range.from || !range.to || range.from > range.to;
  const attempts = invalid
    ? []
    : journal.attempts
        .filter((a) => a.day >= range.from && a.day <= range.to)
        .sort((a, b) => b.day.localeCompare(a.day) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const totals = studyTotals(attempts, Date.now());
  function download() {
    const blob = new Blob(
      [JSON.stringify({ schemaVersion: 1, planId: journal.planId, range, attempts }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `study-history-${range.from}-${range.to}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Modal opened={opened} onClose={onClose} title="Study history" size="xl">
      <Stack>
        <Group align="flex-end">
          <Select
            comboboxProps={{ withinPortal: false }}
            label="Period"
            value={period}
            onChange={(p) => setPeriod(p ?? "month")}
            data={[
              { value: "week", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "month", label: "This month" },
              { value: "custom", label: "Custom dates" },
            ]}
          />
          {period === "custom" && (
            <>
              <TextInput
                type="date"
                label="From"
                value={custom.from}
                onChange={(e) => setCustom({ ...custom, from: e.currentTarget.value })}
              />
              <TextInput
                type="date"
                label="To"
                value={custom.to}
                onChange={(e) => setCustom({ ...custom, to: e.currentTarget.value })}
              />
            </>
          )}
          <Button
            variant="default"
            size="xs"
            disabled={invalid || !attempts.length}
            onClick={download}
          >
            Export this period
          </Button>
        </Group>
        {invalid ? (
          <Alert color="orange">Choose a valid date range.</Alert>
        ) : (
          <>
            <Text fw={600}>
              {range.from} to {range.to} · {attempts.length} block records · {totals.completed}{" "}
              marked complete
            </Text>
            <Text size="sm">
              Timer recorded: {studyClock(totals.timedMs)} · Additional manual time:{" "}
              {totals.manualMinutes} min
            </Text>
            <Text size="xs" c="dimmed">
              Minutes:seconds on the timer. Time and checkmarks describe recorded activity; they do
              not measure recall or mastery. Legacy records have unknown time.
            </Text>
            {!attempts.length && (
              <Text>No study recorded in this period. Unlogged study is unknown.</Text>
            )}
            <Accordion multiple>
              {attempts.map((a) => (
                <Accordion.Item key={a.id} value={a.id}>
                  <Accordion.Control>
                    <Text fw={600}>
                      {a.day} · {a.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {a.status === "legacy"
                        ? `Earlier record · ${a.legacyCompleted ? "marked complete" : "notes only"} · time unknown`
                        : `${a.status === "completed" ? "Marked complete" : a.runningSince !== null ? "Running" : a.status === "partial" ? "Partial" : "Paused / not started"} · ${studyClock(studyElapsed(a, Date.now()))} timed · ${a.manualMinutes ?? 0} min manual`}
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      <Text size="xs" c="dimmed">
                        Session{" "}
                        {[...Object.values(journal.days), ...journal.pastSessions].find(
                          (s) => s.sessionId === a.sessionId,
                        )?.sessionNumber ?? 1}{" "}
                        {a.createdAt !== null
                          ? `· ${new Date(a.createdAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London" })} London · ${a.plannedMs / 60000} min originally planned`
                          : ""}
                        {a.completionRevokedAt ? " · completion later unchecked" : ""}
                      </Text>
                      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                        {a.notes || "No general notes recorded."}
                      </Text>
                      {a.work.map((w) => (
                        <div key={w.id}>
                          <Text fw={600} size="sm">
                            {w.reference || "Untitled work"}
                          </Text>
                          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                            {w.work || "No work notes recorded."}
                          </Text>
                          {w.fen && (
                            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                              FEN: {w.fen}
                            </Text>
                          )}
                          {w.source && (
                            <Text size="xs" c="dimmed">
                              {w.source.path} · position {w.source.game + 1}
                              {w.source.url ? ` · ${w.source.url}` : ""}
                            </Text>
                          )}
                        </div>
                      ))}
                      {a.stepId === "transfer" && (
                        <Text size="xs">
                          Saved annotations confirmed: {a.annotationSaved ? "Yes, manually" : "No"}
                        </Text>
                      )}
                      {a.stepId === "patterns" && (
                        <Text size="xs">
                          Known patterns reviewed: {a.reviewedPatterns ?? "not recorded"} · Unseen
                          patterns attempted: {a.newPatterns ?? "not recorded"} · Review manageable:{" "}
                          {a.reviewManageable ? "yes" : "not confirmed"}
                        </Text>
                      )}
                      {a.resources.map((r, i) => (
                        <Text
                          key={`${r.id}:${i}`}
                          size="xs"
                          c="dimmed"
                          style={{ overflowWrap: "anywhere" }}
                        >
                          Opened {r.title}: {r.reference} (opening alone does not record study)
                        </Text>
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          </>
        )}
      </Stack>
    </Modal>
  );
}
